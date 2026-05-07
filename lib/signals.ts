import { GoogleGenerativeAI } from '@google/generative-ai'
import { MarketData, TechnicalIndicators } from '@/types'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

// Free tier models in preference order — falls through on quota / rate-limit errors
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.0-flash',
  'gemini-3.1-flash-lite',
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

// Plain number formatter — NO commas, no locale formatting (commas confuse the AI)
function plain(n: number): string {
  if (n < 0.0001) return n.toFixed(8)
  if (n < 1) return n.toFixed(6)
  return n.toFixed(2)
}

function formatIndicators(ind: TechnicalIndicators | null): string {
  if (!ind) return '  Technicals: insufficient data'
  const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(3) + '%'
  const nearHigh = ind.distFromHigh > -0.5
  const nearLow = ind.distFromLow < 0.5
  return `  Technicals:
    24h High : ${plain(ind.high24h)} (${pct(ind.distFromHigh)} from here)${nearHigh ? ' ← RESISTANCE' : ''}
    24h Low  : ${plain(ind.low24h)} (${pct(ind.distFromLow)} from here)${nearLow ? ' ← SUPPORT' : ''}
    4h SMA   : ${plain(ind.sma4h)} (price is ${pct(ind.priceVsSma)} vs SMA → trend: ${ind.trend.toUpperCase()})
    Momentum : 1h ${pct(ind.momentum1h)} | 4h ${pct(ind.momentum4h)}
    Avg hourly volatility: ${ind.avgHourlyVol.toFixed(3)}% (calibrate TP/SL to this)`
}

function buildPrompt(assets: MarketData[]): string {
  const assetBlocks = assets
    .map(a => {
      const newsLines =
        a.news.length > 0
          ? a.news.map(n => `  • ${n.title}: ${n.description}`).join('\n')
          : '  • No recent news'

      const whaleLine =
        a.whales.length > 0
          ? a.whales.map(w => `  • ${w.title}`).join('\n')
          : '  • No large transactions detected'

      let prevBlock = '  Previous signal: None'
      if (a.currentSignal) {
        const s = a.currentSignal
        const pnlPct = ((a.price - s.entry) / s.entry) * 100 * (s.direction === 'long' ? 1 : -1)
        const distToTp = Math.abs(((s.tp - a.price) / a.price) * 100).toFixed(3)
        const distToSl = Math.abs(((s.sl - a.price) / a.price) * 100).toFixed(3)
        prevBlock = `  Previous signal (${s.ageMinutes} min ago): ${s.direction.toUpperCase()} @ ${plain(s.entry)}
  TP: ${plain(s.tp)} (${distToTp}% away) | SL: ${plain(s.sl)} (${distToSl}% away)
  Current P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(3)}% — trade is ${pnlPct >= 0 ? 'WINNING' : 'LOSING'}`
      }

      const techBlock = formatIndicators(a.indicators)

      return `${a.symbol}
  Price    : ${plain(a.price)}
  24h      : ${a.change_24h >= 0 ? '+' : ''}${a.change_24h.toFixed(2)}%
${techBlock}
${prevBlock}
  News  :
${newsLines}
  Whale Transactions :
${whaleLine}`
    })
    .join('\n\n')

  return `You are an experienced short-term derivatives trader. You think in price structure, momentum, and confluence — not just news. Review the data below and produce a 30-minute scalp signal for each asset.

${assetBlocks}

HOW TO THINK (in order):
1. STRUCTURE FIRST: Where is price relative to the 24h high/low? If price is at resistance → bias short. If at support → bias long. Never fight a key level without strong confluence.
2. MOMENTUM: Is the 1h and 4h momentum aligned with your bias? Fading momentum = lower confidence.
3. TREND: Is price above or below the 4h SMA? Trading with the trend = higher probability.
4. CONFLUENCE: Do technicals AND news/whales agree? Both aligned = high confidence. Conflicting = lower confidence or skip.
5. CONSISTENCY: If a previous signal is WINNING, maintain it. Only flip if structure has clearly changed.

RULES:
- TP/SL must be calibrated to avg hourly volatility provided. TP should be ~1× to 2× the avg hourly vol. SL should be ~0.5× to 1× avg hourly vol. Minimum risk/reward ratio: 1.5:1.
- Do NOT place a long signal when price is within 0.3% of the 24h high without a very strong breakout reason.
- Do NOT place a short signal when price is within 0.3% of the 24h low without a very strong breakdown reason.
- direction: "long" or "short" — never default. Go where structure and momentum point.
- leverage: high confidence (>75%): 50-200x crypto, 20-50x gold; medium: 20-50x crypto, 10-20x gold; low: 10-20x crypto, 5-10x gold
- portfolio_pct: 3-7
- confidence: 0.0–1.0, honest — low if technicals and news conflict
- reasoning: 2 sentences. Sentence 1: structure/momentum reading. Sentence 2: news/whale confluence and final direction rationale.

Respond with ONLY valid JSON — no markdown, no extra text:
{
  "signals": [
    {
      "symbol": "BTC/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 78390,
      "sl": 77820,
      "market_price": 78000,
      "confidence": 0.72,
      "reasoning": "Whale outflows from exchanges continue and ETF inflow news remains positive. Maintaining long as price is 0.2% from TP with no material change in conditions."
    }
  ]
}`
}

function isRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('too many requests')
  )
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

      // Sanity check: TP and SL must be within 5% of market price and on the correct side
      const validated = parsed.signals.filter(sig => {
        const tpDev = Math.abs((sig.tp - sig.market_price) / sig.market_price)
        const slDev = Math.abs((sig.sl - sig.market_price) / sig.market_price)
        const tpCorrectSide = sig.direction === 'long' ? sig.tp > sig.market_price : sig.tp < sig.market_price
        const slCorrectSide = sig.direction === 'long' ? sig.sl < sig.market_price : sig.sl > sig.market_price
        const ok = tpDev <= 0.05 && slDev <= 0.05 && tpCorrectSide && slCorrectSide
        if (!ok) console.warn(`[signals] Dropped ${sig.symbol}: invalid TP/SL (price=${sig.market_price}, tp=${sig.tp}, sl=${sig.sl})`)
        return ok
      })

      console.log(`[signals] generated ${validated.length}/${parsed.signals.length} valid signals with ${modelId}`)
      return validated
    } catch (err) {
      lastError = err
      if (isRateLimitError(err)) {
        console.warn(`[signals] ${modelId} rate limited, trying next model`)
        continue
      }
      // Non-rate-limit errors (bad JSON, model error) — still try next
      console.warn(`[signals] ${modelId} failed: ${err}, trying next model`)
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError}`)
}
