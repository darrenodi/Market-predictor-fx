import { GoogleGenerativeAI } from '@google/generative-ai'
import { MarketData, TechnicalIndicators } from '@/types'
import { PerformanceSummary, formatPerformanceForPrompt } from '@/lib/performance'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

// Only use capable models — a missed signal is better than a wrong one
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
]

export interface GeneratedSignal {
  symbol: string
  direction: 'long' | 'short'
  leverage: number
  portfolio_pct: number
  tp: number
  sl: number
  market_price: number
  confidence: number
  reasoning: string
}

// Plain number — no commas, unambiguous for the AI
function plain(n: number): string {
  if (n < 0.0001) return n.toFixed(8)
  if (n < 1) return n.toFixed(6)
  return n.toFixed(2)
}

function pct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(3) + '%'
}

// Pre-compute a clear directional bias so the model doesn't have to do the TA
function computeBias(ind: TechnicalIndicators, price: number): {
  biasDirection: 'LONG' | 'SHORT' | 'NEUTRAL'
  biasScore: number   // 0-4, how many signals agree
  biasReasons: string[]
  blockLong: string | null
  blockShort: string | null
  isChoppy: boolean   // true when momentum timeframes conflict or price is ranging
} {
  const reasons: string[] = []
  let bullSignals = 0, bearSignals = 0

  // EMA alignment
  if (ind.emaTrend === 'bullish') { bullSignals++; reasons.push('EMA stack bullish (8>21>50)') }
  else if (ind.emaTrend === 'bearish') { bearSignals++; reasons.push('EMA stack bearish (8<21<50)') }
  else reasons.push('EMA neutral (no clear stack)')

  // RSI
  if (ind.rsi < 40) { bullSignals++; reasons.push(`RSI ${ind.rsi.toFixed(0)} — approaching oversold, buy pressure building`) }
  else if (ind.rsi > 60) { bearSignals++; reasons.push(`RSI ${ind.rsi.toFixed(0)} — approaching overbought, sell pressure building`) }
  else reasons.push(`RSI ${ind.rsi.toFixed(0)} — neutral zone`)

  // Momentum
  if (ind.momentum30m > 0.05 && ind.momentum1h > 0) { bullSignals++; reasons.push(`Momentum bullish: 30m ${pct(ind.momentum30m)}, 1h ${pct(ind.momentum1h)}`) }
  else if (ind.momentum30m < -0.05 && ind.momentum1h < 0) { bearSignals++; reasons.push(`Momentum bearish: 30m ${pct(ind.momentum30m)}, 1h ${pct(ind.momentum1h)}`) }
  else reasons.push(`Momentum mixed: 30m ${pct(ind.momentum30m)}, 1h ${pct(ind.momentum1h)}`)

  // Detect choppy conditions: momentum timeframes pointing in opposite directions
  const m30sign = ind.momentum30m > 0.05 ? 1 : ind.momentum30m < -0.05 ? -1 : 0
  const m1hSign = ind.momentum1h > 0.1 ? 1 : ind.momentum1h < -0.1 ? -1 : 0
  const momentumConflict = m30sign !== 0 && m1hSign !== 0 && m30sign !== m1hSign
  if (momentumConflict) {
    reasons.push(`⚠ CONFLICTING MOMENTUM: 30m ${pct(ind.momentum30m)} vs 1h ${pct(ind.momentum1h)} — price oscillating, no sustainable edge`)
  }

  const isRanging = (ind.priceStructure as string) === 'ranging'
  if (isRanging) {
    reasons.push('Ranging 24h structure — sideways price action, high chop risk')
  }

  // Price vs nearest level
  const distToRes = ((ind.nearestResistance - price) / price) * 100
  const distToSup = ((price - ind.nearestSupport) / price) * 100
  if (distToRes < 0.2) { bearSignals++; reasons.push(`Price ${distToRes.toFixed(3)}% from resistance — likely cap`) }
  else if (distToSup < 0.2) { bullSignals++; reasons.push(`Price ${distToSup.toFixed(3)}% from support — likely bounce`) }

  const biasScore = Math.max(bullSignals, bearSignals)
  const biasDirection = bullSignals > bearSignals ? 'LONG' : bearSignals > bullSignals ? 'SHORT' : 'NEUTRAL'
  const isChoppy = momentumConflict || isRanging

  // Hard blocks — only at extreme RSI, not just overbought/oversold zone
  const blockLong = ind.rsi >= 75 ? `RSI ${ind.rsi.toFixed(0)} is EXTREME OVERBOUGHT (≥75) — avoid long, consider short` : null
  const blockShort = ind.rsi <= 25 ? `RSI ${ind.rsi.toFixed(0)} is EXTREME OVERSOLD (≤25) — avoid short, consider long` : null

  return { biasDirection, biasScore, biasReasons: reasons, blockLong, blockShort, isChoppy }
}

