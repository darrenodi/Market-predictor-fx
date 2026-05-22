#!/usr/bin/env node
/**
 * BTC Futures Scalper — MEXC Post-Only Strategy
 *
 * Run:  node Bot/btc-scalper.js [auto|LONG|SHORT]
 *   auto  — AI signal from ModuVise (≥70% confidence), candle trend as fallback
 *   LONG  — always long
 *   SHORT — always short
 *
 * Fee model (matches calculator simulation):
 *   Entry : type=1 limit  → maker 0.01%
 *   Exit  : type=2 post-only → forced maker 0.01%
 *   Round-trip: 0.02%  (vs 0.091% with built-in TP = 4.5× savings)
 *
 * Matches simulation settings:
 *   Symbol   BTC_USDT  |  Leverage  60×
 *   TP move  0.13%     |  Max trades 10/day
 */

import crypto from 'crypto'
import fs     from 'fs'
import path   from 'path'
import { fileURLToPath } from 'url'

// ─── LOAD .env.local ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.resolve(__dirname, '../.env.local')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...rest] = line.split('=')
    if (k && !k.startsWith('#') && rest.length)
      process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '')
  })
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const C = {
  ACCESS_KEY:           process.env.MEXC_ACCESS_KEY || '',
  SECRET_KEY:           process.env.MEXC_SECRET_KEY || '',
  BASE_URL:             'https://contract.mexc.com',

  SYMBOL:               'BTC_USDT',
  CONTRACT_SIZE:        0.0001,      // 1 contract = 0.0001 BTC
  LEVERAGE_MIN:         60,          // randomised per trade to avoid patterns
  LEVERAGE_MAX:         70,
  TP_MOVE_FLOOR:        0.13,        // minimum TP move % — never decreases
  TP_MOVE_DRIFT:        0.005,       // max random increment added after each trade
  ENTRY_OFFSET_PERCENT: 0.002,       // limit entry offset from mark price

  MAX_TRADES_PER_DAY:   10,
  FILL_TIMEOUT_MS:      30_000,      // cancel entry if not filled in 30s
  POLL_MS:              1_000,       // position poll interval
  EXIT_RETRIES:         3,           // post-only exit retry attempts
  SLEEP_BETWEEN_MS:     3_000,       // pause between trade cycles

  CANDLE_INTERVAL:      'Min1',
  TREND_CANDLES:        3,
  MIN_CANDLE_MOVE_PCT:  0.01,

  // AI signal settings
  SIGNAL_URL:           process.env.MODUVISE_URL || 'http://localhost:3001',
  MIN_CONFIDENCE:       0.70,       // skip trade if BTC signal below this
  SIGNAL_CACHE_MS:      15 * 60 * 1000,  // reuse signal for 15 min to save API calls
}

// ─── STATE (persisted to disk so restarts never reset the TP floor) ───────────

const STATE_FILE = path.resolve(__dirname, '.scalper-state.json')

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      // Only restore tpMove — daily counters always reset fresh
      return { date: '', trades: 0, pnl: 0, tpMove: Math.max(saved.tpMove ?? C.TP_MOVE_FLOOR, C.TP_MOVE_FLOOR) }
    }
  } catch {}
  return { date: '', trades: 0, pnl: 0, tpMove: C.TP_MOVE_FLOOR }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ tpMove: state.tpMove }, null, 2))
}

const state = loadState()

const signalCache = { direction: null, confidence: 0, reasoning: '', fetchedAt: 0 }

function todayTrades() {
  const today = new Date().toISOString().slice(0, 10)
  if (state.date !== today) { state.date = today; state.trades = 0; state.pnl = 0 }
  return state.trades
}

// ─── SIGNATURE ────────────────────────────────────────────────────────────────

function sign(ts, params = '') {
  return crypto.createHmac('sha256', C.SECRET_KEY)
    .update(C.ACCESS_KEY + ts + params).digest('hex')
}

