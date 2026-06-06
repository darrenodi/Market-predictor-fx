/**
 * MEXC Futures Trading Bot
 * Next.js API Route: /api/bot
 * 
 * Strategy:
 * - Asset: BTC, Gold (XAUT), or ETH
 * - Leverage: 100x (configurable)
 * - Entry: Limit order (maker = 0.08% API fee)
 * - TP: ROE-based (configurable %)
 * - SL: None until balance > $100
 * - One position at a time
 * - Auto-compounds full balance each trade
 * - 10 trades per day target
 */

import crypto from 'crypto';

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const CONFIG = {
  ACCESS_KEY: process.env.MEXC_ACCESS_KEY,
  SECRET_KEY: process.env.MEXC_SECRET_KEY,
  BASE_URL: 'https://contract.mexc.com', // Futures base URL
  
  // Trading parameters
  SYMBOL: 'XAUT_USDT',        // Gold. Options: 'BTC_USDT', 'ETH_USDT', 'XAUT_USDT'
  LEVERAGE: 100,               // 100x leverage
  TP_ROE_PERCENT: 9.9,         // Take profit at 9.9% ROE (~$2.22 gold move at 200x)
  SL_ROE_PERCENT: null,        // No SL until balance > $100
  SL_THRESHOLD_BALANCE: 100,   // Enable SL when balance exceeds this
  SL_ROE_ACTIVE: 18.5,         // SL ROE% when active
  DIRECTION: 'LONG',           // 'LONG' or 'SHORT' — set per trade
  MAX_TRADES_PER_DAY: 10,
  LIMIT_OFFSET_PERCENT: 0.002, // Place limit 0.002% above/below current price
};

// ─── SIGNATURE ───────────────────────────────────────────────────────────────

function sign(accessKey, secretKey, timestamp, params = '') {
  const target = accessKey + timestamp + params;
  return crypto
    .createHmac('sha256', secretKey)
    .update(target)
    .digest('hex');
}

function getHeaders(params = '') {
  const timestamp = Date.now().toString();
  const signature = sign(CONFIG.ACCESS_KEY, CONFIG.SECRET_KEY, timestamp, params);
  return {
    'Content-Type': 'application/json',
    'ApiKey': CONFIG.ACCESS_KEY,
    'Request-Time': timestamp,
    'Signature': signature,
  };
}

// ─── API CALLS ───────────────────────────────────────────────────────────────

async function apiGet(path, queryParams = {}) {
  const sorted = Object.keys(queryParams)
    .sort()
    .filter(k => queryParams[k] !== null && queryParams[k] !== undefined)
    .map(k => `${k}=${queryParams[k]}`)
    .join('&');

  const headers = getHeaders(sorted);
  const url = `${CONFIG.BASE_URL}${path}${sorted ? '?' + sorted : ''}`;
  
  const res = await fetch(url, { method: 'GET', headers });
  return res.json();
}

async function apiPost(path, body = {}) {
  const bodyStr = JSON.stringify(body);
  const headers = getHeaders(bodyStr);
  const url = `${CONFIG.BASE_URL}${path}`;
  
  const res = await fetch(url, { 
    method: 'POST', 
    headers,
    body: bodyStr,
  });
  return res.json();
}

// ─── TRADING FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Get current futures account balance in USDT
 */
async function getBalance() {
  const res = await apiGet('/api/v1/private/account/assets');
  if (!res.success) throw new Error(`Balance fetch failed: ${res.message}`);
  
  const usdt = res.data?.find(a => a.currency === 'USDT');
  return parseFloat(usdt?.availableBalance || 0);
}

/**
 * Get current mark price for symbol
 */
async function getMarkPrice(symbol) {
  const res = await apiGet('/api/v1/contract/ticker', { symbol });
  if (!res.success) throw new Error(`Price fetch failed: ${res.message}`);
  return parseFloat(res.data?.lastPrice || res.data?.fairPrice);
}

/**
 * Get open positions for symbol
 */
async function getOpenPosition(symbol) {
  const res = await apiGet('/api/v1/private/position/open_positions', { symbol });
  if (!res.success) throw new Error(`Position fetch failed: ${res.message}`);
  return res.data?.[0] || null;
}

/**
 * Set leverage for symbol
 */
