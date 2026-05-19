import {
  fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory,
  fetchFundingRate, fetchOrderBookWalls, fetchMarketSentiment,
  computeIndicators, Candle,
} from '@/lib/prices'
import { fetchAllNews, fetchWhaleAlerts } from '@/lib/news'
import { generateSignals, GeneratedSignal } from '@/lib/signals'
import { fetchPerformanceSummary } from '@/lib/performance'

const SYMBOLS = ['BTC', 'ETH', 'XAU']

export interface InstantResult {
  signals: GeneratedSignal[]
  prices: Record<string, { price: number; change_24h: number }>
  generatedAt: string
}

export async function getInstantSignals(): Promise<InstantResult> {
  const [prices, news, whaleAlerts, performance, ...histories] = await Promise.all([
    fetchAllPrices('BTC'),
    fetchAllNews(SYMBOLS),
    fetchWhaleAlerts(),
    fetchPerformanceSummary(),
    ...SYMBOLS.map(s => fetchPriceHistory(s)),
    ...SYMBOLS.map(s => fetchWeeklyHistory(s)),
    ...SYMBOLS.map(s => fetchFundingRate(s)),
    ...SYMBOLS.map(s => fetchOrderBookWalls(s)),
    ...SYMBOLS.map(s => fetchMarketSentiment(s)),
  ])

  const n = SYMBOLS.length
  const priceHistories  = histories.slice(0,     n) as Candle[][]
  const weeklyHistories = histories.slice(n,     n * 2) as Candle[][]
  const fundingRates    = histories.slice(n * 2, n * 3) as (number | null)[]
  const orderBooks      = histories.slice(n * 3, n * 4) as (Awaited<ReturnType<typeof fetchOrderBookWalls>>)[]
  const sentiments      = histories.slice(n * 4, n * 5) as (Awaited<ReturnType<typeof fetchMarketSentiment>>)[]

  const marketData = SYMBOLS
    .map((s, i) => {
      const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
      const price = prices[s]?.price ?? 0
      const candles = priceHistories[i] ?? []
      const weeklyCandles = weeklyHistories[i] ?? []
      const fundingRate = fundingRates[i] ?? null
      return {
        symbol: sym,
        price,
        change_24h: prices[s]?.change_24h ?? 0,
        news: news[s] ?? [],
        whales: whaleAlerts.filter(w => w.symbol === s),
        indicators: computeIndicators(candles, price, weeklyCandles, fundingRate),
        orderBook: orderBooks[i] ?? null,
        sentiment: sentiments[i] ?? null,
        currentSignal: null,
      }
    })
    .filter(d => d.price > 0)

  const signals = await generateSignals(marketData, performance ?? undefined)

  const priceSnapshot = Object.fromEntries(
    SYMBOLS.map(s => [s, { price: prices[s]?.price ?? 0, change_24h: prices[s]?.change_24h ?? 0 }])
  )

  return { signals, prices: priceSnapshot, generatedAt: new Date().toISOString() }
}
