import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [{ data: signals, error }, { data: config }] = await Promise.all([
      supabase
        .from('signals')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('config').select('key, value'),
    ])

    if (error) throw error

    // Keep only the most recent signal per symbol
    const latestBySymbol = new Map<string, Record<string, unknown>>()
    for (const s of signals ?? []) {
      if (!latestBySymbol.has(s.symbol)) latestBySymbol.set(s.symbol, s)
    }

    const configMap = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))

    return NextResponse.json({
      signals: Array.from(latestBySymbol.values()),
      meme_coin: configMap.meme_coin ?? 'DOGE',
    })
  } catch (err) {
    console.error('/api/signals error:', err)
    return NextResponse.json({ signals: [], meme_coin: 'DOGE' }, { status: 500 })
  }
}
