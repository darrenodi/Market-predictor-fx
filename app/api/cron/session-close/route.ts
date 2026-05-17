import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices } from '@/lib/prices'
import { SESSIONS, SessionKey } from '@/lib/daily-sessions'
import { sendMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Simulated position sizing for daily predictions
const DAILY_LEVERAGE = 10
const DAILY_PCT = 5   // 5% of balance per trade
const TOPUP_THRESHOLD = 1_000
const TOPUP_AMOUNT = 10_000

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
    let dailyBalance = parseFloat(cfg.daily_balance ?? '10000')
    const sessionDate = new Date().toISOString().slice(0, 10)

    // Fetch pending predictions for this session today
    const { data: pending } = await supabaseAdmin
      .from('daily_sessions')
      .select('*')
      .eq('session', session)
      .eq('session_date', sessionDate)
      .is('close_price', null)

    if (!pending?.length) {
      console.log(`[session-close] No pending predictions for ${session} ${sessionDate}`)
      return NextResponse.json({ ok: true, evaluated: 0 })
    }

    const prices = await fetchAllPrices(memeCoin)
    let balanceChanged = false

    const results: Array<{
      symbol: string
      outcome: 'correct' | 'incorrect'
      pnl: number
      actual_pct: number
      open_price: number
      close_price: number
      predicted_direction: string
    }> = []

    for (const row of pending) {
      const base = row.symbol.replace('/USD', '')
      const priceKey = base === 'XAU' ? 'XAU' : base
      const closePrice = prices[priceKey]?.price
      if (!closePrice) continue

      const actualPct = ((closePrice - row.open_price) / row.open_price) * 100
      const actualDirection = actualPct >= 0 ? 'up' : 'down'
      const outcome: 'correct' | 'incorrect' = actualDirection === row.predicted_direction ? 'correct' : 'incorrect'

      // P&L: margin × leverage × actual move %
      const balanceBefore = row.daily_balance_before ?? dailyBalance
      const margin = balanceBefore * (DAILY_PCT / 100)
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

      results.push({
        symbol: row.symbol,
        outcome,
        pnl,
        actual_pct: actualPct,
        open_price: row.open_price,
        close_price: closePrice,
        predicted_direction: row.predicted_direction,
      })
    }

    // Top-up daily balance if it drops too low
    if (dailyBalance < TOPUP_THRESHOLD) {
      const before = dailyBalance
      dailyBalance = TOPUP_AMOUNT
      const groupId = process.env.TELEGRAM_GROUP_ID ?? ''
      if (groupId) {
        await sendMessage(groupId,
          `⚠️ <b>Daily Balance Reset</b>\n` +
          `Balance dropped to $${plain(before)} — reset to $${TOPUP_AMOUNT.toLocaleString()}`
        )
      }
      console.log(`[session-close] Daily balance reset: $${before.toFixed(2)} → $${dailyBalance}`)
    }

    if (balanceChanged) {
      await supabaseAdmin.from('config').upsert(
        { key: 'daily_balance', value: dailyBalance.toFixed(2) },
        { onConflict: 'key' },
      )
    }

    // Telegram summary
    const groupId = process.env.TELEGRAM_GROUP_ID ?? ''
    if (groupId && results.length > 0) {
      const sc = SESSIONS[session]
      const correct = results.filter(r => r.outcome === 'correct').length
      const sessionPnl = results.reduce((s, r) => s + r.pnl, 0)

      const lines = results.map(r =>
        `${r.outcome === 'correct' ? '✅' : '❌'} <b>${r.symbol}</b>` +
        `  predicted ${r.predicted_direction.toUpperCase()}` +
        `\n  $${plain(r.open_price)} → $${plain(r.close_price)}` +
        `  (${r.actual_pct >= 0 ? '+' : ''}${r.actual_pct.toFixed(2)}%)` +
        `  P&L: ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}`
      ).join('\n\n')

      await sendMessage(groupId,
        `${sc.flag} <b>${sc.name.toUpperCase()} SESSION CLOSE — RESULTS</b>\n` +
        `━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━\n` +
        `Score: ${correct}/${results.length} | Session P&L: ${sessionPnl >= 0 ? '+' : ''}$${sessionPnl.toFixed(2)}\n` +
        `Daily balance: $${plain(dailyBalance)}`
      )
    }

    return NextResponse.json({ ok: true, evaluated: results.length, daily_balance: dailyBalance })
  } catch (err) {
    console.error('[session-close] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