async function setLeverage(symbol, leverage) {
  const res = await apiPost('/api/v1/private/position/change_leverage', {
    symbol,
    leverage,
    openType: 1, // 1 = isolated margin
    positionType: 1, // 1 = long
  });
  return res;
}

/**
 * Calculate position size in contracts based on full balance
 * MEXC Gold contract: 1 contract = 0.0001 XAUT
 * MEXC BTC contract: 1 contract = 0.0001 BTC
 */
async function calcVolume(symbol, balance, leverage, price) {
  // Position value = balance * leverage
  const positionValue = balance * leverage;
  
  // For XAUT_USDT: 1 contract = 0.001 XAUT
  // Volume in contracts = positionValue / (price * contractSize)
  const contractSizes = {
    'XAUT_USDT': 0.001,
    'BTC_USDT': 0.0001,
    'ETH_USDT': 0.01,
  };
  
  const contractSize = contractSizes[symbol] || 0.0001;
  const volume = Math.floor(positionValue / (price * contractSize));
  return Math.max(volume, 1);
}

/**
 * Calculate TP price from ROE percentage
 * ROE% = (priceMove / entryPrice) * leverage * 100
 * priceMove = (ROE% * entryPrice) / (leverage * 100)
 */
function calcTPPrice(entryPrice, roePct, leverage, direction) {
  const priceMove = (roePct * entryPrice) / (leverage * 100);
  return direction === 'LONG'
    ? entryPrice + priceMove
    : entryPrice - priceMove;
}

function calcSLPrice(entryPrice, roePct, leverage, direction) {
  const priceMove = (roePct * entryPrice) / (leverage * 100);
  return direction === 'LONG'
    ? entryPrice - priceMove
    : entryPrice + priceMove;
}

/**
 * Place a limit order with TP (and optional SL)
 */
async function placeOrder(symbol, direction, volume, price, tpPrice, slPrice) {
  const side = direction === 'LONG' ? 1 : 2; // 1=long open, 2=short open
  
  const orderBody = {
    symbol,
    price: parseFloat(price.toFixed(2)),
    vol: volume,
    leverage: CONFIG.LEVERAGE,
    side,
    type: 1,       // 1 = limit order (maker)
    openType: 1,   // 1 = isolated margin
    tpType: 1,     // 1 = mark price TP
    tpPrice: parseFloat(tpPrice.toFixed(2)),
  };

  // Add SL if balance > threshold
  if (slPrice) {
    orderBody.slType = 1;
    orderBody.slPrice = parseFloat(slPrice.toFixed(2));
  }

  const res = await apiPost('/api/v1/private/order/submit', orderBody);
  return res;
}

// ─── MAIN BOT LOGIC ──────────────────────────────────────────────────────────

/**
 * Execute one trade cycle:
 * 1. Check no open position
 * 2. Get balance + price
 * 3. Calculate sizes
 * 4. Place limit order with TP
 * 5. Return trade details
 */
