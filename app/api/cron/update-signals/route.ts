import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory, fetchFundingRate, fetchOrderBookWalls, fetchMarketSentiment, computeIndicators, Candle } from '@/lib/prices'
import { fetchAllNews, fetchWhaleAlerts } from '@/lib/news'
import { generateSignals } from '@/lib/signals'
import { fetchPerformanceSummary } from '@/lib/performance'
import { notifyNewSignals } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// 08:00–09:00 UTC — London open stop-hunt hour.
// Institutions spike price to hunt retail stops before the real move.
// Skip signal generation entirely; let price commit to a direction first.
function isLondonOpenHour(): boolean {
  const h = new Date().getUTCHours()
  return h === 8
}

async function runSignalUpdate(memeCoin: string) {
  const symbols = ['BTC', 'ETH', 'XAU', memeCoin]
  const t0 = Date.now()
  console.log(`[update-signals] start — symbols: ${symbols.join(', ')}`)

  const [prices, news, whaleAlerts, { data: activeSignals }, performance, ...histories] = await Promise.all([
    fetchAllPrices(memeCoin),
    fetchAllNews(symbols),
    fetchWhaleAlerts(),
    supabaseAdmin.from('signals').select('*').eq('status', 'active'),
    fetchPerformanceSummary(),
    ...symbols.map(s => fetchPriceHistory(s)),
    ...symbols.map(s => fetchWeeklyHistory(s)),
    ...symbols.map(s => fetchFundingRate(s)),
    ...symbols.map(s => fetchOrderBookWalls(s)),
    ...symbols.map(s => fetchMarketSentiment(s)),
  ])
  console.log(`[update-signals] data fetched in ${Date.now() - t0}ms`)

  const n = symbols.length
  const priceHistories  = histories.slice(0,     n) as Candle[][]
  const weeklyHistories = histories.slice(n,     n * 2) as Candle[][]
  const fundingRates    = histories.slice(n * 2, n * 3) as (number | null)[]
  const orderBooks      = histories.slice(n * 3, n * 4) as (Awaited<ReturnType<typeof fetchOrderBookWalls>>)[]
  const sentiments      = histories.slice(n * 4, n * 5) as (Awaited<ReturnType<typeof fetchMarketSentiment>>)[]

  const marketData = symbols
    .map((s, i) => {
      const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
      const existing = (activeSignals ?? []).find(sig => sig.symbol === sym)
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
        currentSignal: existing ? {
          direction: existing.direction,
          entry: existing.market_price,
          tp: existing.tp,
          sl: existing.sl,
          confidence: existing.confidence,
          ageMinutes: Math.floor((Date.now() - new Date(existing.created_at).getTime()) / 60000),
        } : null,
      }
    })
    .filter(d => d.price > 0)

  if (marketData.length === 0) {
    console.warn('[update-signals] No valid market data — all prices returned 0')
    return
  }
  console.log(`[update-signals] assets with price: ${marketData.map(d => d.symbol).join(', ')}`)

  const signals = await generateSignals(marketData, performance ?? undefined)
  console.log(`[update-signals] Gemini returned ${signals.length} signals in ${Date.now() - t0}ms`)

  const cutoff = new Date(Date.now() - 28 * 60 * 1000).toISOString()
  await supabaseAdmin.from('signals').update({ status: 'expired' })
    .eq('status', 'active')
    .lt('created_at', cutoff)

  await supabaseAdmin.from('price_history').insert(
    Object.entries(prices).map(([sym, d]) => ({
      symbol: sym === 'XAU' ? 'XAU/USD' : `${sym}/USD`,
      price: d.price,
    })),
  )

  for (const sig of signals) {
    await supabaseAdmin.from('signals').insert({ ...sig, status: 'active' })
  }
  await notifyNewSignals(signals)

  console.log(`[update-signals] done — ${signals.length} signals inserted, total ${Date.now() - t0}ms`)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isLondonOpenHour()) {
    console.log('[update-signals] Skipped — London open stop-hunt hour (08:00–09:00 UTC)')
    return NextResponse.json({ ok: true, skipped: 'london_open' })
  }

  const { data: config } = await supabaseAdmin.from('config').select('key, value')
  const cfg = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
  const memeCoin: string = cfg.meme_coin ?? 'DOGE'

  // ?sync=1 — run synchronously and return full debug output (use to diagnose issues)
  if (req.nextUrl.searchParams.get('sync') === '1') {
    try {
      await runSignalUpdate(memeCoin)
      return NextResponse.json({ ok: true, status: 'done' })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // Return 200 immediately so the cron service doesn't time out.
  // after() keeps the function alive on Vercel to finish the work.
  after(async () => {
    try {
      await runSignalUpdate(memeCoin)
    } catch (err) {
      console.error('[update-signals] background error:', err)
    }
  })

  return NextResponse.json({ ok: true, status: 'processing' })
}
