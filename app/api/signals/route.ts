import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export interface SymbolStats {
  tp: number
  sl: number
  expired: number
  total: number
}

export async function GET() {
  try {
    const [{ data: signals, error }, { data: config }, { data: closed }] = await Promise.all([
      supabase
        .from('signals')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('config').select('key, value'),
      supabase
        .from('signals')
        .select('symbol, status')
        .in('status', ['tp_hit', 'sl_hit', 'expired']),
    ])

    if (error) throw error

    // Keep only the most recent signal per symbol
    const latestBySymbol = new Map<string, Record<string, unknown>>()
    for (const s of signals ?? []) {
      if (!latestBySymbol.has(s.symbol)) latestBySymbol.set(s.symbol, s)
    }

    // Build per-symbol all-time stats
    const stats: Record<string, SymbolStats> = {}
    for (const row of closed ?? []) {
      if (!stats[row.symbol]) stats[row.symbol] = { tp: 0, sl: 0, expired: 0, total: 0 }
      if (row.status === 'tp_hit') stats[row.symbol].tp++
      else if (row.status === 'sl_hit') stats[row.symbol].sl++
      else if (row.status === 'expired') stats[row.symbol].expired++
      stats[row.symbol].total++
    }

    const configMap = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))

    return NextResponse.json({
      signals: Array.from(latestBySymbol.values()),
      meme_coin: configMap.meme_coin ?? 'DOGE',
      account_balance: parseFloat(configMap.account_balance ?? '10000'),
      stats,
    })
  } catch (err) {
    console.error('/api/signals error:', err)
    return NextResponse.json({ signals: [], meme_coin: 'DOGE', stats: {} }, { status: 500 })
  }
}
