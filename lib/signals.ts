import { GoogleGenerativeAI } from '@google/generative-ai'
import { MarketData } from '@/types'

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

      const priceFmt = (n: number) =>
        n < 1 ? n.toFixed(6) : n.toLocaleString('en-US', { minimumFractionDigits: 2 })

      let prevBlock = '  Previous signal: None'
      if (a.currentSignal) {
        const s = a.currentSignal
        const pnlPct = ((a.price - s.entry) / s.entry) * 100 * (s.direction === 'long' ? 1 : -1)
        const distToTp = Math.abs(((s.tp - a.price) / a.price) * 100).toFixed(3)
        const distToSl = Math.abs(((s.sl - a.price) / a.price) * 100).toFixed(3)
        prevBlock = `  Previous signal (${s.ageMinutes} min ago): ${s.direction.toUpperCase()} @ $${priceFmt(s.entry)}
  TP: $${priceFmt(s.tp)} (${distToTp}% away) | SL: $${priceFmt(s.sl)} (${distToSl}% away)
  Current P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(3)}% — trade is ${pnlPct >= 0 ? 'WINNING' : 'LOSING'}`
      }

      return `${a.symbol}
  Price : $${priceFmt(a.price)}
  24h   : ${a.change_24h >= 0 ? '+' : ''}${a.change_24h.toFixed(2)}%
${prevBlock}
  News  :
${newsLines}
  Whale Transactions :
${whaleLine}`
    })
    .join('\n\n')

  return `You are a professional short-term derivatives trading analyst specialising in 30-minute scalp trades. Review the current market data including any PREVIOUS signals that are still open.

${assetBlocks}

CRITICAL RULES:
1. CONSISTENCY: If a previous signal exists and the trade is WINNING (moving toward TP), you MUST maintain the same direction. Do NOT flip just because 30 minutes passed. Only reverse if conditions have materially changed (major negative news, whale reversal, clear trend break).
2. TIMEFRAME: TP and SL must be reachable within 30 minutes from current price.
3. TP/SL distance from current price:
   - Crypto (BTC/ETH): 0.15% – 0.5%
   - Gold (XAU): 0.08% – 0.2%
   - Meme coins: 0.3% – 0.8%
4. DIRECTION: Choose "long" or "short" based on data. Go short if momentum is bearish, news negative, or whales selling. Do NOT default to long.
5. leverage: high confidence (>75%): 50-200x crypto, 20-50x gold; medium: 20-50x crypto, 10-20x gold; low: 10-20x crypto, 5-10x gold
6. portfolio_pct: 3-7
7. confidence: honest 0.0–1.0, do not inflate
8. reasoning: 2 sentences. Sentence 1: what the data shows. Sentence 2: why you maintained OR changed direction vs previous signal.

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
      console.log(`[signals] generated with ${modelId}`)
      return parsed.signals
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