function headers(params = '') {
  const ts = Date.now().toString()
  return {
    'Content-Type': 'application/json',
    'ApiKey':        C.ACCESS_KEY,
    'Request-Time':  ts,
    'Signature':     sign(ts, params),
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function GET(path, query = {}) {
  const qs = Object.entries(query)
    .filter(([, v]) => v != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('&')
  const url = `${C.BASE_URL}${path}${qs ? '?' + qs : ''}`
  const res = await fetch(url, { method: 'GET', headers: headers(qs) })
  return res.json()
}

async function POST(path, body = {}) {
  const str = JSON.stringify(body)
  const res = await fetch(`${C.BASE_URL}${path}`, { method: 'POST', headers: headers(str), body: str })
  return res.json()
}

// ─── MARKET DATA ──────────────────────────────────────────────────────────────

async function getBalance() {
  const r = await GET('/api/v1/private/account/assets')
  if (!r.success) throw new Error(`Balance: ${r.message}`)
  const usdt = r.data?.find(a => a.currency === 'USDT')
  return parseFloat(usdt?.availableBalance || 0)
}

async function getMarkPrice() {
  const r = await GET('/api/v1/contract/ticker', { symbol: C.SYMBOL })
  if (!r.success) throw new Error(`Price: ${r.message}`)
  return parseFloat(r.data?.lastPrice || r.data?.fairPrice)
}

async function getOpenPosition() {
  const r = await GET('/api/v1/private/position/open_positions', { symbol: C.SYMBOL })
  if (!r.success) throw new Error(`Position: ${r.message}`)
  return r.data?.[0] || null
}

async function getCandles(limit = 5) {
  const r = await GET('/api/v1/contract/kline', { symbol: C.SYMBOL, interval: C.CANDLE_INTERVAL, limit })
  if (!r.success || !r.data) return []
  return (r.data.time || []).map((t, i) => ({
    time:  t,
    open:  parseFloat(r.data.open?.[i]  || 0),
    close: parseFloat(r.data.close?.[i] || 0),
  }))
}

// ─── DIRECTION ────────────────────────────────────────────────────────────────

/** Candle trend — 3 consecutive green/red 1-min candles. Used as fallback. */
async function candleTrend() {
  const candles = await getCandles(C.TREND_CANDLES + 1)
  if (candles.length < C.TREND_CANDLES) return null
  const recent = candles.slice(-C.TREND_CANDLES)
  const ok = c => Math.abs(c.close - c.open) / c.open * 100 >= C.MIN_CANDLE_MOVE_PCT
  if (recent.every(c => c.close > c.open && ok(c))) return 'LONG'
  if (recent.every(c => c.close < c.open && ok(c))) return 'SHORT'
  return null
}

/**
 * Fetch BTC direction from ModuVise AI signal engine.
 * Caches for 15 min — Claude API is called only when cache expires.
 * Falls back to candle trend if the signal endpoint is unreachable or
 * returns no BTC signal.
 */
async function getAIDirection() {
  // Return cached signal if still fresh
  const cacheAge = Date.now() - signalCache.fetchedAt
  if (signalCache.direction && cacheAge < C.SIGNAL_CACHE_MS) {
    log(`Signal (cached ${Math.round(cacheAge / 60000)}m ago): ${signalCache.direction} @ ${(signalCache.confidence * 100).toFixed(0)}%`)
    return signalCache.direction
  }

  try {
    log('Fetching AI signal from ModuVise…')
    const res = await fetch(`${C.SIGNAL_URL}/api/instant`, {
      signal: AbortSignal.timeout(90_000),  // Claude can take a while
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    const btc = data.signals?.find(s => s.symbol === 'BTC')
    if (!btc) {
      log('No BTC signal in response — falling back to candle trend')
      return candleTrend()
    }

    const pct = (btc.confidence * 100).toFixed(0)
    log(`AI signal → ${btc.direction} @ ${pct}% confidence`)
    if (btc.reasoning) log(`Reason: ${btc.reasoning.slice(0, 100)}…`)

    if (btc.confidence < C.MIN_CONFIDENCE) {
      log(`Confidence ${pct}% < ${C.MIN_CONFIDENCE * 100}% minimum — skipping trade`)
      return null
    }

    // Update cache
    signalCache.direction  = btc.direction
    signalCache.confidence = btc.confidence
    signalCache.reasoning  = btc.reasoning || ''
    signalCache.fetchedAt  = Date.now()

    return btc.direction

  } catch (err) {
    log(`Signal fetch failed (${err.message}) — falling back to candle trend`)
    return candleTrend()
  }
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────

// MEXC futures sides:
//   1 = Open Long   2 = Close Short (used to close a short position)
//   3 = Open Short  4 = Close Long  (used to close a long position)

function openSide(dir)  { return dir === 'LONG' ? 1 : 3 }
function closeSide(dir) { return dir === 'LONG' ? 4 : 2 }


async function placeEntry(dir, volume, entryPrice, leverage) {
  return POST('/api/v1/private/order/submit', {
    symbol:   C.SYMBOL,
    price:    parseFloat(entryPrice.toFixed(2)),
    vol:      volume,
    leverage,
    side:     openSide(dir),
    type:     1,          // limit (maker)
    openType: 1,          // isolated margin
  })
}

async function placePostOnlyExit(dir, volume, tpPrice, leverage) {
  return POST('/api/v1/private/order/submit', {
    symbol:   C.SYMBOL,
    price:    parseFloat(tpPrice.toFixed(2)),
    vol:      volume,
    leverage,
    side:     closeSide(dir),
    type:     2,          // Post-Only — forced maker, cancelled if would be taker
    openType: 1,
  })
}

async function placeMarketExit(dir, volume, leverage) {
  log('⚠ post-only failed 3× — closing with market order (taker fee applies)')
  return POST('/api/v1/private/order/submit', {
    symbol:   C.SYMBOL,
    vol:      volume,
    leverage,
    side:     closeSide(dir),
    type:     5,          // market (fallback only)
    openType: 1,
  })
}

async function cancelOrder(orderId) {
  return POST('/api/v1/private/order/cancel', { orderId })
}

// ─── POLL HELPERS ─────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** Wait until a BTC position appears (entry fill confirmed) */
async function waitForFill(orderId) {
  const deadline = Date.now() + C.FILL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const pos = await getOpenPosition()
    if (pos) return pos
    await sleep(C.POLL_MS)
  }
  // timed out — cancel the entry order
  await cancelOrder(orderId)
  return null
}

/** Wait until the open position disappears (TP or SL hit) */
async function waitForClose() {
  while (true) {
    const pos = await getOpenPosition()
    if (!pos) return
    await sleep(C.POLL_MS)
  }
}

// ─── LOGGING ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args)
}

function fmtUsd(n) { return `$${n.toFixed(4)}` }

// ─── TRADE CYCLE ──────────────────────────────────────────────────────────────

async function runTrade(dir) {
  // Random leverage 60–70 each trade to avoid MEXC pattern detection
  const leverage = Math.floor(Math.random() * (C.LEVERAGE_MAX - C.LEVERAGE_MIN + 1)) + C.LEVERAGE_MIN
  const tpMovePct = state.tpMove

  log(`── Trade #${todayTrades() + 1} / ${C.MAX_TRADES_PER_DAY} ─── ${dir}  lev=${leverage}×  TP=${tpMovePct.toFixed(3)}%`)

  // 1. Guard: no existing position
  if (await getOpenPosition()) { log('Position already open — skipping'); return false }

  // 2. Get balance + price
  const [balance, price] = await Promise.all([getBalance(), getMarkPrice()])
  log(`Balance: ${fmtUsd(balance)}  |  BTC: $${price.toLocaleString()}`)
  if (balance < 1) { log('Balance too low'); return false }

  // 3. Set leverage (randomised)
  await POST('/api/v1/private/position/change_leverage', {
    symbol: C.SYMBOL, leverage, openType: 1, positionType: dir === 'LONG' ? 1 : 2,
  })

  // 4. Calculate sizes — no SL, confidence drives direction
  const offset     = price * (C.ENTRY_OFFSET_PERCENT / 100)
  const entryPrice = dir === 'LONG' ? price + offset : price - offset
  const tpMove     = entryPrice * (tpMovePct / 100)
  const tpPrice    = dir === 'LONG' ? entryPrice + tpMove : entryPrice - tpMove
  const volume     = Math.max(Math.floor((balance * leverage) / (price * C.CONTRACT_SIZE)), 1)
  const posSize    = volume * price * C.CONTRACT_SIZE

  log(`Entry: $${entryPrice.toFixed(2)}  TP: $${tpPrice.toFixed(2)}  Vol: ${volume}  Pos: $${posSize.toFixed(2)}`)

  // 5. Place limit entry
  const entryOrder = await placeEntry(dir, volume, entryPrice, leverage)
  if (!entryOrder.success) { log('Entry rejected:', entryOrder.message); return false }
  log(`Entry order placed → id: ${entryOrder.data}`)

  // 6. Wait for fill
  log('Waiting for fill…')
  const pos = await waitForFill(entryOrder.data)
  if (!pos) { log('Entry not filled in 30s — cancelled'); return false }

  const filled = parseFloat(pos.openAvgPrice || entryPrice)
  log(`✓ Filled at $${filled.toFixed(2)}`)

  // 7. Place Post-Only exit (retry up to EXIT_RETRIES times)
  let exitPlaced = false
  for (let attempt = 1; attempt <= C.EXIT_RETRIES; attempt++) {
    const exitOrder = await placePostOnlyExit(dir, volume, tpPrice, leverage)
    if (exitOrder.success) {
      log(`✓ Post-Only exit placed (attempt ${attempt}) → id: ${exitOrder.data}`)
      exitPlaced = true
      break
    }
    log(`Post-Only rejected (attempt ${attempt}): ${exitOrder.message} — retrying…`)
    await sleep(500)
  }

  if (!exitPlaced) await placeMarketExit(dir, volume, leverage)

  // 8. Wait for position to close
  log('Waiting for TP…')
  await waitForClose()

  // 9. PnL (gross - 2× maker, 0.01% each side)
  const gross = posSize * (tpMovePct / 100)
  const fee   = posSize * 0.0002
  const net   = gross - fee
  state.trades++
  state.pnl += net

  log(`✓ Trade closed  Gross: ${fmtUsd(gross)}  Fee: ${fmtUsd(fee)}  Net: ${fmtUsd(net)}`)

  // 10. Drift TP floor upward — always positive, persisted to disk
  const drift = C.TP_MOVE_DRIFT * (0.3 + Math.random() * 0.7)  // 30–100% of max drift
  state.tpMove = Math.max(parseFloat((state.tpMove + drift).toFixed(4)), C.TP_MOVE_FLOOR)
  saveState()
  log(`TP floor → ${state.tpMove.toFixed(4)}%  (persisted)`)

  log(`Day total: ${state.trades} trades  PnL: ${fmtUsd(state.pnl)}  TP floor: ${state.tpMove.toFixed(4)}%`)
  return true
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function main() {
  const modeArg = process.argv[2]?.toUpperCase() || 'AUTO'

  if (!C.ACCESS_KEY || !C.SECRET_KEY) {
    console.error('❌  MEXC_ACCESS_KEY / MEXC_SECRET_KEY not set in .env.local')
    process.exit(1)
  }

  log(`BTC Scalper started  mode=${modeArg}  leverage=${C.LEVERAGE}×  TP=${C.TP_MOVE_PERCENT}%`)

  while (true) {
    try {
      if (todayTrades() >= C.MAX_TRADES_PER_DAY) {
        log(`Daily limit reached (${C.MAX_TRADES_PER_DAY}) — sleeping 60s`)
        await sleep(60_000)
        continue
      }

      let dir = null
      if (modeArg === 'LONG')  dir = 'LONG'
      else if (modeArg === 'SHORT') dir = 'SHORT'
      else {
        dir = await getAIDirection()
        if (!dir) { log('No valid signal — waiting 60s'); await sleep(60_000); continue }
      }

      const traded = await runTrade(dir)
      // Invalidate cache after a completed trade so next cycle gets a fresh signal
      if (traded) signalCache.fetchedAt = 0

    } catch (err) {
      log('ERROR:', err.message)
    }

    await sleep(C.SLEEP_BETWEEN_MS)
  }
}

main()
