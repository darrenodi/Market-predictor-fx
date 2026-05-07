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

    // Parallel: prices + news + whale alerts + current active signals
    const [prices, news, whaleAlerts, { data: activeSignals }] = await Promise.all([
      fetchAllPrices(memeCoin),
      fetchAllNews(symbols),
      fetchWhaleAlerts(),
      supabaseAdmin.from('signals').select('*').eq('status', 'active'),
    ])

    // Build MarketData array with previous signal context
    const marketData = symbols
      .map(s => {
        const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
        const existing = (activeSignals ?? []).find(sig => sig.symbol === sym)
        return {
          symbol: sym,
          price: prices[s]?.price ?? 0,
          change_24h: prices[s]?.change_24h ?? 0,
          news: news[s] ?? [],
          whales: whaleAlerts.filter(w => w.symbol === s),
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
      return NextResponse.json({ error: 'No price data available' }, { status: 500 })
    }

    // Generate signals via Gemini
    const signals = await generateSignals(marketData)

    // Only expire signals older than 28 minutes — don't wipe fresh ones
    const cutoff = new Date(Date.now() - 28 * 60 * 1000).toISOString()
    await supabaseAdmin.from('signals').update({ status: 'expired' })
      .eq('status', 'active')
      .lt('created_at', cutoff)

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
