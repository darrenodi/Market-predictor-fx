export interface Signal {
  id: string
  symbol: string
  direction: 'long' | 'short'
  leverage: number
  portfolio_pct: number
  tp: number
  sl: number
  market_price: number
  confidence: number
  reasoning: string
  status: 'active' | 'tp_hit' | 'sl_hit' | 'expired'
  tp_hit_at?: string
  sl_hit_at?: string
  created_at: string
  updated_at: string
}

export interface PriceInfo {
  price: number
  change_24h: number
  history: number[]
}

export interface NewsItem {
  title: string
  description: string
  link: string
  pubDate: string
  source: string
}

export interface CurrentSignal {
  direction: 'long' | 'short'
  entry: number
  tp: number
  sl: number
  confidence: number
  ageMinutes: number
}

export interface TechnicalIndicators {
  high24h: number
  low24h: number
  distFromHigh: number
  distFromLow: number
  sma4h: number
  priceVsSma: number
  momentum1h: number
  momentum4h: number
  avgHourlyVol: number
  trend: 'up' | 'down' | 'sideways'
}

export interface MarketData {
  symbol: string
  price: number
  change_24h: number
  news: Array<{ title: string; description: string }>
  whales: Array<{ title: string }>
  currentSignal: CurrentSignal | null
  indicators: TechnicalIndicators | null
}