function getSession(): { name: string; quality: string; note: string } {
  const h = new Date().getUTCHours()
  if (h >= 13 && h < 16) return { name: 'London/NY Overlap', quality: 'PEAK', note: 'Highest liquidity — breakouts and momentum moves are reliable' }
  if (h >= 16 && h < 21) return { name: 'New York', quality: 'HIGH', note: 'Institutional flow — trend continuations valid, watch for reversals at NY close' }
  if (h >= 9 && h < 13) return { name: 'London', quality: 'HIGH', note: 'London in full flow — strong momentum moves, trend-follow the established direction' }
  if (h === 8) return { name: 'London Open', quality: 'DANGER', note: 'Stop-hunt hour — institutions spike price to grab liquidity before reversing. Avoid new entries, wait for direction to commit after 09:00 UTC' }
  if (h >= 21 || h < 2) return { name: 'Post-NY / Pre-Asia', quality: 'LOW', note: 'Thin volume — choppy price action, avoid breakouts, range-play only' }
  return { name: 'Asia', quality: 'LOW', note: 'Reduced volume — tight ranges, fake breakouts common, prefer counter-trend fades' }
}

function buildPrompt(assets: MarketData[], performance?: PerformanceSummary): string {
  const now = new Date().toUTCString()
  const session = getSession()

  const assetBlocks = assets.map(a => {
    const ind = a.indicators
    const newsLines = a.news.length > 0
      ? a.news.map(n => `  • ${n.title}`).join('\n')
      : '  • No recent news (last 2h)'
    const whaleLine = a.whales.length > 0
      ? a.whales.map(w => `  • ${w.title}`).join('\n')
      : '  • No large transactions'

    let techSection = '  Technicals: insufficient data — rely on news only'
    let slTpGuide = ''
    let prevBlock = '  Previous signal: none'

    if (ind) {
      const bias = computeBias(ind, a.price)

      const vol = ind.volumeRatio >= 1.5 ? '🔥 HIGH (confirms moves)' :
                  ind.volumeRatio <= 0.6 ? '⚠ LOW (weak conviction)' :
                  `normal (${ind.volumeRatio.toFixed(2)}x avg)`

      const structureEmoji = ind.priceStructure === 'uptrend' ? '📈' : ind.priceStructure === 'downtrend' ? '📉' : '↔'
      const weeklyEmoji   = ind.weeklyBias === 'bullish' ? '🟢' : ind.weeklyBias === 'bearish' ? '🔴' : '⚪'

      const fundingLine = (() => {
        if (ind.fundingRate === null) return 'n/a'
        const r = ind.fundingRate
        const pct = (r * 100).toFixed(4)
        const sign = r >= 0 ? '+' : ''
        const interp = r > 0.0003  ? 'elevated longs — market overextended bullish, bearish pressure building' :
                       r < -0.0003 ? 'elevated shorts — market overextended bearish, bullish pressure building' :
                       r > 0       ? 'slight long bias — neutral' :
                       r < 0       ? 'slight short bias — neutral' : 'neutral'
        return `${sign}${pct}% per 8h (${interp})`
      })()

      techSection = `  TECHNICAL SUMMARY:
    Weekly bias: ${weeklyEmoji} ${ind.weeklyBias.toUpperCase()} (7-day direction)
    24h structure: ${structureEmoji} ${ind.priceStructure.toUpperCase()} (12h price action: HH/HL or LH/LL)
    Bias       : ${bias.biasDirection} (${bias.biasScore}/4 signals agree)
    Signals    :
      ${bias.biasReasons.map(r => `• ${r}`).join('\n      ')}
    EMA        : EMA8=${plain(ind.ema8)} | EMA21=${plain(ind.ema21)} | EMA50=${plain(ind.ema50)} → ${ind.emaTrend.toUpperCase()}
    RSI(14)    : ${ind.rsi.toFixed(1)} [${ind.rsiZone.toUpperCase()}]
    Funding    : ${fundingLine}
    Volume     : ${vol}
    24h Range  : ${plain(ind.low24h)} — ${plain(ind.high24h)}
    Resistance : ${ind.resistances.map(plain).join(' | ') || 'none found'} ${ind.nearestResistance ? `(nearest: ${plain(ind.nearestResistance)}, ${(((ind.nearestResistance - a.price) / a.price) * 100).toFixed(3)}% away)` : ''}
    Support    : ${ind.supports.map(plain).join(' | ') || 'none found'} ${ind.nearestSupport ? `(nearest: ${plain(ind.nearestSupport)}, ${(((a.price - ind.nearestSupport) / a.price) * 100).toFixed(3)}% away)` : ''}
    ATR(5-min) : ${plain(ind.atr)} (${ind.atrPct.toFixed(4)}% per 5 min — Binance true range)`

      const atr = ind.atr
      const tpDist = Math.max(a.price * 0.0015, atr * 1.5)   // TP = 0.15% — hits easily in 30 min
      const slDist = tpDist * 2                                // SL = 0.30% — wide enough to survive wicks

      const longTp  = a.price + tpDist
      const longSl  = a.price - slDist
      const shortTp = a.price - tpDist
      const shortSl = a.price + slDist

      // Cap TP at nearest swing level so we don't reach past key S/R
      const cappedLongTp  = ind.nearestResistance > a.price && ind.nearestResistance < longTp ? ind.nearestResistance - atr * 0.3 : longTp
      const cappedShortTp = ind.nearestSupport > 0 && ind.nearestSupport > shortTp ? ind.nearestSupport + atr * 0.3 : shortTp

      const trendDir = a.price >= ind.ema50 ? 'LONG' : 'SHORT'
      const trendNote = `preferred direction: ${trendDir} (price ${a.price >= ind.ema50 ? 'above' : 'below'} EMA50 — counter-trend needs strong confluence)`

      const priceDecimals = a.price < 1 ? 6 : 2
      slTpGuide = `  PRE-COMPUTED TP/SL (TP=0.15% | SL=0.30% | 0.5:1 R/R — needs >67% win rate):
    IF LONG : TP=${plain(cappedLongTp)} | SL=${plain(longSl)}
    IF SHORT: TP=${plain(cappedShortTp)} | SL=${plain(shortSl)}
    TP move: $${tpDist.toFixed(priceDecimals)} (${(tpDist/a.price*100).toFixed(3)}%) | SL move: $${slDist.toFixed(priceDecimals)} (${(slDist/a.price*100).toFixed(3)}%)
    ATR=${plain(atr)} | Nearest resistance: ${plain(ind.nearestResistance)} | Nearest support: ${plain(ind.nearestSupport)}
    Trend: ${trendNote}`

      if (bias.blockLong)   slTpGuide += `\n  ⛔ RSI BLOCK: ${bias.blockLong}`
      if (bias.blockShort)  slTpGuide += `\n  ⛔ RSI BLOCK: ${bias.blockShort}`
      if (bias.biasScore < 2) slTpGuide += `\n  ⚠ VERY WEAK SETUP (${bias.biasScore}/4) — skip unless strong news catalyst`
      if (bias.isChoppy) slTpGuide += `\n  🚫 CHOPPY MARKET DETECTED: 30m and 1h momentum conflict OR price is ranging. Price is oscillating — picking a direction here means guessing. Set confidence=0.0 and skip. Only override if there is a clear, strong news catalyst that resolves direction.`
    }

    if (a.currentSignal) {
      const s = a.currentSignal
      const pnlPct = ((a.price - s.entry) / s.entry) * 100 * (s.direction === 'long' ? 1 : -1)
      prevBlock = `  Previous signal (${s.ageMinutes}m ago): ${s.direction.toUpperCase()} @ ${plain(s.entry)} | TP=${plain(s.tp)} | SL=${plain(s.sl)}
  P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(3)}% [${pnlPct >= 0 ? 'WINNING' : 'LOSING'}] — only change direction if bias has clearly reversed`
    }

    // Order book walls
    let obSection = ''
    if (a.orderBook) {
      const fmtWall = (w: { price: number; notionalUsd: number }) =>
        `$${plain(w.price)} ($${(w.notionalUsd / 1000).toFixed(0)}K notional)`
      const bids = a.orderBook.bidWalls.map(fmtWall).join(' | ')
      const asks = a.orderBook.askWalls.map(fmtWall).join(' | ')

      // Tell Gemini whether the pre-computed TP clears or hits a wall
      const tpDist = a.price * 0.0015
      const longTp  = a.price + tpDist
      const shortTp = a.price - tpDist
      const nearAsk  = a.orderBook.askWalls[0]
      const nearBid  = a.orderBook.bidWalls[0]
      const longTpClear  = nearAsk  ? longTp  < nearAsk.price  ? '✓ LONG TP clears nearest ask wall'  : '⚠ LONG TP hits through ask wall — may stall' : ''
      const shortTpClear = nearBid  ? shortTp > nearBid.price  ? '✓ SHORT TP clears nearest bid wall' : '⚠ SHORT TP hits through bid wall — may stall' : ''

      obSection = `  Order Book Walls (Binance real-time):
    Support  (big bids): ${bids || 'none detected'}
    Resistance (big asks): ${asks || 'none detected'}
    ${longTpClear}
    ${shortTpClear}`
    }

    // Market sentiment
    let sentSection = ''
    if (a.sentiment) {
      const { longRatio, shortRatio, openInterest, oiChangePct } = a.sentiment
      const longPct  = (longRatio  * 100).toFixed(1)
      const shortPct = (shortRatio * 100).toFixed(1)
      const crowd = longRatio > 0.65 ? '— crowd heavily long → contrarian BEARISH pressure' :
                    longRatio < 0.35 ? '— crowd heavily short → contrarian BULLISH pressure' :
                    longRatio > 0.55 ? '— slight long bias' : longRatio < 0.45 ? '— slight short bias' : '— balanced'
      const oiDir = oiChangePct > 0.5 ? `▲ +${oiChangePct.toFixed(2)}% (rising — conviction building)` :
                    oiChangePct < -0.5 ? `▼ ${oiChangePct.toFixed(2)}% (falling — positions closing)` :
                    `≈ flat (${oiChangePct.toFixed(2)}%)`
      sentSection = `  Futures Sentiment:
    Long/Short ratio: ${longPct}% long / ${shortPct}% short ${crowd}
    Open Interest: ${openInterest.toFixed(0)} contracts | OI change: ${oiDir}`
    }

    return `━━━ ${a.symbol} | Price: ${plain(a.price)} | 24h: ${pct(a.change_24h)} ━━━
${techSection}

${slTpGuide}

${obSection ? obSection + '\n' : ''}${sentSection ? sentSection + '\n' : ''}
${prevBlock}

  News (last 2h):
${newsLines}
  Whale activity:
${whaleLine}`
  }).join('\n\n')

  const perfBlock = performance ? '\n' + formatPerformanceForPrompt(performance) + '\n' : ''

  // Dynamic per-asset TP/SL targets in dollar terms
  const assetTpLines = assets.map(a => {
    const tpTarget = a.price * 0.0015
    const slTarget = a.price * 0.003
    const dec = a.price < 1 ? 6 : a.price < 100 ? 3 : 2
    return `  ${a.symbol.padEnd(10)}: TP ~$${tpTarget.toFixed(dec)} | SL ~$${slTarget.toFixed(dec)}  (0.15% / 0.30% of $${plain(a.price)})`
  }).join('\n')

  return `You are a professional prop trader running a live 24/7 futures scalping desk. Every 30 minutes you analyse each asset and generate a signal. You think like a seasoned market maker — you understand stop-hunts, session liquidity patterns, and when NOT to trade is just as important as when to trade.

━━━ CURRENT TIMESTAMP ━━━
${now}

━━━ TRADING SESSION ━━━
${session.name} [${session.quality}] — ${session.note}
${perfBlock}
━━━ PRICE MOVE TARGETS (30-min scalp) ━━━
${assetTpLines}

Design: TP=0.15% | SL=0.30% — small TP hits frequently in 30 min, wide SL survives wicks.

━━━ MARKET DATA ━━━
${assetBlocks}

━━━ SIGNAL GENERATION ━━━

SKIP FIRST — before picking direction, check these:
  🚫 If asset block shows "CHOPPY MARKET DETECTED" → confidence=0.0. No exceptions unless a major news event clearly resolves direction. Choppy markets eat SL hits.
  🚫 If biasScore < 2 AND session is LOW/DANGER AND no strong news → confidence=0.0.
  🚫 If weekly bias and 24h structure disagree AND 30m/1h momentum also conflict → no edge exists. confidence=0.0.

DIRECTION — only proceed if above skip rules don't apply, then work in order:
  1. Weekly bias + 24h structure: strongest signal. If both agree → that is your direction.
  2. EMA stack (8/21/50): bullish stack (8>21>50) → long; bearish (8<21<50) → short.
  3. RSI(14): ≥70 overbought → short pressure; ≤30 oversold → long pressure.
  4. Momentum: 30m + 1h aligned → confirms. Opposing → means choppy, skip or reduce confidence.
  5. Session: HIGH/PEAK → trust momentum breakouts. LOW → fade extremes, tighten size. During LOW session, require 3+/4 signals or skip.
  6. News/whales: strong catalyst overrides weak TA. No catalyst → pure technicals.
  7. Order book: if TP warning says "⚠ hits through wall" → reduce confidence or flip direction. A $10M+ wall directly above TP = price likely stalls before target.
  8. Sentiment: crowd >65% long = contrarian bearish pressure. >65% short = contrarian bullish. Use as a secondary signal, not a primary. Rising OI confirms the move; falling OI means weak conviction.
  9. Pattern edge: if your pattern track record shows ✗ AVOID for this exact setup (symbol + direction + session) → skip or heavily reduce confidence. If ✓ EDGE → raise confidence 0.05–0.10.

TP/SL:
  • Start from the pre-computed levels — they are calibrated for your asset and current ATR.
  • Adjust TP inward if a key resistance/support sits directly in the path.
  • Never tighten SL below the pre-computed level — only widen if structure demands it.
  • TP must be on the profit side, SL on the loss side. Never swap them.

PREVIOUS SIGNAL:
  If winning and structure has not reversed, maintain direction. Change only on clear bias flip.

LEVERAGE & SIZING:
  • Strong setup (4/4 signals agree, HIGH/PEAK session): 100–200× crypto / 30–50× gold
  • Good setup (2–3 factors agree): 50–100× crypto / 15–30× gold
  • Weak setup (mixed or LOW session): 20–50× crypto / 10–15× gold
  • portfolio_pct: 3–7

CONFIDENCE:
  • 0.8–1.0 — all HTF + session + TA fully aligned
  • 0.6–0.79 — majority of signals agree
  • 0.5–0.59 — mixed but best available read
  • 0.0 — skip: no directional edge (flat range, zero momentum, zero catalyst)

reasoning: 1 crisp sentence — dominant signal and why this direction wins right now.

━━━ OUTPUT ━━━
Respond ONLY with valid JSON. No markdown. No text outside the JSON block.
Include ALL ${assets.length} assets. Set confidence=0.0 to skip an asset (it will not be inserted).

{
  "signals": [
    {
      "symbol": "ASSET/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 2356.00,
      "sl": 2290.00,
      "market_price": 2338.00,
      "confidence": 0.75,
      "reasoning": "EMA stack bullish, RSI 42 rising from near-oversold with strong support at 2310 — momentum and structure aligned long."
    }
  ]
}`
}

function isRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
         msg.includes('resource exhausted') || msg.includes('too many requests')
}

export async function generateSignals(assets: MarketData[], performance?: PerformanceSummary): Promise<GeneratedSignal[]> {
  const prompt = buildPrompt(assets, performance)
  let lastError: unknown

  for (const modelId of MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId })
      const result = await model.generateContent(prompt)
      const text = result.response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error(`${modelId} returned no JSON`)

      const parsed = JSON.parse(jsonMatch[0]) as { signals: GeneratedSignal[] }

      const validated = parsed.signals.map(sig => {
        let { tp, sl } = sig
        const price = sig.market_price

        for (const divisor of [10, 100]) {
          const tpOk = Math.abs((tp - price) / price) <= 0.08
          const slOk = Math.abs((sl - price) / price) <= 0.08
          if (tpOk && slOk) break
          const tpS = tp / divisor, slS = sl / divisor
          if (Math.abs((tpS - price) / price) <= 0.08 && Math.abs((slS - price) / price) <= 0.08) {
            console.warn(`[signals] Auto-scaled ${sig.symbol} ÷${divisor}`)
            tp = tpS; sl = slS; break
          }
        }

        // Drop only if Gemini explicitly chose to skip
        if (sig.confidence === 0) {
          console.log(`[signals] Skipped ${sig.symbol}: confidence=0 (no edge)`)
          return null
        }

        // Sanity check: TP and SL must be on the correct sides
        const tpSide = sig.direction === 'long' ? tp > price : tp < price
        const slSide = sig.direction === 'long' ? sl < price : sl > price
        if (!tpSide || !slSide) {
          console.warn(`[signals] Dropped ${sig.symbol}: TP/SL on wrong side (price=${price}, tp=${tp}, sl=${sl})`)
          return null
        }

        // Enforce original working targets: TP=0.15%, SL=0.30% (0.5:1 R/R)
        // Small TP hits easily in 30 min; wide SL survives wicks
        const tpDist = price * 0.0015
        const slDist = price * 0.003
        tp = sig.direction === 'long' ? price + tpDist : price - tpDist
        sl = sig.direction === 'long' ? price - slDist : price + slDist

        return { ...sig, tp, sl }
      }).filter((s): s is GeneratedSignal => s !== null)

      console.log(`[signals] ${validated.length}/${parsed.signals.length} valid signals via ${modelId}`)
      return validated
    } catch (err) {
      lastError = err
      if (isRateLimitError(err)) {
        console.warn(`[signals] ${modelId} rate limited, trying next`)
        continue
      }
      console.warn(`[signals] ${modelId} failed: ${err}`)
    }
  }

  throw new Error(`All models failed. Last: ${lastError}`)
}
