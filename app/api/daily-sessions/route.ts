import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export interface DailySessionRow {
  id: string
  session: string
  session_date: string
  symbol: string
  open_price: number
  close_price: number | null
  predicted_close: number
  predicted_direction: string
  predicted_pct: number
  confidence: number
  reasoning: string
  outcome: 'correct' | 'incorrect' | null
  daily_balance_before: number | null
  daily_pnl: number | null
  created_at: string
  closed_at: string | null
}

export interface DailyStats {
  overall: { correct: number; total: number }
  bySession: Record<string, { correct: number; total: number; pnl: number }>
  bySymbol: Record<string, { correct: number; total: number; pnl: number }>
}

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10)

    const [{ data: rows }, { data: config }] = await Promise.all([
      supabase
        .from('daily_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase.from('config').select('key, value'),
    ])

    const configMap = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const dailyBalance = parseFloat(configMap.daily_balance ?? '10000')

    const all = (rows ?? []) as DailySessionRow[]
    const todayRows = all.filter(r => r.session_date === today)
    const closedRows = all.filter(r => r.outcome !== null)

    const stats: DailyStats = {
      overall: { correct: 0, total: 0 },
      bySession: {},
      bySymbol: {},
    }

    for (const r of closedRows) {
      stats.overall.total++
      if (r.outcome === 'correct') stats.overall.correct++

      if (!stats.bySession[r.session]) stats.bySession[r.session] = { correct: 0, total: 0, pnl: 0 }
      stats.bySession[r.session].total++
      if (r.outcome === 'correct') stats.bySession[r.session].correct++
      stats.bySession[r.session].pnl += r.daily_pnl ?? 0

      if (!stats.bySymbol[r.symbol]) stats.bySymbol[r.symbol] = { correct: 0, total: 0, pnl: 0 }
      stats.bySymbol[r.symbol].total++
      if (r.outcome === 'correct') stats.bySymbol[r.symbol].correct++
      stats.bySymbol[r.symbol].pnl += r.daily_pnl ?? 0
    }

    return NextResponse.json({ today: todayRows, history: all, stats, daily_balance: dailyBalance })
  } catch (err) {
    console.error('/api/daily-sessions error:', err)
    return NextResponse.json({
      today: [], history: [],
      stats: { overall: { correct: 0, total: 0 }, bySession: {}, bySymbol: {} },
      daily_balance: 10000,
    }, { status: 500 })
  }
}
