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

  // Price vs nearest level
  const distToRes = ((ind.nearestResistance - price) / price) * 100
  const distToSup = ((price - ind.nearestSupport) / price) * 100
  if (distToRes < 0.2) { bearSignals++; reasons.push(`Price ${distToRes.toFixed(3)}% from resistance — likely cap`) }
  else if (distToSup < 0.2) { bullSignals++; reasons.push(`Price ${distToSup.toFixed(3)}% from support — likely bounce`) }

  const biasScore = Math.max(bullSignals, bearSignals)
  const biasDirection = bullSignals > bearSignals ? 'LONG' : bearSignals > bullSignals ? 'SHORT' : 'NEUTRAL'

  // Hard blocks — only at extreme RSI, not just overbought/oversold zone
  const blockLong = ind.rsi >= 75 ? `RSI ${ind.rsi.toFixed(0)} is EXTREME OVERBOUGHT (≥75) — avoid long, consider short` : null
  const blockShort = ind.rsi <= 25 ? `RSI ${ind.rsi.toFixed(0)} is EXTREME OVERSOLD (≤25) — avoid short, consider long` : null

  return { biasDirection, biasScore, biasReasons: reasons, blockLong, blockShort }
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

      techSection = `  TECHNICAL SUMMARY:
    Weekly bias: ${weeklyEmoji} ${ind.weeklyBias.toUpperCase()} (7-day direction)
    24h structure: ${structureEmoji} ${ind.priceStructure.toUpperCase()} (12h price action: HH/HL or LH/LL)
    Bias       : ${bias.biasDirection} (${bias.biasScore}/4 signals agree)
    Signals    :
      ${bias.biasReasons.map(r => `• ${r}`).join('\n      ')}
    EMA        : EMA8=${plain(ind.ema8)} | EMA21=${plain(ind.ema21)} | EMA50=${plain(ind.ema50)} → ${ind.emaTrend.toUpperCase()}
    RSI(14)    : ${ind.rsi.toFixed(1)} [${ind.rsiZone.toUpperCase()}]
    Volume     : ${vol}
    24h Range  : ${plain(ind.low24h)} — ${plain(ind.high24h)}
    Resistance : ${ind.resistances.map(plain).join(' | ') || 'none found'} ${ind.nearestResistance ? `(nearest: ${plain(ind.nearestResistance)}, ${(((ind.nearestResistance - a.price) / a.price) * 100).toFixed(3)}% away)` : ''}
    Support    : ${ind.supports.map(plain).join(' | ') || 'none found'} ${ind.nearestSupport ? `(nearest: ${plain(ind.nearestSupport)}, ${(((a.price - ind.nearestSupport) / a.price) * 100).toFixed(3)}% away)` : ''}
    ATR(5-min) : ${plain(ind.atr)} (${ind.atrPct.toFixed(4)}% per 5 min)`

      // Target $100–200 price move for BTC-scale assets; ATR-based keeps it proportional per asset
      const atr = ind.atr
      const isGold = a.symbol === 'XAU/USD'
      const minSlPct = isGold ? 0.0005 : 0.001   // 0.05% gold | 0.1% crypto (safety floor only)
      const slDist = Math.max(atr * 1.5, a.price * minSlPct)
      const tpDist = slDist * 1.5                  // 1.5:1 R/R

      const longTp  = a.price + tpDist
      const longSl  = a.price - slDist
      const shortTp = a.price - tpDist
      const shortSl = a.price + slDist

      // Cap TP at nearest swing level so we don't reach past resistance
      const cappedLongTp  = ind.nearestResistance > a.price && ind.nearestResistance < longTp ? ind.nearestResistance - atr * 0.3 : longTp
      const cappedShortTp = ind.nearestSupport > 0 && ind.nearestSupport > shortTp ? ind.nearestSupport + atr * 0.3 : shortTp

      const trendDir = a.price >= ind.ema50 ? 'LONG' : 'SHORT'
      const trendNote = `preferred direction: ${trendDir} (price ${a.price >= ind.ema50 ? 'above' : 'below'} EMA50 — counter-trend needs strong confluence)`

      slTpGuide = `  PRE-COMPUTED TP/SL for 30-min scalp (1.5:1 R/R, min SL=${(minSlPct * 100).toFixed(2)}% of price):
    IF LONG : TP=${plain(cappedLongTp)} | SL=${plain(longSl)} | R/R=1.5:1
    IF SHORT: TP=${plain(cappedShortTp)} | SL=${plain(shortSl)} | R/R=1.5:1
    SL distance: ${plain(slDist)} (${(slDist / a.price * 100).toFixed(3)}% of price) | TP distance: ${plain(tpDist)} (${(tpDist / a.price * 100).toFixed(3)}%)
    ATR=${plain(atr)} | Nearest resistance: ${plain(ind.nearestResistance)} | Nearest support: ${plain(ind.nearestSupport)}
    Trend: ${trendNote}`

      if (bias.blockLong)   slTpGuide += `\n  ⛔ RSI BLOCK: ${bias.blockLong}`
      if (bias.blockShort)  slTpGuide += `\n  ⛔ RSI BLOCK: ${bias.blockShort}`
      if (bias.biasScore < 2) slTpGuide += `\n  ⚠ VERY WEAK SETUP (${bias.biasScore}/4) — skip unless strong news catalyst`
    }

    if (a.currentSignal) {
      const s = a.currentSignal
      const pnlPct = ((a.price - s.entry) / s.entry) * 100 * (s.direction === 'long' ? 1 : -1)
      prevBlock = `  Previous signal (${s.ageMinutes}m ago): ${s.direction.toUpperCase()} @ ${plain(s.entry)} | TP=${plain(s.tp)} | SL=${plain(s.sl)}
  P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(3)}% [${pnlPct >= 0 ? 'WINNING' : 'LOSING'}] — only change direction if bias has clearly reversed`
    }

    return `━━━ ${a.symbol} | Price: ${plain(a.price)} | 24h: ${pct(a.change_24h)} ━━━
${techSection}

${slTpGuide}

${prevBlock}

  News (last 2h):
${newsLines}
  Whale activity:
${whaleLine}`
  }).join('\n\n')

  const perfBlock = performance ? '\n' + formatPerformanceForPrompt(performance) + '\n' : ''

  return `You are an elite futures signal engine operating like a top-tier prop trader. Every asset gets a signal every 30 minutes — the next candle is where the trade plays out.

Time: ${now}
Session: ${session.name} [${session.quality}] — ${session.note}
${perfBlock}

${assetBlocks}

━━━ YOUR JOB ━━━

For EVERY asset, pick the highest-probability direction for the next 30 minutes and output a signal.
Only set confidence=0.0 if price action is genuinely ranging with zero directional edge (rare).

DIRECTION — use all context in order:
  1. Weekly bias + 24h structure: if both agree, that's your direction.
  2. EMA stack (8/21/50): bullish stack → long bias, bearish stack → short bias.
  3. RSI: extreme overbought (≥70) favours short, extreme oversold (≤30) favours long.
  4. Momentum: 30m and 1h momentum pointing the same way confirms direction.
  5. Session: HIGH/PEAK sessions — trust momentum breakouts. LOW sessions — fade extremes.
  6. News/whales: strong catalyst overrides weak TA. No catalyst → pure TA read.

TP/SL — use the pre-computed ATR-based levels:
  • R/R is 1.5:1 — TP is 1.5× the SL distance. Target $100–200 price move for BTC-scale assets.
  • Keep TP tight and realistic for 30 min — do NOT set targets hundreds of dollars beyond entry.
  • Use the pre-computed levels as-is. Only adjust if a swing level sits directly in the path.
  • TP must be on the profit side, SL on the loss side. Never swap them.

PREVIOUS SIGNAL — if the previous trade is winning and structure hasn't changed, keep direction.

LEVERAGE & SIZING:
  • Strong setup (weekly + structure + EMA all agree): 100–200x crypto / 30–50x gold
  • Good setup (2–3 factors agree): 50–100x crypto / 15–30x gold
  • Weak setup (mixed signals, session noise): 20–50x crypto / 10–15x gold
  • portfolio_pct: 3–7

CONFIDENCE:
  • 0.8–1.0: all HTF + session + TA aligned
  • 0.6–0.79: majority of signals agree
  • 0.5–0.59: mixed but best available direction
  • 0.0: only if genuinely no edge (flat range, zero momentum, zero news)

reasoning: 1 sentence — what the dominant signal is and why this direction wins right now.

Respond ONLY with valid JSON. No markdown. No explanation outside JSON.
Include ALL assets — use confidence=0.0 for skipped ones (they will be filtered out automatically).
{
  "signals": [
    {
      "symbol": "ASSET/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 2356.00,
      "sl": 2315.00,
      "market_price": 2338.00,
      "confidence": 0.75,
      "reasoning": "EMA50 bullish trend, RSI 42 rising from near-oversold with strong support at 2318. News confirms positive sentiment — long targeting 1.5:1 R/R."
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

        // Enforce minimum stop distance and 1.5:1 R/R
        const isGold = sig.symbol === 'XAU/USD'
        const minSlPct = isGold ? 0.0005 : 0.001
        const slDist = Math.abs(price - sl)
        const tpDist = Math.abs(tp - price)
        const rr = tpDist / slDist

        if (slDist / price < minSlPct) {
          // Stop too tight — expand to minimum and reset TP to 1.5:1
          const newSlDist = price * minSlPct
          sl = sig.direction === 'long' ? price - newSlDist : price + newSlDist
          tp = sig.direction === 'long' ? price + newSlDist * 1.5 : price - newSlDist * 1.5
          console.warn(`[signals] Expanded ${sig.symbol} SL to min ${(minSlPct*100).toFixed(2)}%, reset TP to 1.5:1`)
        } else if (rr > 2.5) {
          // TP is unrealistically far — pull it in to 1.5:1
          tp = sig.direction === 'long' ? price + slDist * 1.5 : price - slDist * 1.5
          console.warn(`[signals] Pulled in ${sig.symbol} TP from ${rr.toFixed(2)}:1 to 1.5:1`)
        }

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
