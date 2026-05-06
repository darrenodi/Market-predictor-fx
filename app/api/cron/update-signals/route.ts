import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices } from '@/lib/prices'
import { fetchAllNews, fetchWhaleAlerts } from '@/lib/news'
import { generateSignals } from '@/lib/signals'
import { notifyNewSignal } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Load config
    const { data: config } = await supabaseAdmin.from('config').select('key, value')
    const cfg = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const memeCoin: string = cfg.meme_coin ?? 'DOGE'

    const symbols = ['BTC', 'ETH', 'XAU', memeCoin]

    // Parallel: prices + news + whale alerts
    const [prices, news, whaleAlerts] = await Promise.all([
      fetchAllPrices(memeCoin),
      fetchAllNews(symbols),
      fetchWhaleAlerts(),
    ])

    // Build MarketData array for Claude
    const marketData = symbols
      .map(s => ({
        symbol: s === 'XAU' ? 'XAU/USD' : `${s}/USD`,
        price: prices[s]?.price ?? 0,
        change_24h: prices[s]?.change_24h ?? 0,
        news: news[s] ?? [],
        whales: whaleAlerts.filter(w => w.symbol === s),
      }))
      .filter(d => d.price > 0)

    if (marketData.length === 0) {
      return NextResponse.json({ error: 'No price data available' }, { status: 500 })
    }

    // Generate signals via Claude
    const signals = await generateSignals(marketData)

    // Expire all currently active signals
    await supabaseAdmin.from('signals').update({ status: 'expired' }).eq('status', 'active')

    // Store price history snapshot
    await supabaseAdmin.from('price_history').insert(
      Object.entries(prices).map(([sym, d]) => ({
        symbol: sym === 'XAU' ? 'XAU/USD' : `${sym}/USD`,
        price: d.price,
      })),
    )

    // Insert new signals and notify Telegram
    for (const sig of signals) {
      await supabaseAdmin.from('signals').insert({ ...sig, status: 'active' })
      await notifyNewSignal(sig)
    }

    return NextResponse.json({ ok: true, signals_generated: signals.length })
  } catch (err) {
    console.error('/api/cron/update-signals error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
