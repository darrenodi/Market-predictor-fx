import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory, computeIndicators } from '@/lib/prices'
import { generateDailyPredictions, SESSIONS, SessionKey } from '@/lib/daily-sessions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

// Sessions that should have predictions by now, based on UTC hour
function sessionsToGenerate(): SessionKey[] {
  const h = new Date().getUTCHours()
  const out: SessionKey[] = []
  if (h >= SESSIONS.asia.openUTC)    out.push('asia')
  if (h >= SESSIONS.london.openUTC)  out.push('london')
  if (h >= SESSIONS.newyork.openUTC) out.push('newyork')
  return out
}

async function autoGenerate(session: SessionKey, memeCoin: string, dailyBalance: number): Promise<void> {
  const symbols = ['BTC', 'ETH', 'XAU', memeCoin]
  const sessionDate = new Date().toISOString().slice(0, 10)

  const [prices, ...histories] = await Promise.all([
    fetchAllPrices(memeCoin),
    ...symbols.map(s => fetchPriceHistory(s)),
    ...symbols.map(s => fetchWeeklyHistory(s)),
  ])

  const priceHistories = histories.slice(0, symbols.length) as Awaited<ReturnType<typeof fetchPriceHistory>>[]
  const weeklyHistories = histories.slice(symbols.length) as number[][]

  const assets = symbols.map((s, i) => {
    const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
    const price = (prices as Awaited<ReturnType<typeof fetchAllPrices>>)[s]?.price ?? 0
    if (price === 0) return null
    const { prices: ph, volumes: vh } = priceHistories[i] ?? { prices: [], volumes: [] }
    const wp = weeklyHistories[i] ?? []
    return {
      symbol: sym,
      price,
      change_24h: (prices as Awaited<ReturnType<typeof fetchAllPrices>>)[s]?.change_24h ?? 0,
      indicators: computeIndicators(ph, vh, price, wp),
      priceHistory: ph,
    }
  }).filter((a): a is NonNullable<typeof a> => a !== null)

  if (assets.length === 0) return

  const { data: pastData } = await supabaseAdmin
    .from('daily_sessions')
    .select('session, session_date, symbol, open_price, close_price, predicted_direction, predicted_close, predicted_pct, outcome')
    .not('outcome', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40)

  const predictions = await generateDailyPredictions(session, assets, pastData ?? [])

  for (const p of predictions) {
    await supabaseAdmin.from('daily_sessions').insert({
      session,
      session_date: sessionDate,
      symbol: p.symbol,
      open_price: p.open_price,
      predicted_close: p.predicted_close,
      predicted_direction: p.predicted_direction,
      predicted_pct: p.predicted_pct,
      confidence: p.confidence,
      reasoning: p.reasoning,
      daily_balance_before: dailyBalance,
    })
  }

  console.log(`[daily-sessions] Auto-generated ${predictions.length} predictions for ${session}`)
}

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10)

    const [{ data: rows, error: tableError }, { data: config }] = await Promise.all([
      supabase.from('daily_sessions').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('config').select('key, value'),
    ])

    if (tableError) {
      console.error('[daily-sessions] Table error (run SQL migration?):', tableError.message)
      return NextResponse.json({
        today: [], history: [],
        stats: { overall: { correct: 0, total: 0 }, bySession: {}, bySymbol: {} },
        daily_balance: 10000,
        error: 'daily_sessions table not found — run the SQL migration in Supabase',
      })
    }

    const configMap = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const memeCoin: string = configMap.meme_coin ?? 'DOGE'
    const dailyBalance = parseFloat(configMap.daily_balance ?? '10000')

    // Detect which sessions should have predictions today but are missing
    const todayRows = (rows ?? []).filter((r: DailySessionRow) => r.session_date === today)
    const sessionsDone = new Set(todayRows.map((r: DailySessionRow) => r.session))
    const needed = sessionsToGenerate().filter(s => !sessionsDone.has(s))

    // Generate missing ones (sequential — each takes ~5-10s)
    for (const session of needed) {
      try {
        await autoGenerate(session, memeCoin, dailyBalance)
      } catch (err) {
        console.error(`[daily-sessions] Auto-generate failed for ${session}:`, err)
      }
    }

    // Re-fetch if we generated anything
    const { data: freshRows } = needed.length > 0
      ? await supabase.from('daily_sessions').select('*').order('created_at', { ascending: false }).limit(300)
      : { data: rows }

    const all = (freshRows ?? []) as DailySessionRow[]
    const todayFinal = all.filter(r => r.session_date === today)
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

    return NextResponse.json({ today: todayFinal, history: all, stats, daily_balance: dailyBalance })
  } catch (err) {
    console.error('/api/daily-sessions error:', err)
    return NextResponse.json({
      today: [], history: [],
      stats: { overall: { correct: 0, total: 0 }, bySession: {}, bySymbol: {} },
      daily_balance: 10000,
    }, { status: 500 })
  }
}
