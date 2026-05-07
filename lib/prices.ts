// CoinGecko IDs — covers crypto + PAXG (1:1 gold proxy, no separate gold API needed)
const GECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XAU: 'pax-gold',   // Pax Gold tracks spot gold price 1:1
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
  high24h: number
  low24h: number
  distFromHigh: number   // % below 24h high (negative = at or above)
  distFromLow: number    // % above 24h low
  sma4h: number
  priceVsSma: number     // % price is above/below 4h SMA
  momentum1h: number     // % change last 1 hour
  momentum4h: number     // % change last 4 hours
  avgHourlyVol: number   // average absolute % move per hour (volatility)
  trend: 'up' | 'down' | 'sideways'
}

export function computeIndicators(history: number[], currentPrice: number): TechnicalIndicators | null {
  if (history.length < 5) return null

  const prices = [...history, currentPrice]
  const n = prices.length

  const high24h = Math.max(...prices)
  const low24h = Math.min(...prices)

  const distFromHigh = ((currentPrice - high24h) / high24h) * 100
  const distFromLow = ((currentPrice - low24h) / low24h) * 100

  const last5 = prices.slice(-5)
  const sma4h = last5.reduce((a, b) => a + b, 0) / last5.length
  const priceVsSma = ((currentPrice - sma4h) / sma4h) * 100

  const price1hAgo = prices[n - 2] ?? currentPrice
  const price4hAgo = prices[n - 5] ?? currentPrice
  const momentum1h = ((currentPrice - price1hAgo) / price1hAgo) * 100
  const momentum4h = ((currentPrice - price4hAgo) / price4hAgo) * 100

  const hourlyChanges = prices.slice(1).map((p, i) => Math.abs((p - prices[i]) / prices[i]) * 100)
  const avgHourlyVol = hourlyChanges.reduce((a, b) => a + b, 0) / hourlyChanges.length

  const trend = priceVsSma > 0.1 ? 'up' : priceVsSma < -0.1 ? 'down' : 'sideways'

  return { high24h, low24h, distFromHigh, distFromLow, sma4h, priceVsSma, momentum1h, momentum4h, avgHourlyVol, trend }
}

export async function fetchCurrentPrices(symbols: string[]): Promise<PriceMap> {
  const ids = symbols
    .map(s => GECKO_ID[s])
    .filter(Boolean)
    .join(',')

  if (!ids) return {}

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  const res = await fetch(url, { next: { revalidate: 60 } })

  if (!res.ok) throw new Error(`CoinGecko /simple/price failed: ${res.status}`)

  const raw = await res.json()
  const result: PriceMap = {}

  for (const symbol of symbols) {
    const id = GECKO_ID[symbol]
    if (id && raw[id]) {
      result[symbol] = {
        price: raw[id].usd,
        change_24h: raw[id].usd_24h_change ?? 0,
      }
    }
  }

  return result
}

export async function fetchSparklineHistory(symbol: string): Promise<number[]> {
  const id = GECKO_ID[symbol]
  if (!id) return []

  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1&interval=hourly`
  const res = await fetch(url, { next: { revalidate: 300 } }) // cache 5 min

  if (!res.ok) return []

  const data = await res.json()
  return (data.prices as [number, number][]).map(([, price]) => price)
}

export async function fetchAllPrices(
  memeCoin = 'DOGE',
): Promise<PriceMap> {
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
