// CoinGecko IDs — covers crypto + PAXG (1:1 gold proxy, no separate gold API needed)
const GECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XAU: 'pax-gold',
  DOGE: 'dogecoin',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  SHIB: 'shiba-inu',
  BONK: 'bonk',
  FLOKI: 'floki',
  SOL: 'solana',
  TRUMP: 'maga',
}

export type PriceMap = Record<string, { price: number; change_24h: number }>

export interface TechnicalIndicators {
  // Structure
  high24h: number
  low24h: number
  distFromHigh: number    // % distance from 24h high (negative = below)
  distFromLow: number     // % distance from 24h low (positive = above)
  resistances: number[]   // nearest swing highs above price
  supports: number[]      // nearest swing lows below price
  nearestResistance: number
  nearestSupport: number
  // Trend
  ema8: number
  ema21: number
  ema50: number
  emaTrend: 'bullish' | 'bearish' | 'neutral'
  priceVsEma21: number    // % above/below ema21
  // Momentum
  rsi: number
  rsiZone: 'overbought' | 'oversold' | 'neutral'
  momentum30m: number
  momentum1h: number
  // Volatility & volume
  atr: number             // avg 5-min true range in price units
  atrPct: number          // ATR as % of price
  volumeRatio: number     // recent 30m volume vs 24h avg (1.0 = normal)
  // SL guidance
  suggestedSlLong: number   // just below nearest support
  suggestedSlShort: number  // just above nearest resistance
  // HTF context
  priceStructure: 'uptrend' | 'downtrend' | 'sideways'  // HH/HL pattern on 12h view
  weeklyBias: 'bullish' | 'bearish' | 'neutral'          // 7-day direction
  // Legacy aliases (used by formatIndicators)
  sma4h: number
  priceVsSma: number
  momentum4h: number
  avgHourlyVol: number
  trend: 'up' | 'down' | 'sideways'
}

