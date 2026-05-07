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

  // Hard blocks
  const blockLong = ind.rsiZone === 'overbought' ? `RSI ${ind.rsi.toFixed(0)} is OVERBOUGHT — do not go long` : null
  const blockShort = ind.rsiZone === 'oversold' ? `RSI ${ind.rsi.toFixed(0)} is OVERSOLD — do not go short` : null

  return { biasDirection, biasScore, biasReasons: reasons, blockLong, blockShort }
}

function buildPrompt(assets: MarketData[]): string {
  const now = new Date().toUTCString()

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

      techSection = `  TECHNICAL SUMMARY:
    Bias       : ${bias.biasDirection} (${bias.biasScore}/4 signals agree)
    Signals    :
      ${bias.biasReasons.map(r => `• ${r}`).join('\n      ')}
    EMA        : EMA8=${plain(ind.ema8)} | EMA21=${plain(ind.ema21)} | EMA50=${plain(ind.ema50)} → ${ind.emaTrend.toUpperCase()}
    RSI(14)    : ${ind.rsi.toFixed(1)} [${ind.rsiZone.toUpperCase()}]${ind.rsiZone !== 'neutral' ? ' ← HARD CONSTRAINT BELOW' : ''}
    Volume     : ${vol}
    24h Range  : ${plain(ind.low24h)} — ${plain(ind.high24h)}
    Resistance : ${ind.resistances.map(plain).join(' | ') || 'none found'} ${ind.nearestResistance ? `(nearest: ${plain(ind.nearestResistance)}, ${(((ind.nearestResistance - a.price) / a.price) * 100).toFixed(3)}% away)` : ''}
    Support    : ${ind.supports.map(plain).join(' | ') || 'none found'} ${ind.nearestSupport ? `(nearest: ${plain(ind.nearestSupport)}, ${(((a.price - ind.nearestSupport) / a.price) * 100).toFixed(3)}% away)` : ''}
    ATR(5-min) : ${plain(ind.atr)} (${ind.atrPct.toFixed(4)}% per 5 min)`

      // Pre-compute TP/SL scenarios based on swing levels
      const atr = ind.atr
      const longTp = ind.nearestResistance > a.price ? ind.nearestResistance - atr * 0.5 : a.price * 1.003
      const longSl = ind.suggestedSlLong < a.price ? ind.suggestedSlLong : a.price - atr * 2
      const shortTp = ind.nearestSupport < a.price ? ind.nearestSupport + atr * 0.5 : a.price * 0.997
      const shortSl = ind.suggestedSlShort > a.price ? ind.suggestedSlShort : a.price + atr * 2
      const longRR = longTp > a.price && longSl < a.price ? ((longTp - a.price) / (a.price - longSl)).toFixed(2) : 'N/A'
      const shortRR = shortTp < a.price && shortSl > a.price ? ((a.price - shortTp) / (shortSl - a.price)).toFixed(2) : 'N/A'

      slTpGuide = `  PRE-COMPUTED TP/SL (use these, adjust only slightly if justified):
    IF LONG : TP=${plain(longTp)} | SL=${plain(longSl)} | R/R=${longRR}:1
    IF SHORT: TP=${plain(shortTp)} | SL=${plain(shortSl)} | R/R=${shortRR}:1
    (SL placed beyond swing levels + 1 ATR buffer — do NOT tighten the SL)`

      const trendDir = a.price >= ind.ema50 ? 'LONG' : 'SHORT'
      slTpGuide += `\n  📈 TREND DIRECTION (EMA50): ${trendDir} only — trading counter-trend is low probability`
      if (bias.blockLong) slTpGuide += `\n  ⛔ BLOCKED: ${bias.blockLong}`
      if (bias.blockShort) slTpGuide += `\n  ⛔ BLOCKED: ${bias.blockShort}`
      if (bias.biasScore < 3) slTpGuide += `\n  ⚠ LOW SETUP QUALITY: bias score ${bias.biasScore}/4 — SKIP this asset (set confidence=0.0)`
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

${assetBlocks}

━━━ DECISION RULES (follow in order) ━━━

RULE 1 — TREND FILTER (hard rule, no exceptions):
  • Price ABOVE EMA50 → LONG only. Do NOT short an uptrend.
  • Price BELOW EMA50 → SHORT only. Do NOT long a downtrend.
  • Exception: RSI extreme (≤25 oversold in downtrend, ≥75 overbought in uptrend) → counter-trend allowed but confidence must be ≤0.55 and lower leverage.

RULE 2 — MINIMUM SETUP QUALITY:
  • Bias score 3–4/4 → take the trade (high probability)
  • Bias score 2/4 → SKIP. Set confidence=0.0. Not enough confluence.
  • Bias score 0–1/4 → SKIP. Set confidence=0.0. Market is uncertain.
  • Neutral EMA trend with bias score ≤2 → SKIP.

RULE 3 — TP MUST BE AT LEAST 2× THE SL DISTANCE (2:1 R/R minimum):
  • If pre-computed levels don't give 2:1, extend TP to the next swing level.
  • NEVER move SL closer to entry to fake a good R/R — wider SL is ok.
  • A signal with 1:1 R/R is not worth taking — skip it.

RULE 4 — USE PRE-COMPUTED TP/SL:
  • The TP/SL levels are anchored to real swing levels. Use them.
  • Only extend TP further if there is a clear next level. Never tighten SL.

RULE 5 — PREVIOUS SIGNAL:
  • If the previous signal is WINNING and trend hasn't changed → keep same direction.
  • Do not flip direction just because 30 min passed.

LEVERAGE & SIZING:
  • Bias 4/4 + news confirms: 100–200x crypto / 30–50x gold
  • Bias 3/4: 50x crypto / 20x gold
  • Counter-trend exception: max 20x crypto / 10x gold
  • portfolio_pct: 3–7

CONFIDENCE:
  • 0.8–1.0: bias 4/4, trend aligned, news confirms
  • 0.6–0.79: bias 3/4, trend aligned
  • 0.5–0.59: counter-trend exception only
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
        if (sig.confidence < 0.5) {
          console.log(`[signals] Skipped ${sig.symbol}: low confidence (${sig.confidence})`)
          return null
        }

        if (!tpOk || !slOk || !tpSide || !slSide) {
          console.warn(`[signals] Dropped ${sig.symbol}: bad TP/SL (price=${price}, tp=${tp}, sl=${sl})`)
          return null
        }

        // Enforce minimum 2:1 R/R
        const reward = Math.abs(tp - price)
        const risk = Math.abs(sl - price)
        if (reward / risk < 2.0) {
          console.warn(`[signals] Dropped ${sig.symbol}: R/R ${(reward/risk).toFixed(2)}:1 < 2:1 minimum`)
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
