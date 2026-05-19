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
  resistances: number[]
  supports: number[]
  nearestResistance: number
  nearestSupport: number
  ema8: number
  ema21: number
  ema50: number
  emaTrend: 'bullish' | 'bearish' | 'neutral'
  priceVsEma21: number
  rsi: number
  rsiZone: 'overbought' | 'oversold' | 'neutral'
  momentum30m: number
  momentum1h: number
  atr: number
  atrPct: number
  volumeRatio: number
  suggestedSlLong: number
  suggestedSlShort: number
  priceStructure: 'uptrend' | 'downtrend' | 'sideways'
  weeklyBias: 'bullish' | 'bearish' | 'neutral'
  fundingRate: number | null
  sma4h: number
  priceVsSma: number
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
