import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory, fetchPricesAtTime, computeIndicators, Candle } from '@/lib/prices'
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

// Sessions whose close time has already passed today
function sessionsToClose(): SessionKey[] {
  const h = new Date().getUTCHours()
  const out: SessionKey[] = []
  if (h >= SESSIONS.asia.closeUTC)    out.push('asia')
  if (h >= SESSIONS.london.closeUTC)  out.push('london')
  if (h >= SESSIONS.newyork.closeUTC) out.push('newyork')
  return out
}

async function autoClose(
  pendingRows: DailySessionRow[],
  closePricesBySes: Record<string, Record<string, number>>,
  currentPrices: Awaited<ReturnType<typeof fetchAllPrices>>,
  memeCoin: string,
): Promise<number> {
  const DAILY_LEVERAGE = 10
  const DAILY_PCT = 5
  let updated = 0

  const { data: config } = await supabaseAdmin.from('config').select('key, value')
  const cfg = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
  let dailyBalance = parseFloat(cfg.daily_balance ?? '10000')
  let balanceChanged = false

  for (const row of pendingRows) {
    const base = row.symbol.replace('/USD', '')
    const priceKey = base === 'XAU' ? 'XAU' : base
    const closePrice = closePricesBySes[row.session]?.[priceKey] ?? currentPrices[priceKey]?.price
    if (!closePrice) continue

    const actualPct = ((closePrice - row.open_price) / row.open_price) * 100
    const actualDirection = actualPct >= 0 ? 'up' : 'down'
    const outcome = actualDirection === row.predicted_direction ? 'correct' : 'incorrect'

    const margin = (row.daily_balance_before ?? dailyBalance) * (DAILY_PCT / 100)
    const position = margin * DAILY_LEVERAGE
    const pnl = outcome === 'correct'
      ? (Math.abs(actualPct) / 100) * position
      : -(Math.abs(actualPct) / 100) * position

    dailyBalance += pnl
    balanceChanged = true

    await supabaseAdmin.from('daily_sessions').update({
      close_price: closePrice,
      outcome,
      daily_pnl: pnl,
      closed_at: new Date().toISOString(),
    }).eq('id', row.id)

    updated++
  }

  if (balanceChanged) {
    if (dailyBalance < 1000) dailyBalance = 10000
    await supabaseAdmin.from('config').upsert(
      { key: 'daily_balance', value: dailyBalance.toFixed(2) },
      { onConflict: 'key' },
    )
  }

  return updated
}

async function autoGenerate(session: SessionKey, memeCoin: string, dailyBalance: number): Promise<void> {
  const symbols = ['BTC', 'ETH', 'XAU', memeCoin]
  const sessionDate = new Date().toISOString().slice(0, 10)

  // Build the exact UTC timestamp for this session's open time today
  const openHour = SESSIONS[session].openUTC
  const openTimestamp = new Date(`${sessionDate}T${String(openHour).padStart(2, '0')}:00:00Z`).getTime()

  const [historicalPrices, ...histories] = await Promise.all([
    // Fetch price at the exact session open time, not current price
    fetchPricesAtTime(symbols, openTimestamp),
    ...symbols.map(s => fetchPriceHistory(s)),
    ...symbols.map(s => fetchWeeklyHistory(s)),
  ])

  // Fall back to current prices for any symbol that had no historical data
  const currentPrices = await fetchAllPrices(memeCoin)

  const priceHistories = histories.slice(0, symbols.length) as Candle[][]
  const weeklyHistories = histories.slice(symbols.length) as Candle[][]

  const assets = symbols.map((s, i) => {
    const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
    const price = historicalPrices[s] ?? currentPrices[s]?.price ?? 0
    if (price === 0) return null
    const candles = priceHistories[i] ?? []
    const weeklyCandles = weeklyHistories[i] ?? []
    return {
      symbol: sym,
      price,
      change_24h: currentPrices[s]?.change_24h ?? 0,
      indicators: computeIndicators(candles, price, weeklyCandles),
      priceHistory: candles.map((c: Candle) => c.close),
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

    // Auto-close sessions whose close time has passed but still have no close_price
    const shouldClose = sessionsToClose()
    const pendingToClose = todayRows.filter(
      (r: DailySessionRow) => r.close_price === null && shouldClose.includes(r.session as SessionKey)
    )
    if (pendingToClose.length > 0) {
      try {
        // Fetch historical prices at each session's exact close time
        const sessionSymbols = ['BTC', 'ETH', 'XAU', memeCoin]
        const closePricesBySes: Record<string, Record<string, number>> = {}
        for (const ses of [...new Set(pendingToClose.map(r => r.session))]) {
          const closeHour = SESSIONS[ses as SessionKey].closeUTC
          const closeTs = new Date(`${today}T${String(closeHour).padStart(2, '0')}:00:00Z`).getTime()
          closePricesBySes[ses] = await fetchPricesAtTime(sessionSymbols, closeTs)
        }
        // Fall back to current prices for any gaps
        const currentPrices = await fetchAllPrices(memeCoin)
        await autoClose(pendingToClose, closePricesBySes, currentPrices, memeCoin)
      } catch (err) {
        console.error('[daily-sessions] Auto-close failed:', err)
      }
    }

    // Re-fetch if we generated or closed anything
    const needsRefresh = needed.length > 0 || pendingToClose.length > 0
    const { data: freshRows } = needsRefresh
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
