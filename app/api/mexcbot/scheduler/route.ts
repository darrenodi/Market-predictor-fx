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
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  ACCESS_KEY:        process.env.MEXC_ACCESS_KEY || '',
  SECRET_KEY:        process.env.MEXC_SECRET_KEY || '',
  BASE_URL:          'https://contract.mexc.com',
  BOT_SECRET:        process.env.BOT_SECRET || '',
  SYMBOL:            'BTC_USDT',
  LEVERAGE:          60,
  TP_MOVE_PERCENT:   0.13,
  MAX_TRADES_PER_DAY: 10,
  MIN_BALANCE:       1.0,
  CANDLE_INTERVAL:   'Min1',
  TREND_CANDLES:     3,
  MIN_MOVE_PCT:      0.01,
}

// ─── SIGNATURE ───────────────────────────────────────────────────────────────

function sign(accessKey: string, secretKey: string, timestamp: string, params = '') {
  return crypto
    .createHmac('sha256', secretKey)
    .update(accessKey + timestamp + params)
    .digest('hex')
}

function getHeaders(params = '') {
  const timestamp = Date.now().toString()
  return {
    'Content-Type': 'application/json',
    'ApiKey':       CONFIG.ACCESS_KEY,
    'Request-Time': timestamp,
    'Signature':    sign(CONFIG.ACCESS_KEY, CONFIG.SECRET_KEY, timestamp, params),
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function apiGet(path: string, queryParams: Record<string, string | number> = {}) {
  const sorted = Object.entries(queryParams)
    .filter(([, v]) => v !== null && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const headers = getHeaders(sorted)
  const url = `${CONFIG.BASE_URL}${path}${sorted ? '?' + sorted : ''}`
  const res = await fetch(url, { method: 'GET', headers })
  return res.json()
}

// ─── CANDLES + TREND ─────────────────────────────────────────────────────────

interface Candle { time: number; open: number; close: number; high: number; low: number }

async function getCandles(symbol: string, limit = 5): Promise<Candle[]> {
  const res = await apiGet('/api/v1/contract/kline', {
    symbol,
    interval: CONFIG.CANDLE_INTERVAL,
    limit,
  })

  if (!res.success || !res.data) return []

  return (res.data.time || []).map((t: number, i: number) => ({
    time:  t,
    open:  parseFloat(res.data.open?.[i]  || 0),
    close: parseFloat(res.data.close?.[i] || 0),
    high:  parseFloat(res.data.high?.[i]  || 0),
    low:   parseFloat(res.data.low?.[i]   || 0),
  }))
}

function detectTrend(candles: Candle[]): 'LONG' | 'SHORT' | null {
  if (candles.length < CONFIG.TREND_CANDLES) return null

  const recent = candles.slice(-CONFIG.TREND_CANDLES)

  const allGreen = recent.every(c => {
    const movePct = Math.abs(c.close - c.open) / c.open * 100
    return c.close > c.open && movePct >= CONFIG.MIN_MOVE_PCT
  })

  const allRed = recent.every(c => {
    const movePct = Math.abs(c.close - c.open) / c.open * 100
    return c.close < c.open && movePct >= CONFIG.MIN_MOVE_PCT
  })

  if (allGreen) return 'LONG'
  if (allRed)   return 'SHORT'
  return null
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

  const candles = await getCandles(CONFIG.SYMBOL)
  logs.push(`Fetched ${candles.length} candles`)

  const trend = detectTrend(candles)
  logs.push(`Trend: ${trend ?? 'NONE — skipping'}`)

  if (!trend) {
    return { success: true, skipped: true, reason: 'No clear trend', candles: candles.slice(-3), logs }
  }

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
