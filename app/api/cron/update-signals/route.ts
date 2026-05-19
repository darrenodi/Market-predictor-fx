import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory, fetchFundingRate, computeIndicators, Candle } from '@/lib/prices'
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

  const [prices, news, whaleAlerts, { data: activeSignals }, performance, ...histories] = await Promise.all([
    fetchAllPrices(memeCoin),
    fetchAllNews(symbols),
    fetchWhaleAlerts(),
    supabaseAdmin.from('signals').select('*').eq('status', 'active'),
    fetchPerformanceSummary(),
    ...symbols.map(s => fetchPriceHistory(s)),
    ...symbols.map(s => fetchWeeklyHistory(s)),
    ...symbols.map(s => fetchFundingRate(s)),
  ])

  const priceHistories = histories.slice(0, symbols.length) as Candle[][]
  const weeklyHistories = histories.slice(symbols.length, symbols.length * 2) as Candle[][]
  const fundingRates = histories.slice(symbols.length * 2) as (number | null)[]

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

  if (marketData.length === 0) return

  const signals = await generateSignals(marketData, performance ?? undefined)

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

  console.log(`[update-signals] Generated ${signals.length} signals`)
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
