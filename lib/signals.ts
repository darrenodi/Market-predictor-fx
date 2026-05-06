import Anthropic from '@anthropic-ai/sdk'
import { MarketData } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

      const priceFmt =
        a.price < 1 ? a.price.toFixed(6) : a.price.toLocaleString('en-US', { minimumFractionDigits: 2 })

      const whaleLine =
        a.whales.length > 0
          ? a.whales.map(w => `  • ${w.title}`).join('\n')
          : '  • No large transactions detected'

      return `${a.symbol}
  Price : $${priceFmt}
  24h   : ${a.change_24h >= 0 ? '+' : ''}${a.change_24h.toFixed(2)}%
  News  :
${newsLines}
  Whale Transactions (large on-chain moves) :
${whaleLine}`
    })
    .join('\n\n')

  return `You are a professional derivatives trading analyst. Analyse the market data and news below, then produce precise trading signals for each asset.

${assetBlocks}

Rules:
- direction: "long" if bullish, "short" if bearish
- leverage: scale with confidence — high (>75%): 50-500x crypto / 20-200x gold; medium (50-75%): 20-50x crypto / 10-20x gold; low (<50%): 10-20x / 5-10x
- portfolio_pct: 3-7 (how much of portfolio to allocate, in %)
- tp/sl: set based on recent volatility — typically 0.5-2% from entry for crypto, 0.3-0.8% for gold
- confidence: 0.0 to 1.0
- reasoning: one sentence max

Respond with ONLY valid JSON — no markdown, no extra text:
{
  "signals": [
    {
      "symbol": "BTC/USD",
      "direction": "long",
      "leverage": 50,
      "portfolio_pct": 5,
      "tp": 79000,
      "sl": 77000,
      "market_price": 78000,
      "confidence": 0.75,
      "reasoning": "Positive ETF inflow news supports upward momentum."
    }
  ]
}`
}

export async function generateSignals(assets: MarketData[]): Promise<GeneratedSignal[]> {
  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(assets) }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude returned no JSON')

  const parsed = JSON.parse(jsonMatch[0]) as { signals: GeneratedSignal[] }
  return parsed.signals
}
