import { GoogleGenerativeAI } from '@google/generative-ai'
import { MarketData, TechnicalIndicators } from '@/types'

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
  if (h >= 8 && h < 13) return { name: 'London', quality: 'HIGH', note: 'European open — strong momentum moves, good for breakouts' }
  if (h >= 21 || h < 2) return { name: 'Post-NY / Pre-Asia', quality: 'LOW', note: 'Thin volume — choppy price action, avoid breakouts, range-play only' }
  return { name: 'Asia', quality: 'LOW', note: 'Reduced volume — tight ranges, fake breakouts common, prefer counter-trend fades' }
}

function buildPrompt(assets: MarketData[]): string {
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

      // ATR-based TP/SL for 30-min scalps (not swing-level — that's for swing trades)
      // SL = 1.5× ATR, TP = 3× ATR → automatic 2:1 R/R
      const atr = ind.atr
      const longTp  = a.price + atr * 3
      const longSl  = a.price - atr * 1.5
      const shortTp = a.price - atr * 3
      const shortSl = a.price + atr * 1.5

      // Cap TP at nearest swing level so we don't reach past resistance
      const cappedLongTp  = ind.nearestResistance > a.price && ind.nearestResistance < longTp ? ind.nearestResistance - atr * 0.3 : longTp
      const cappedShortTp = ind.nearestSupport > 0 && ind.nearestSupport > shortTp ? ind.nearestSupport + atr * 0.3 : shortTp

      const trendDir = a.price >= ind.ema50 ? 'LONG' : 'SHORT'
      const trendNote = `preferred direction: ${trendDir} (price ${a.price >= ind.ema50 ? 'above' : 'below'} EMA50 — counter-trend needs strong confluence)`

      slTpGuide = `  PRE-COMPUTED TP/SL for 30-min scalp (ATR-based, 2:1 R/R built in):
    IF LONG : TP=${plain(cappedLongTp)} | SL=${plain(longSl)} | R/R=2:1
    IF SHORT: TP=${plain(cappedShortTp)} | SL=${plain(shortSl)} | R/R=2:1
    ATR=${plain(atr)} (each TP is 3×ATR, each SL is 1.5×ATR from entry)
    Nearby swing levels for context — nearest resistance: ${plain(ind.nearestResistance)} | nearest support: ${plain(ind.nearestSupport)}
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

  return `You are a disciplined systematic trading signal engine. Your primary goal is TP hits — it is far better to skip a trade than to enter a bad one.

Time: ${now}
Session: ${session.name} [${session.quality}] — ${session.note}

${assetBlocks}

━━━ DECISION RULES (follow in order) ━━━

RULE 0 — SESSION FILTER:
  • PEAK / HIGH session (London, NY, Overlap): full confidence. Trust breakouts and momentum.
  • LOW session (Asia, Post-NY): reduce confidence by 0.1. Prefer range-fade entries over breakouts. Tighten bias requirement to 3/4 minimum.

RULE 1 — HTF ALIGNMENT (weekly bias + 24h structure):
  • Weekly BULLISH + structure UPTREND → strong long bias. Need 3+ bear signals to go short.
  • Weekly BEARISH + structure DOWNTREND → strong short bias. Need 3+ bull signals to go long.
  • Weekly and 24h structure conflict → neutral, defer to the 4-signal bias score.
  • Price ABOVE EMA50 → prefer LONG. Counter-trend short needs 3+ bear signals.
  • Price BELOW EMA50 → prefer SHORT. Counter-trend long needs 3+ bull signals.
  • RSI extreme (≤25 or ≥75) → counter-trend allowed at any bias score ≥2.

RULE 2 — MINIMUM SETUP QUALITY:
  • Bias score 3–4/4 → take the trade (high probability)
  • Bias score 2/4 → take the trade if news or whale activity adds confluence
  • Bias score 0–1/4 → SKIP. Set confidence=0.0. Market is too uncertain.

RULE 3 — TP MUST BE AT LEAST 1.5× THE SL DISTANCE (1.5:1 R/R minimum):
  • Use the pre-computed ATR-based TP/SL — they give 2:1 by default.
  • Only tighten TP if a swing level blocks the way. Never move SL closer to fake R/R.
  • A 1:1 or worse R/R is not worth taking — skip it.

RULE 4 — USE PRE-COMPUTED TP/SL:
  • The TP/SL levels are ATR-based (3×ATR TP, 1.5×ATR SL). Use them unchanged.
  • Only cap TP at a swing level if price is close to resistance/support.

RULE 5 — PREVIOUS SIGNAL:
  • If the previous signal is WINNING and trend hasn't changed → keep same direction.
  • Do not flip direction just because 30 min passed.

LEVERAGE & SIZING:
  • Bias 4/4 + news confirms: 100–200x crypto / 30–50x gold
  • Bias 3/4: 50–100x crypto / 20–30x gold
  • Bias 2/4 with news: 30–50x crypto / 10–20x gold
  • portfolio_pct: 3–7

CONFIDENCE:
  • 0.8–1.0: bias 4/4, trend aligned, news confirms
  • 0.65–0.79: bias 3/4, trend aligned
  • 0.5–0.64: bias 2/4 with news catalyst, or counter-trend with strong RSI extreme
  • 0.45–0.49: valid but weak — only take if no better setup exists
  • 0.0: skip — no signal this round

reasoning: 2 sentences. Sentence 1: what the chart structure shows. Sentence 2: what news/whales add, and why you took or skipped.

Respond ONLY with valid JSON. No markdown. No explanation outside JSON.
Include ALL assets — use confidence=0.0 for skipped ones (they will be filtered out automatically).
{
  "signals": [
    {
      "symbol": "ASSET/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 2368.00,
      "sl": 2315.00,
      "market_price": 2338.00,
      "confidence": 0.75,
      "reasoning": "EMA50 bullish trend, RSI 42 rising from near-oversold with strong support at 2318. News confirms positive sentiment — long with 2.3:1 R/R anchored to swing levels."
    }
  ]
}`
}

function isRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
         msg.includes('resource exhausted') || msg.includes('too many requests')
}

export async function generateSignals(assets: MarketData[]): Promise<GeneratedSignal[]> {
  const prompt = buildPrompt(assets)
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

        const tpOk = Math.abs((tp - price) / price) <= 0.08
        const slOk = Math.abs((sl - price) / price) <= 0.08
        const tpSide = sig.direction === 'long' ? tp > price : tp < price
        const slSide = sig.direction === 'long' ? sl < price : sl > price

        // Drop skipped signals (confidence=0)
        if (sig.confidence < 0.45) {
          console.log(`[signals] Skipped ${sig.symbol}: low confidence (${sig.confidence})`)
          return null
        }

        if (!tpOk || !slOk || !tpSide || !slSide) {
          console.warn(`[signals] Dropped ${sig.symbol}: bad TP/SL (price=${price}, tp=${tp}, sl=${sl})`)
          return null
        }

        // Enforce minimum 1.5:1 R/R
        const reward = Math.abs(tp - price)
        const risk = Math.abs(sl - price)
        if (reward / risk < 1.5) {
          console.warn(`[signals] Dropped ${sig.symbol}: R/R ${(reward/risk).toFixed(2)}:1 < 1.5:1 minimum`)
          return null
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
