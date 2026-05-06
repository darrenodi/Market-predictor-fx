import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices } from '@/lib/prices'
import { sendMessage, formatTPHit, formatSLHit } from '@/lib/telegram'
import { Signal } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
    const { data: activeSignals } = await supabaseAdmin
      .from('signals')
      .select('*')
      .eq('status', 'active')

    if (!activeSignals?.length) return NextResponse.json({ checked: 0 })

    const { data: config } = await supabaseAdmin.from('config').select('key, value')
    const cfg = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const memeCoin: string = cfg.meme_coin ?? 'DOGE'

    const prices = await fetchAllPrices(memeCoin)
    const groupId = process.env.TELEGRAM_GROUP_ID ?? ''

    let hits = 0

    for (const signal of activeSignals as Signal[]) {
      const base = signal.symbol.replace('/USD', '')
      const priceKey = base === 'XAU' ? 'XAU' : base
      const currentPrice = prices[priceKey]?.price

      if (!currentPrice) continue

      const isLong = signal.direction === 'long'
      const tpHit = isLong ? currentPrice >= signal.tp : currentPrice <= signal.tp
      const slHit = isLong ? currentPrice <= signal.sl : currentPrice >= signal.sl

      if (tpHit) {
        await supabaseAdmin
          .from('signals')
          .update({ status: 'tp_hit', tp_hit_at: new Date().toISOString() })
          .eq('id', signal.id)
        if (groupId) await sendMessage(groupId, formatTPHit(signal))
        hits++
      } else if (slHit) {
        await supabaseAdmin
          .from('signals')
          .update({ status: 'sl_hit', sl_hit_at: new Date().toISOString() })
          .eq('id', signal.id)
        if (groupId) await sendMessage(groupId, formatSLHit(signal))
        hits++
      }
    }

    return NextResponse.json({ checked: activeSignals.length, hits })
  } catch (err) {
    console.error('/api/cron/check-prices error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
