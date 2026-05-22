/**
 * MEXC Bot Scheduler
 * Route: /api/mexcbot/scheduler
 *
 * GET  — Vercel Cron trigger (add to vercel.json)
 * POST — Manual trigger from dashboard
 *
 * vercel.json crons entry:
 * { "path": "/api/mexcbot/scheduler", "schedule": "0 8-18 * * 1-5" }
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  ACCESS_KEY:        process.env.MEXC_ACCESS_KEY || '',
  SECRET_KEY:        process.env.MEXC_SECRET_KEY || '',
  BASE_URL:          'https://contract.mexc.com',
  BOT_SECRET:        process.env.BOT_SECRET || '',
  SYMBOL:            'BTC_USDT',
  MAX_TRADES_PER_DAY: 10,
  MIN_BALANCE:       1.0,
  MIN_CONFIDENCE:    0.70,   // skip trade if AI signal below this
}

// ─── AI SIGNAL ───────────────────────────────────────────────────────────────

async function getBTCSignal(origin: string): Promise<{ direction: 'LONG' | 'SHORT'; confidence: number } | null> {
  const res = await fetch(`${origin}/api/instant`, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`Signal fetch failed: ${res.status}`)
  const data = await res.json()
  const btc = (data.signals ?? []).find((s: { symbol: string }) => s.symbol === 'BTC')
  return btc ?? null
}

// ─── TRADE COUNT (resets on cold start) ──────────────────────────────────────

const tradeState = { date: '', count: 0 }

function getTodayCount(): number {
  const today = new Date().toISOString().slice(0, 10)
  if (tradeState.date !== today) { tradeState.date = today; tradeState.count = 0 }
  return tradeState.count
}

function incrementCount() { tradeState.count++ }

// ─── BOT CALLS ───────────────────────────────────────────────────────────────

function botUrl(req: NextRequest) {
  const origin = req.nextUrl.origin
  return `${origin}/api/mexcbot`
}

function botHeaders() {
  return { 'Content-Type': 'application/json', 'x-bot-secret': CONFIG.BOT_SECRET }
}

// ─── SCHEDULER CORE ──────────────────────────────────────────────────────────

async function runScheduler(req: NextRequest) {
  const logs: string[] = []
  const timestamp = new Date().toISOString()
  logs.push(`[${timestamp}] Scheduler triggered`)

  const todayCount = getTodayCount()
  logs.push(`Trades today: ${todayCount}/${CONFIG.MAX_TRADES_PER_DAY}`)

  if (todayCount >= CONFIG.MAX_TRADES_PER_DAY) {
    return { success: true, skipped: true, reason: `Daily limit reached: ${todayCount}/${CONFIG.MAX_TRADES_PER_DAY}`, logs }
  }

  const statusRes = await fetch(`${botUrl(req)}?action=status`, { headers: botHeaders() })
  const status = await statusRes.json()
  logs.push(`Balance: $${status.balance?.toFixed(4)}`)
  logs.push(`Open position: ${status.hasOpenPosition}`)

  if (!status.success) {
    return { success: false, reason: 'Status check failed', status, logs }
  }

  if (status.hasOpenPosition) {
    logs.push('Position open — waiting for TP hit')
    return { success: true, skipped: true, reason: 'Position open', logs }
  }

  if (status.balance < CONFIG.MIN_BALANCE) {
    return { success: false, reason: `Balance too low: $${status.balance}`, logs }
  }

  logs.push('Fetching AI signal…')
  const signal = await getBTCSignal(req.nextUrl.origin)
  if (!signal) {
    return { success: true, skipped: true, reason: 'No BTC signal returned', logs }
  }

  const pct = (signal.confidence * 100).toFixed(0)
  logs.push(`AI signal: ${signal.direction} @ ${pct}%`)

  if (signal.confidence < CONFIG.MIN_CONFIDENCE) {
    return { success: true, skipped: true, reason: `Confidence ${pct}% below ${CONFIG.MIN_CONFIDENCE * 100}% minimum`, logs }
  }

  const trend = signal.direction
  logs.push(`Placing ${trend} trade…`)
  const tradeRes = await fetch(botUrl(req), {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ action: 'trade', direction: trend }),
  })

  const tradeResult = await tradeRes.json()
  logs.push(`Trade: ${tradeResult.success ? 'SUCCESS' : 'FAILED'} — ${tradeResult.message}`)

  if (tradeResult.success) {
    incrementCount()
    logs.push(`Trades today: ${getTodayCount()}`)
  }

  return {
    success: tradeResult.success,
    trend,
    trade: tradeResult.trade,
    tradesRemaining: CONFIG.MAX_TRADES_PER_DAY - getTodayCount(),
    logs,
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest) {
  return req.headers.get('x-bot-secret') === process.env.BOT_SECRET
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runScheduler(req))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runScheduler(req))
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
