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

      const priceFmt =
        a.price < 1
          ? a.price.toFixed(6)
          : a.price.toLocaleString('en-US', { minimumFractionDigits: 2 })

      return `${a.symbol}
  Price : $${priceFmt}
  24h   : ${a.change_24h >= 0 ? '+' : ''}${a.change_24h.toFixed(2)}%
  News  :
${newsLines}
  Whale Transactions (large on-chain moves) :
${whaleLine}`
    })
    .join('\n\n')

  return `You are a professional short-term derivatives trading analyst specialising in 30-minute scalp trades. Analyse the market data, news, and whale transactions below, then produce a precise trading signal for each asset.

${assetBlocks}

CRITICAL RULES:
- These are 30-MINUTE scalp trades. TP and SL must be reachable within 30 minutes.
- direction: you MUST choose "long" OR "short" based purely on the data — do NOT default to long. If momentum is bearish, news is negative, or whales are selling, go short.
- tp/sl distance from entry:
    Crypto (BTC/ETH): 0.15% – 0.5%
    Gold (XAU): 0.08% – 0.2%
    Meme coins: 0.3% – 0.8%
- leverage: high confidence (>75%): 50-200x crypto, 20-50x gold; medium (50-75%): 20-50x crypto, 10-20x gold; low (<50%): 10-20x crypto, 5-10x gold
- portfolio_pct: 3-7
- confidence: 0.0 to 1.0 — be honest, do not inflate
- reasoning: 2 sentences max. First sentence: what the data shows (news/whale signal). Second sentence: why that leads to your direction call.

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
      "reasoning": "Large BTC outflow from Coinbase and bullish ETF inflow news signal institutional accumulation. Momentum favours a long scalp targeting 0.5% upside within 30 minutes."
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
