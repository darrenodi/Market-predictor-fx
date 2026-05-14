import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllPrices } from '@/lib/prices'
import { sendMessage, formatTPHit, formatSLHit } from '@/lib/telegram'
import { Signal } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const FIXED_LEVERAGE = 75
const TOPUP_AMOUNT = 10_000
const TOPUP_THRESHOLD = 1_000

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

function calcPnl(signal: Signal, accountBalance: number): { tpPnl: number; slPnl: number; margin: number; position: number } {
  const margin = accountBalance * (signal.portfolio_pct / 100)
  const position = margin * FIXED_LEVERAGE
  const isLong = signal.direction === 'long'
  const entry = signal.market_price

  const tpMove = isLong
    ? (signal.tp - entry) / entry
    : (entry - signal.tp) / entry

  const slMove = isLong
    ? (entry - signal.sl) / entry
    : (signal.sl - entry) / entry

  return { tpPnl: tpMove * position, slPnl: slMove * position, margin, position }
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
    let accountBalance = parseFloat(cfg.account_balance ?? '10000')
    const topupLog: Array<{ amount: number; balance_before: number; date: string }> =
      JSON.parse(cfg.account_topup_log ?? '[]')

    const prices = await fetchAllPrices(memeCoin)
    const groupId = process.env.TELEGRAM_GROUP_ID ?? ''

    let hits = 0
    let balanceChanged = false

    for (const signal of activeSignals as Signal[]) {
      const base = signal.symbol.replace('/USD', '')
      const priceKey = base === 'XAU' ? 'XAU' : base
      const currentPrice = prices[priceKey]?.price

      if (!currentPrice) continue

      const isLong = signal.direction === 'long'
      const tpHit = isLong ? currentPrice >= signal.tp : currentPrice <= signal.tp
      const slHit = isLong ? currentPrice <= signal.sl : currentPrice >= signal.sl

      if (tpHit) {
        const { tpPnl, margin, position } = calcPnl(signal, accountBalance) as any
        accountBalance += tpPnl
        balanceChanged = true

        await supabaseAdmin
          .from('signals')
          .update({ status: 'tp_hit', tp_hit_at: new Date().toISOString() })
          .eq('id', signal.id)

        if (groupId) {
          const msg = formatTPHit(signal) +
            `\n━━━━━━━━━━━━━━━━` +
            `\n💵 Margin used : $${margin.toFixed(2)} (${signal.portfolio_pct}%)` +
            `\n📦 Position    : $${position.toFixed(2)} (${FIXED_LEVERAGE}×)` +
            `\n💰 Net profit  : +$${tpPnl.toFixed(2)}` +
            `\n🏦 New balance : $${accountBalance.toFixed(2)}`
          await sendMessage(groupId, msg)
        }
        hits++
      } else if (slHit) {
        const { slPnl, margin, position } = calcPnl(signal, accountBalance) as any
        accountBalance -= slPnl
        balanceChanged = true

        await supabaseAdmin
          .from('signals')
          .update({ status: 'sl_hit', sl_hit_at: new Date().toISOString() })
          .eq('id', signal.id)

        if (groupId) {
          const msg = formatSLHit(signal) +
            `\n━━━━━━━━━━━━━━━━` +
            `\n💵 Margin used : $${margin.toFixed(2)} (${signal.portfolio_pct}%)` +
            `\n📦 Position    : $${position.toFixed(2)} (${FIXED_LEVERAGE}×)` +
            `\n💸 Net loss    : -$${slPnl.toFixed(2)}` +
            `\n🏦 New balance : $${accountBalance.toFixed(2)}`
          await sendMessage(groupId, msg)
        }
        hits++
      }
    }

    // Top-up if balance dropped below threshold
    if (accountBalance < TOPUP_THRESHOLD) {
      const balanceBefore = accountBalance
      accountBalance += TOPUP_AMOUNT
      topupLog.push({ amount: TOPUP_AMOUNT, balance_before: balanceBefore, date: new Date().toISOString() })

      await supabaseAdmin.from('config').upsert(
        { key: 'account_topup_log', value: JSON.stringify(topupLog) },
        { onConflict: 'key' },
      )

      if (groupId) {
        await sendMessage(groupId,
          `⚠️ <b>Account Top-Up</b>\n` +
          `Balance dropped to $${balanceBefore.toFixed(2)}\n` +
          `Added $${TOPUP_AMOUNT.toLocaleString()} → New balance: $${accountBalance.toFixed(2)}\n` +
          `Total top-ups so far: ${topupLog.length}`,
        )
      }
      console.log(`[check-prices] Top-up triggered: $${balanceBefore.toFixed(2)} → $${accountBalance.toFixed(2)}`)
    }

    // Save updated balance
    if (balanceChanged) {
      await supabaseAdmin.from('config').upsert(
        { key: 'account_balance', value: accountBalance.toFixed(2) },
        { onConflict: 'key' },
      )
      console.log(`[check-prices] Balance updated: $${accountBalance.toFixed(2)}`)
    }

    return NextResponse.json({ checked: activeSignals.length, hits, account_balance: accountBalance })
  } catch (err) {
    console.error('/api/cron/check-prices error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