async function executeTrade(direction = CONFIG.DIRECTION) {
  const logs = [];
  
  try {
    // 1. Check for existing position
    const openPos = await getOpenPosition(CONFIG.SYMBOL);
    if (openPos) {
      return { 
        success: false, 
        message: 'Position already open', 
        position: openPos 
      };
    }

    // 2. Get balance and price
    const balance = await getBalance();
    const price = await getMarkPrice(CONFIG.SYMBOL);
    
    logs.push(`Balance: $${balance.toFixed(4)} USDT`);
    logs.push(`${CONFIG.SYMBOL} Price: $${price}`);

    if (balance < 1) {
      return { success: false, message: `Balance too low: $${balance}` };
    }

    // 3. Set leverage
    await setLeverage(CONFIG.SYMBOL, CONFIG.LEVERAGE);

    // 4. Calculate entry price (limit slightly ahead of market)
    const offset = price * (CONFIG.LIMIT_OFFSET_PERCENT / 100);
    const entryPrice = direction === 'LONG' 
      ? price + offset   // Buy just above for quick fill
      : price - offset;  // Sell just below for quick fill

    // 5. Calculate TP and SL prices
    const tpPrice = calcTPPrice(entryPrice, CONFIG.TP_ROE_PERCENT, CONFIG.LEVERAGE, direction);
    const slPrice = balance > CONFIG.SL_THRESHOLD_BALANCE
      ? calcSLPrice(entryPrice, CONFIG.SL_ROE_ACTIVE, CONFIG.LEVERAGE, direction)
      : null;

    // 6. Calculate volume (contracts)
    const volume = await calcVolume(CONFIG.SYMBOL, balance, CONFIG.LEVERAGE, price);

    logs.push(`Direction: ${direction}`);
    logs.push(`Entry: $${entryPrice.toFixed(2)}`);
    logs.push(`TP: $${tpPrice.toFixed(2)} (${CONFIG.TP_ROE_PERCENT}% ROE)`);
    logs.push(slPrice 
      ? `SL: $${slPrice.toFixed(2)} (${CONFIG.SL_ROE_ACTIVE}% ROE)` 
      : `SL: None (balance < $${CONFIG.SL_THRESHOLD_BALANCE})`
    );
    logs.push(`Volume: ${volume} contracts`);
    logs.push(`Position value: $${(volume * price * 0.001).toFixed(2)}`);

    // 7. Place order
    const order = await placeOrder(
      CONFIG.SYMBOL,
      direction,
      volume,
      entryPrice,
      tpPrice,
      slPrice
    );

    logs.push(`Order result: ${JSON.stringify(order)}`);

    return {
      success: order.success,
      message: order.success ? 'Order placed' : order.message,
      order,
      trade: {
        symbol: CONFIG.SYMBOL,
        direction,
        balance,
        price,
        entryPrice,
        tpPrice,
        slPrice,
        volume,
        leverage: CONFIG.LEVERAGE,
        tpROE: CONFIG.TP_ROE_PERCENT,
      },
      logs,
    };

  } catch (err) {
    return { 
      success: false, 
      message: err.message, 
      logs 
    };
  }
}

/**
 * Get current bot status — balance, open position, daily trade count
 */
async function getStatus() {
  try {
    const [balance, position, price] = await Promise.all([
      getBalance(),
      getOpenPosition(CONFIG.SYMBOL),
      getMarkPrice(CONFIG.SYMBOL),
    ]);

    return {
      success: true,
      balance,
      price,
      symbol: CONFIG.SYMBOL,
      leverage: CONFIG.LEVERAGE,
      tpROE: CONFIG.TP_ROE_PERCENT,
      slThreshold: CONFIG.SL_THRESHOLD_BALANCE,
      openPosition: position || null,
      hasOpenPosition: !!position,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── NEXT.JS API HANDLER ─────────────────────────────────────────────────────

/**
 * API Routes:
 * 
 * GET  /api/bot?action=status          — Get balance, position, price
 * POST /api/bot { action: "trade", direction: "LONG"|"SHORT" }  — Execute trade
 * POST /api/bot { action: "config", ...overrides }              — Update config
 */
export default async function handler(req, res) {
  // Security: simple API key check (add MEXC_BOT_SECRET to .env)
  const botSecret = req.headers['x-bot-secret'];
  if (botSecret !== process.env.BOT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { action } = req.query;
      
      if (action === 'status') {
        const status = await getStatus();
        return res.status(200).json(status);
      }
      
      return res.status(400).json({ error: 'Unknown action. Use: status' });
    }

    if (req.method === 'POST') {
      const { action, direction, symbol, leverage, tpROE } = req.body;

      // Update config on the fly
      if (action === 'config') {
        if (symbol) CONFIG.SYMBOL = symbol;
        if (leverage) CONFIG.LEVERAGE = leverage;
        if (tpROE) CONFIG.TP_ROE_PERCENT = tpROE;
        return res.status(200).json({ success: true, config: CONFIG });
      }

      // Execute a trade
      if (action === 'trade') {
        const tradeDirection = direction || CONFIG.DIRECTION;
        if (!['LONG', 'SHORT'].includes(tradeDirection)) {
          return res.status(400).json({ error: 'direction must be LONG or SHORT' });
        }
        
        const result = await executeTrade(tradeDirection);
        return res.status(200).json(result);
      }

      return res.status(400).json({ 
        error: 'Unknown action. Use: trade | config' 
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Bot error:', err);
    return res.status(500).json({ error: err.message });
  }
}
