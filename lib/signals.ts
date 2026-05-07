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

      if (bias.blockLong) slTpGuide += `\n  ⛔ BLOCKED: ${bias.blockLong}`
      if (bias.blockShort) slTpGuide += `\n  ⛔ BLOCKED: ${bias.blockShort}`
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

  return `You are a systematic trading signal engine. Your job is simple: the technical analysis is already done for you. Just confirm or override the bias based on news/whale data, then output the signal.

Time: ${now}

${assetBlocks}

YOUR TASK FOR EACH ASSET:
1. Read the TECHNICAL BIAS — it tells you what the chart says
2. Read the NEWS + WHALE data — does it confirm or contradict the bias?
3. If confirmed → use the bias direction, use the pre-computed TP/SL
4. If contradicted by strong news → override, explain why
5. If BLOCKED by RSI constraint → obey it, no exceptions
6. If previous signal is WINNING → maintain direction unless strongly contradicted

OUTPUT RULES:
- Use the pre-computed TP/SL values. Only deviate if there is a specific level-based reason.
- NEVER tighten the SL to less than the pre-computed value (wider is ok, tighter causes SL hits)
- leverage: bias score 4/4 → 100-200x crypto/30-50x gold | 3/4 → 50x crypto/20x gold | 2/4 → 20x crypto/10x gold | 1/4 → 10x crypto/5x gold
- portfolio_pct: 3–7
- confidence: 0.0–1.0 based on bias score + news confluence
- reasoning: 2 sentences max — what the chart showed, whether news confirmed or contradicted

Respond ONLY with valid JSON. No markdown. No explanation outside JSON.
{
  "signals": [
    {
      "symbol": "ASSET/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 2355.00,
      "sl": 2318.00,
      "market_price": 2338.00,
      "confidence": 0.72,
      "reasoning": "EMA stack bullish and RSI at 38 approaching oversold with support at 2320. No contradicting news — maintaining long bias with SL below swing support."
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

        if (!tpOk || !slOk || !tpSide || !slSide) {
          console.warn(`[signals] Dropped ${sig.symbol}: bad TP/SL (price=${price}, tp=${tp}, sl=${sl})`)
          return null
        }

        // Enforce minimum R/R of 1.2:1
        const reward = Math.abs(tp - price)
        const risk = Math.abs(sl - price)
        if (reward / risk < 1.2) {
          console.warn(`[signals] Dropped ${sig.symbol}: R/R too low (${(reward/risk).toFixed(2)}:1)`)
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
