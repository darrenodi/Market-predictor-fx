import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices, fetchPriceHistory, fetchWeeklyHistory, computeIndicators, Candle } from '@/lib/prices'
import { generateDailyPredictions, SESSIONS, SessionKey } from '@/lib/daily-sessions'
import { sendMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

function plain(n: number): string {
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = (req.nextUrl.searchParams.get('session') ?? '') as SessionKey
  if (!SESSIONS[session]) {
    return NextResponse.json({ error: 'Use ?session=asia|london|newyork' }, { status: 400 })
  }

  try {
    const { data: config } = await supabaseAdmin.from('config').select('key, value')
    const cfg = Object.fromEntries((config ?? []).map(r => [r.key, r.value]))
    const memeCoin: string = cfg.meme_coin ?? 'DOGE'
    const dailyBalance = parseFloat(cfg.daily_balance ?? '10000')
    const symbols = ['BTC', 'ETH', 'XAU', memeCoin]
    const sessionDate = new Date().toISOString().slice(0, 10)

    // Idempotency — skip if already predicted this session today
    const { data: existing } = await supabaseAdmin
      .from('daily_sessions')
      .select('id')
      .eq('session', session)
      .eq('session_date', sessionDate)
      .limit(1)

    if (existing?.length) {
      console.log(`[session-open] Already predicted ${session} on ${sessionDate}`)
      return NextResponse.json({ ok: true, skipped: 'already_predicted' })
    }

    // Parallel fetch prices + indicators
    const [prices, ...histories] = await Promise.all([
      fetchAllPrices(memeCoin),
      ...symbols.map(s => fetchPriceHistory(s)),
      ...symbols.map(s => fetchWeeklyHistory(s)),
    ])

    const priceHistories = histories.slice(0, symbols.length) as Candle[][]
    const weeklyHistories = histories.slice(symbols.length) as Candle[][]

    const assets = symbols
      .map((s, i) => {
        const sym = s === 'XAU' ? 'XAU/USD' : `${s}/USD`
        const price = (prices as Awaited<ReturnType<typeof fetchAllPrices>>)[s]?.price ?? 0
        if (price === 0) return null
        const candles = priceHistories[i] ?? []
        const weeklyCandles = weeklyHistories[i] ?? []
        return {
          symbol: sym,
          price,
          change_24h: (prices as Awaited<ReturnType<typeof fetchAllPrices>>)[s]?.change_24h ?? 0,
          indicators: computeIndicators(candles, price, weeklyCandles),
          priceHistory: candles.map((c: Candle) => c.close),  // close prices for daily-sessions trajectory
        }
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)

    if (assets.length === 0) {
      return NextResponse.json({ error: 'No price data' }, { status: 500 })
    }

    // Load past evaluated predictions so Gemini can learn from its track record
    const { data: pastData } = await supabaseAdmin
      .from('daily_sessions')
      .select('session, session_date, symbol, open_price, close_price, predicted_direction, predicted_close, predicted_pct, outcome')
      .not('outcome', 'is', null)
      .order('created_at', { ascending: false })
      .limit(40)

    const predictions = await generateDailyPredictions(session, assets, pastData ?? [])

    // Insert predictions into DB
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

    // Telegram notification
    const groupId = process.env.TELEGRAM_GROUP_ID ?? ''
    if (groupId && predictions.length > 0) {
      const sc = SESSIONS[session]
      const lines = predictions.map(p =>
        `${p.predicted_direction === 'up' ? '📈' : '📉'} <b>${p.symbol}</b>` +
        `\n  Open: $${plain(p.open_price)} → Target: $${plain(p.predicted_close)}` +
        `  (${p.predicted_pct >= 0 ? '+' : ''}${p.predicted_pct.toFixed(2)}%)` +
        `  ${Math.round(p.confidence * 100)}% confidence` +
        `\n  <i>${p.reasoning}</i>`
      ).join('\n\n')

      await sendMessage(groupId,
        `${sc.flag} <b>${sc.name.toUpperCase()} SESSION OPEN — DAILY PREDICTIONS</b>\n` +
        `<i>${sc.openUTC}:00 → ${sc.closeUTC}:00 UTC</i>\n` +
        `━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━\n` +
        `Daily balance: $${plain(dailyBalance)}`
      )
    }

    return NextResponse.json({ ok: true, session, predictions_generated: predictions.length })
  } catch (err) {
    console.error('[session-open] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
