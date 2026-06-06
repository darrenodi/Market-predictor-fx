/**
 * MEXC Bot Scheduler
 * File: /api/bot-scheduler.js
 * 
 * Runs automatically via Vercel Cron Jobs
 * Add to vercel.json:
 * {
 *   "crons": [
 *     { "path": "/api/bot-scheduler", "schedule": "0 8-18 * * 1-5" }
 *   ]
 * }
 * 
 * This fires every hour Mon-Fri between 8am-6pm UTC
 * (London + NY active sessions where Gold moves most)
 * 
 * Alternatively call this endpoint manually from ModuVise dashboard
 */

import crypto from 'crypto';

const CONFIG = {
  ACCESS_KEY: process.env.MEXC_ACCESS_KEY,
  SECRET_KEY: process.env.MEXC_SECRET_KEY,
  BASE_URL: 'https://contract.mexc.com',
  BOT_URL: process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000/api/bot',
  BOT_SECRET: process.env.BOT_SECRET,

  // Strategy
  SYMBOL: 'XAUT_USDT',
  LEVERAGE: 100,
  TP_ROE_PERCENT: 9.9,
  MAX_TRADES_PER_DAY: 10,
  MIN_BALANCE: 1.0,

  // Trend detection
  CANDLE_INTERVAL: 'Min1',     // 1-minute candles
  TREND_CANDLES: 3,            // Need 3 green/red candles to confirm trend
  MIN_MOVE_PCT: 0.01,          // Minimum 0.01% move per candle to qualify
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sign(accessKey, secretKey, timestamp, params = '') {
  const target = accessKey + timestamp + params;
  return crypto.createHmac('sha256', secretKey).update(target).digest('hex');
}

function getHeaders(params = '') {
  const timestamp = Date.now().toString();
  return {
    'Content-Type': 'application/json',
    'ApiKey': CONFIG.ACCESS_KEY,
    'Request-Time': timestamp,
    'Signature': sign(CONFIG.ACCESS_KEY, CONFIG.SECRET_KEY, timestamp, params),
  };
}

async function apiGet(path, queryParams = {}) {
  const sorted = Object.keys(queryParams)
    .sort()
    .filter(k => queryParams[k] !== null)
    .map(k => `${k}=${queryParams[k]}`)
    .join('&');

  const headers = getHeaders(sorted);
  const url = `${CONFIG.BASE_URL}${path}${sorted ? '?' + sorted : ''}`;
  const res = await fetch(url, { method: 'GET', headers });
  return res.json();
}

// ─── TREND DETECTION ─────────────────────────────────────────────────────────

/**
 * Fetch last N 1-minute candles for symbol
 * Returns array of { open, close, high, low }
 */
async function getCandles(symbol, limit = 5) {
  const res = await apiGet('/api/v1/contract/kline', {
    symbol,
    interval: CONFIG.CANDLE_INTERVAL,
    limit,
  });

  if (!res.success || !res.data) return [];

  // MEXC kline format: [time, open, close, high, low, vol, amount]
  return (res.data.time || []).map((t, i) => ({
    time: t,
    open: parseFloat(res.data.open?.[i] || 0),
    close: parseFloat(res.data.close?.[i] || 0),
    high: parseFloat(res.data.high?.[i] || 0),
    low: parseFloat(res.data.low?.[i] || 0),
  }));
}

/**
 * Detect trend direction from candles
 * Returns: 'LONG' | 'SHORT' | null (no clear trend)
 * 
 * Rules:
 * - 3 consecutive green candles (close > open) → LONG
 * - 3 consecutive red candles (close < open) → SHORT
 * - Each candle must move at least MIN_MOVE_PCT
 * - Filters out choppy/sideways candles
 */
function detectTrend(candles) {
  if (candles.length < CONFIG.TREND_CANDLES) return null;

  // Take last N candles
  const recent = candles.slice(-CONFIG.TREND_CANDLES);

  const allGreen = recent.every(c => {
    const movePct = Math.abs(c.close - c.open) / c.open * 100;
    return c.close > c.open && movePct >= CONFIG.MIN_MOVE_PCT;
  });

  const allRed = recent.every(c => {
    const movePct = Math.abs(c.close - c.open) / c.open * 100;
    return c.close < c.open && movePct >= CONFIG.MIN_MOVE_PCT;
  });

  if (allGreen) return 'LONG';
  if (allRed) return 'SHORT';
  return null; // choppy — skip this cycle
}

// ─── TRADE COUNT TRACKING ─────────────────────────────────────────────────────

/**
 * Simple daily trade counter using a global (resets on Vercel cold start)
 * For persistent counting, use your ModuVise DB/localStorage
 */
const tradeState = {
  date: '',
  count: 0,
};

function getTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  if (tradeState.date !== today) {
    tradeState.date = today;
    tradeState.count = 0;
  }
  return tradeState.count;
}

