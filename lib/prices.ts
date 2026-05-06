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
