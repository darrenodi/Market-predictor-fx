/**
 * MEXC Futures Trading Bot
 * Route: /api/mexcbot
 *
 * GET  ?action=status
 * POST { action: "trade",  direction: "LONG"|"SHORT" }         — open entry limit
 * POST { action: "close",  direction: "LONG"|"SHORT",
 *        volume: N, price: N }                                  — post-only TP exit
 * POST { action: "config", symbol?, leverage?, tpMove? }
 *
 * MEXC futures sides:
 *   1 = Open Long   3 = Open Short
 *   4 = Close Long  2 = Close Short
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  ACCESS_KEY:            process.env.MEXC_ACCESS_KEY || '',
  SECRET_KEY:            process.env.MEXC_SECRET_KEY || '',
  BASE_URL:              'https://contract.mexc.com',
  SYMBOL:               'BTC_USDT',
  CONTRACT_SIZE:        0.0001,        // 1 contract = 0.0001 BTC
  LEVERAGE_MIN:         60,            // randomised per trade to disguise automation
  LEVERAGE_MAX:         70,
  TP_MOVE_FLOOR:        0.13,          // minimum TP % — never goes below (fee floor)
  TP_MOVE_CEILING:      0.20,          // maximum TP % — oscillates within range
  DIRECTION:            'LONG' as 'LONG' | 'SHORT',
  LIMIT_OFFSET_PERCENT: 0.002,
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
    'Content-Type':  'application/json',
    'ApiKey':        CONFIG.ACCESS_KEY,
    'Request-Time':  timestamp,
    'Signature':     sign(CONFIG.ACCESS_KEY, CONFIG.SECRET_KEY, timestamp, params),
  }
}

// ─── API CALLS ───────────────────────────────────────────────────────────────

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

async function apiPost(path: string, body: object = {}) {
  const bodyStr = JSON.stringify(body)
  const headers = getHeaders(bodyStr)
  const res = await fetch(`${CONFIG.BASE_URL}${path}`, { method: 'POST', headers, body: bodyStr })
  return res.json()
}

// ─── MARKET DATA ─────────────────────────────────────────────────────────────

async function getBalance(): Promise<number> {
  const res = await apiGet('/api/v1/private/account/assets')
  if (!res.success) throw new Error(`Balance failed: ${res.message}`)
  const usdt = res.data?.find((a: { currency: string; availableBalance: string }) => a.currency === 'USDT')
  return parseFloat(usdt?.availableBalance || 0)
}

async function getMarkPrice(symbol: string): Promise<number> {
  const res = await apiGet('/api/v1/contract/ticker', { symbol })
  if (!res.success) throw new Error(`Price failed: ${res.message}`)
  return parseFloat(res.data?.lastPrice || res.data?.fairPrice)
}

async function getOpenPosition(symbol: string) {
  const res = await apiGet('/api/v1/private/position/open_positions', { symbol })
  if (!res.success) throw new Error(`Position failed: ${res.message}`)
  return res.data?.[0] || null
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calcVolume(balance: number, leverage: number, price: number) {
  return Math.max(Math.floor((balance * leverage) / (price * CONFIG.CONTRACT_SIZE)), 1)
}

// ─── TRADE ACTIONS ───────────────────────────────────────────────────────────

async function executeTrade(direction: 'LONG' | 'SHORT') {
  const logs: string[] = []
  try {
    const openPos = await getOpenPosition(CONFIG.SYMBOL)
    if (openPos) return { success: false, message: 'Position already open', position: openPos }

    const [balance, price] = await Promise.all([getBalance(), getMarkPrice(CONFIG.SYMBOL)])
    logs.push(`Balance: $${balance.toFixed(4)}`, `BTC: $${price}`)

    if (balance < 1) return { success: false, message: `Balance too low: $${balance}` }

    // Randomise leverage + TP each trade to disguise automation patterns
    const leverage  = Math.floor(Math.random() * (CONFIG.LEVERAGE_MAX - CONFIG.LEVERAGE_MIN + 1)) + CONFIG.LEVERAGE_MIN
    const tpMovePct = parseFloat((CONFIG.TP_MOVE_FLOOR + Math.random() * (CONFIG.TP_MOVE_CEILING - CONFIG.TP_MOVE_FLOOR)).toFixed(4))

    await apiPost('/api/v1/private/position/change_leverage', {
      symbol: CONFIG.SYMBOL, leverage, openType: 1,
      positionType: direction === 'LONG' ? 1 : 2,
    })

    const offset  = price * (CONFIG.LIMIT_OFFSET_PERCENT / 100)
    const entry   = direction === 'LONG' ? price + offset : price - offset
    const tpMove  = entry * (tpMovePct / 100)
    const tpPrice = direction === 'LONG' ? entry + tpMove : entry - tpMove
    const volume  = calcVolume(balance, leverage, price)
    const posSize = volume * price * CONFIG.CONTRACT_SIZE

    logs.push(`${direction}  lev=${leverage}×  TP=${tpMovePct}%  entry=$${entry.toFixed(2)}  tpPrice=$${tpPrice.toFixed(2)}  vol=${volume}  pos=$${posSize.toFixed(2)}`)

    const order = await apiPost('/api/v1/private/order/submit', {
      symbol:   CONFIG.SYMBOL,
      price:    parseFloat(entry.toFixed(2)),
      vol:      volume,
      leverage,
      side:     direction === 'LONG' ? 1 : 3,   // 1=Open Long  3=Open Short
      type:     1,    // limit (maker entry)
      openType: 1,    // isolated margin
    })
    logs.push(`Order: ${JSON.stringify(order)}`)

    return {
      success: order.success,
      message: order.success ? 'Order placed' : order.message,
      order,
      trade: { symbol: CONFIG.SYMBOL, direction, balance, price, entry, tpPrice, volume, posSize, leverage, tpMovePct },
      logs,
    }
  } catch (err) {
    return { success: false, message: String(err), logs }
  }
}

async function executeClose(direction: 'LONG' | 'SHORT', volume: number, price: number) {
  const logs: string[] = []
  try {
    const orderBody = {
      symbol:   CONFIG.SYMBOL,
      price:    parseFloat(price.toFixed(2)),
      vol:      volume,
      leverage: CONFIG.LEVERAGE_MIN,
      side:     direction === 'LONG' ? 4 : 2,   // 4=Close Long  2=Close Short
      type:     2,    // Post-Only — forced maker, rejected if would be taker
      openType: 1,
    }
    const order = await apiPost('/api/v1/private/order/submit', orderBody)
    logs.push(`Post-Only close: ${JSON.stringify(order)}`)
    return {
      success: order.success,
      message: order.success ? 'Post-Only exit placed (maker fee guaranteed)' : order.message,
      order, logs,
    }
  } catch (err) {
    return { success: false, message: String(err), logs }
  }
}

async function getStatus() {
  try {
    const [balance, position, price] = await Promise.all([
      getBalance(),
      getOpenPosition(CONFIG.SYMBOL),
      getMarkPrice(CONFIG.SYMBOL),
    ])
    return {
      success: true, balance, price,
      symbol: CONFIG.SYMBOL, leverageRange: `${CONFIG.LEVERAGE_MIN}–${CONFIG.LEVERAGE_MAX}`,
      tpFloor: CONFIG.TP_MOVE_FLOOR, tpCeiling: CONFIG.TP_MOVE_CEILING,
      openPosition: position || null, hasOpenPosition: !!position,
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest) {
  return req.headers.get('x-bot-secret') === process.env.BOT_SECRET
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const action = req.nextUrl.searchParams.get('action')
  if (action === 'status') return NextResponse.json(await getStatus())
  return NextResponse.json({ error: 'Unknown action. Use: status' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    action?: string; direction?: string
    symbol?: string; leverage?: number; tpMove?: number
    volume?: number; price?: number
  }
  const { action, direction, symbol, leverage, tpMove, volume, price } = body

  if (action === 'config') {
    if (symbol)   CONFIG.SYMBOL = symbol
    if (tpMove)   CONFIG.TP_MOVE_FLOOR = tpMove
    return NextResponse.json({ success: true, config: CONFIG })
  }

  if (action === 'trade') {
    const dir = (direction || CONFIG.DIRECTION) as 'LONG' | 'SHORT'
    if (!['LONG', 'SHORT'].includes(dir))
      return NextResponse.json({ error: 'direction must be LONG or SHORT' }, { status: 400 })
    return NextResponse.json(await executeTrade(dir))
  }

  if (action === 'close') {
    const dir = direction as 'LONG' | 'SHORT'
    if (!['LONG', 'SHORT'].includes(dir))
      return NextResponse.json({ error: 'direction must be LONG or SHORT' }, { status: 400 })
    if (!volume || !price)
      return NextResponse.json({ error: 'volume and price required for close' }, { status: 400 })
    return NextResponse.json(await executeClose(dir, volume, price))
  }

  return NextResponse.json({ error: 'Unknown action. Use: trade | close | config' }, { status: 400 })
}