// ─── Indicator math ────────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return []
  const k = 2 / (period + 1)
  const emas = [prices[0]]
  for (let i = 1; i < prices.length; i++) {
    emas.push(prices[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50
  const changes = prices.slice(1).map((p, i) => p - prices[i])
  // Wilder's smoothing
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss -= changes[i]
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

function calcATR(prices: number[], period = 14): number {
  // Approximate TR as |close[i] - close[i-1]| (no OHLCV available)
  const ranges = prices.slice(1).map((p, i) => Math.abs(p - prices[i]))
  const recent = ranges.slice(-period)
  return recent.length === 0 ? 0 : recent.reduce((a, b) => a + b, 0) / recent.length
}

function findSwings(prices: number[], currentPrice: number, lookback = 5) {
  const highs: number[] = []
  const lows: number[] = []
  for (let i = lookback; i < prices.length - lookback; i++) {
    const window = prices.slice(i - lookback, i + lookback + 1)
    if (prices[i] === Math.max(...window)) highs.push(prices[i])
    if (prices[i] === Math.min(...window)) lows.push(prices[i])
  }
  const resistances = [...new Set(highs)]
    .filter(h => h > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 3)
  const supports = [...new Set(lows)]
    .filter(l => l < currentPrice)
    .sort((a, b) => b - a)
    .slice(0, 3)
  return { resistances, supports }
}

export function computeIndicators(
  prices: number[],
  volumes: number[],
  currentPrice: number,
  weeklyPrices: number[] = [],
): TechnicalIndicators | null {
  if (prices.length < 50) return null

  const all = [...prices, currentPrice]
  const n = all.length

  // Structure
  const high24h = Math.max(...all)
  const low24h = Math.min(...all)
  const distFromHigh = ((currentPrice - high24h) / high24h) * 100
  const distFromLow = ((currentPrice - low24h) / low24h) * 100
  const { resistances, supports } = findSwings(prices, currentPrice)
  const nearestResistance = resistances[0] ?? high24h
  const nearestSupport = supports[0] ?? low24h

  // EMAs (on full price series)
  const ema8arr = calcEMA(all, 8)
  const ema21arr = calcEMA(all, 21)
  const ema50arr = calcEMA(all, 50)
  const ema8 = ema8arr[ema8arr.length - 1]
  const ema21 = ema21arr[ema21arr.length - 1]
  const ema50 = ema50arr[ema50arr.length - 1]
  const priceVsEma21 = ((currentPrice - ema21) / ema21) * 100
  const emaTrend: TechnicalIndicators['emaTrend'] =
    ema8 > ema21 && ema21 > ema50 ? 'bullish' :
    ema8 < ema21 && ema21 < ema50 ? 'bearish' : 'neutral'

  // RSI
  const rsi = calcRSI(all, 14)
  const rsiZone: TechnicalIndicators['rsiZone'] =
    rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'

  // Momentum (5-min candles: 6=30m, 12=1h)
  const price30mAgo = all[Math.max(0, n - 7)]
  const price1hAgo = all[Math.max(0, n - 13)]
  const momentum30m = ((currentPrice - price30mAgo) / price30mAgo) * 100
  const momentum1h = ((currentPrice - price1hAgo) / price1hAgo) * 100

  // ATR
  const atr = calcATR(all, 14)
  const atrPct = (atr / currentPrice) * 100

  // Volume ratio: last 6 candles (30m) vs 24h average
  const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0
  const recentVol = volumes.length >= 6
    ? volumes.slice(-6).reduce((a, b) => a + b, 0) / 6
    : avgVol
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1

  // SL guidance: 1 ATR beyond nearest swing level
  const suggestedSlLong = nearestSupport > 0 ? nearestSupport - atr : currentPrice - atr * 2
  const suggestedSlShort = nearestResistance > 0 ? nearestResistance + atr : currentPrice + atr * 2

  const trend: TechnicalIndicators['trend'] =
    emaTrend === 'bullish' ? 'up' : emaTrend === 'bearish' ? 'down' : 'sideways'

  // Price structure: compare 12h ago → 6h ago → now (5-min candles: 144=12h, 72=6h)
  const price12hAgo = all[Math.max(0, n - 145)]
  const price6hAgo  = all[Math.max(0, n - 73)]
  const priceStructure: TechnicalIndicators['priceStructure'] =
    price12hAgo < price6hAgo && price6hAgo < currentPrice ? 'uptrend' :
    price12hAgo > price6hAgo && price6hAgo > currentPrice ? 'downtrend' : 'sideways'

  // Weekly bias: is price higher or lower than 7 days ago?
  const weeklyBias: TechnicalIndicators['weeklyBias'] =
    weeklyPrices.length < 2 ? 'neutral' :
    weeklyPrices[weeklyPrices.length - 1] > weeklyPrices[0] * 1.02 ? 'bullish' :
    weeklyPrices[weeklyPrices.length - 1] < weeklyPrices[0] * 0.98 ? 'bearish' : 'neutral'

  return {
    high24h, low24h, distFromHigh, distFromLow,
    resistances, supports, nearestResistance, nearestSupport,
    ema8, ema21, ema50, emaTrend, priceVsEma21,
    rsi, rsiZone, momentum30m, momentum1h,
    atr, atrPct, volumeRatio,
    suggestedSlLong, suggestedSlShort,
    priceStructure, weeklyBias,
    // legacy aliases
    sma4h: ema21,
    priceVsSma: priceVsEma21,
    momentum4h: momentum1h,
    avgHourlyVol: atrPct,
    trend,
  }
}

// ─── Fetch functions ────────────────────────────────────────────────────────

export async function fetchCurrentPrices(symbols: string[]): Promise<PriceMap> {
  const ids = symbols.map(s => GECKO_ID[s]).filter(Boolean).join(',')
  if (!ids) return {}

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`CoinGecko /simple/price failed: ${res.status}`)

  const raw = await res.json()
  const result: PriceMap = {}
  for (const symbol of symbols) {
    const id = GECKO_ID[symbol]
    if (id && raw[id]) {
      result[symbol] = { price: raw[id].usd, change_24h: raw[id].usd_24h_change ?? 0 }
    }
  }
  return result
}

export async function fetchSparklineHistory(symbol: string): Promise<number[]> {
  const id = GECKO_ID[symbol]
  if (!id) return []
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`
  const res = await fetch(url, { next: { revalidate: 300 } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.prices as [number, number][]).map(([, price]) => price)
}

// Full history with volume — used by cron for indicator computation
export async function fetchPriceHistory(symbol: string): Promise<{ prices: number[]; volumes: number[] }> {
  const id = GECKO_ID[symbol]
  if (!id) return { prices: [], volumes: [] }
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { prices: [], volumes: [] }
    const data = await res.json()
    const prices = (data.prices as [number, number][]).map(([, p]) => p)
    const volumes = (data.total_volumes as [number, number][]).map(([, v]) => v)
    return { prices, volumes }
  } catch {
    return { prices: [], volumes: [] }
  }
}

export async function fetchWeeklyHistory(symbol: string): Promise<number[]> {
  const id = GECKO_ID[symbol]
  if (!id) return []
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return (data.prices as [number, number][]).map(([, p]) => p)
  } catch {
    return []
  }
}

export async function fetchAllPrices(memeCoin = 'DOGE'): Promise<PriceMap> {
  const symbols = ['BTC', 'ETH', 'XAU', memeCoin]
  try {
    return await fetchCurrentPrices(symbols)
  } catch (err) {
    console.error('fetchAllPrices error:', err)
    return {}
  }
}

export function geckoId(symbol: string): string | undefined {
  return GECKO_ID[symbol]
}

// Fetch the price of a symbol at a specific UTC timestamp (±5 min window).
// Uses CoinGecko market_chart/range — accurate regardless of when called.
export async function fetchPriceAtTime(symbol: string, utcTimestamp: number): Promise<number | null> {
  const id = GECKO_ID[symbol]
  if (!id) return null

  // 5-minute window around the target time
  const from = Math.floor(utcTimestamp / 1000) - 300
  const to   = Math.floor(utcTimestamp / 1000) + 300

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const prices = data.prices as [number, number][]
    if (!prices?.length) return null
    // Return the price closest to the target timestamp
    const target = utcTimestamp
    const closest = prices.reduce((best, cur) =>
      Math.abs(cur[0] - target) < Math.abs(best[0] - target) ? cur : best
    )
    return closest[1]
  } catch {
    return null
  }
}

// Fetch the high and low price for a symbol over a time range.
// Used by check-prices to detect TP/SL touches between cron ticks.
export async function fetchHighLow(
  symbol: string,
  fromMs: number,
  toMs: number,
): Promise<{ high: number; low: number; current: number } | null> {
  const id = GECKO_ID[symbol]
  if (!id) return null

  try {
    const from = Math.floor(fromMs / 1000)
    const to   = Math.floor(toMs / 1000)
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const prices = (data.prices as [number, number][]).map(([, p]) => p)
    if (!prices.length) return null
    return {
      high: Math.max(...prices),
      low:  Math.min(...prices),
      current: prices[prices.length - 1],
    }
  } catch {
    return null
  }
}

// Fetch prices for all session symbols at a specific UTC timestamp.
// Falls back to current price if historical data is unavailable.
export async function fetchPricesAtTime(
  symbols: string[],
  utcTimestamp: number,
): Promise<Record<string, number>> {
  const results = await Promise.all(
    symbols.map(async s => {
      const price = await fetchPriceAtTime(s, utcTimestamp)
      return [s, price] as [string, number | null]
    })
  )
  return Object.fromEntries(results.filter(([, p]) => p !== null)) as Record<string, number>
}