function incrementCount() {
  tradeState.count++;
}

// ─── MAIN SCHEDULER ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Vercel cron jobs send GET requests
  // Manual triggers from ModuVise dashboard send POST
  
  const logs = [];
  const timestamp = new Date().toISOString();
  logs.push(`[${timestamp}] Scheduler triggered`);

  try {
    // 1. Check daily trade limit
    const todayCount = getTodayCount();
    logs.push(`Trades today: ${todayCount}/${CONFIG.MAX_TRADES_PER_DAY}`);

    if (todayCount >= CONFIG.MAX_TRADES_PER_DAY) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: `Daily limit reached: ${todayCount}/${CONFIG.MAX_TRADES_PER_DAY}`,
        logs,
      });
    }

    // 2. Check balance via bot status
    const statusRes = await fetch(`${CONFIG.BOT_URL}?action=status`, {
      headers: { 'x-bot-secret': CONFIG.BOT_SECRET },
    });
    const status = await statusRes.json();
    logs.push(`Balance: $${status.balance?.toFixed(4)}`);
    logs.push(`Open position: ${status.hasOpenPosition}`);

    if (!status.success) {
      return res.status(200).json({ 
        success: false, 
        reason: 'Status check failed', 
        status, 
        logs 
      });
    }

    // 3. Skip if position already open
    if (status.hasOpenPosition) {
      logs.push('Position open — waiting for TP hit');
      return res.status(200).json({ 
        success: true, 
        skipped: true, 
        reason: 'Position open', 
        logs 
      });
    }

    // 4. Skip if balance too low
    if (status.balance < CONFIG.MIN_BALANCE) {
      return res.status(200).json({ 
        success: false, 
        reason: `Balance too low: $${status.balance}`, 
        logs 
      });
    }

    // 5. Detect trend
    const candles = await getCandles(CONFIG.SYMBOL);
    logs.push(`Fetched ${candles.length} candles`);

    const trend = detectTrend(candles);
    logs.push(`Trend detected: ${trend || 'NONE — skipping'}`);

    if (!trend) {
      return res.status(200).json({ 
        success: true, 
        skipped: true, 
        reason: 'No clear trend', 
        candles: candles.slice(-3),
        logs 
      });
    }

    // 6. Execute trade
    logs.push(`Placing ${trend} trade...`);
    const tradeRes = await fetch(CONFIG.BOT_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-bot-secret': CONFIG.BOT_SECRET,
      },
      body: JSON.stringify({ action: 'trade', direction: trend }),
    });

    const tradeResult = await tradeRes.json();
    logs.push(`Trade result: ${tradeResult.success ? 'SUCCESS' : 'FAILED'}`);
    logs.push(`Message: ${tradeResult.message}`);

    if (tradeResult.success) {
      incrementCount();
      logs.push(`Total trades today: ${getTodayCount()}`);
    }

    return res.status(200).json({
      success: tradeResult.success,
      trend,
      trade: tradeResult.trade,
      tradesRemaining: CONFIG.MAX_TRADES_PER_DAY - getTodayCount(),
      logs,
    });

  } catch (err) {
    logs.push(`ERROR: ${err.message}`);
    return res.status(500).json({ 
      success: false, 
      error: err.message, 
      logs 
    });
  }
}
