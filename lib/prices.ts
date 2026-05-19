import { TechnicalIndicators } from '@/types'

const BINANCE_SPOT    = 'https://api.binance.com'
const BINANCE_FUTURES = 'https://fapi.binance.com'

// Binance spot symbols
const BINANCE_SYMBOL: Record<string, string> = {
  BTC:   'BTCUSDT',
  ETH:   'ETHUSDT',
  XAU:   'PAXGUSDT',   // Pax Gold — 1:1 gold proxy
  DOGE:  'DOGEUSDT',
  PEPE:  'PEPEUSDT',
  WIF:   'WIFUSDT',
  SHIB:  'SHIBUSDT',
  BONK:  'BONKUSDT',
  FLOKI: 'FLOKIUSDT',
  SOL:   'SOLUSDT',
  TRUMP: 'TRUMPUSDT',
}

// Binance perpetual futures symbols (subset with active perp markets)
const FUTURES_SYMBOL: Record<string, string> = {
  BTC:  'BTCUSDT',
  ETH:  'ETHUSDT',
  DOGE: 'DOGEUSDT',
  SOL:  'SOLUSDT',
  WIF:  'WIFUSDT',
  PEPE: '1000PEPEUSDT',
  SHIB: '1000SHIBUSDT',
  BONK: '1000BONKUSDT',
}

export interface Candle {
  timestamp: number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export type PriceMap = Record<string, { price: number; change_24h: number }>
export type { TechnicalIndicators }

// ─── Indicator math ────────────────────────────────────────────────────────

function parseKline(k: unknown[]): Candle {
  return {
    timestamp: k[0] as number,
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }
}

function calcEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return []
  const k = 2 / (period + 1)
  const emas = [prices[0]]
  for (let i = 1; i < prices.length; i++) {
    emas.push(prices[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50
  const changes = prices.slice(1).map((p, i) => p - prices[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss -= changes[i]
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

// True Range ATR — uses candle high/low/prev-close, not just close-to-close
function calcTrueRangeATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prev),
      Math.abs(candles[i].low  - prev),
    ))
  }
  const recent = trs.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

// Swing detection using wick highs/lows — more accurate than close-only
function findSwings(candles: Candle[], currentPrice: number, lookback = 5) {
  const swingHighs: number[] = []
  const swingLows:  number[] = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1)
    const maxHigh = Math.max(...window.map(c => c.high))
    const minLow  = Math.min(...window.map(c => c.low))
    if (candles[i].high === maxHigh) swingHighs.push(candles[i].high)
    if (candles[i].low  === minLow)  swingLows.push(candles[i].low)
  }
  const resistances = [...new Set(swingHighs)]
    .filter(h => h > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 3)
  const supports = [...new Set(swingLows)]
    .filter(l => l < currentPrice)
    .sort((a, b) => b - a)
    .slice(0, 3)
  return { resistances, supports }
}

export function computeIndicators(
  candles: Candle[],
  currentPrice: number,
  weeklyCandles: Candle[] = [],
  fundingRate: number | null = null,
): TechnicalIndicators | null {
  if (candles.length < 50) return null

  const closes  = [...candles.map(c => c.close), currentPrice]
  const volumes = candles.map(c => c.volume)
  const n = closes.length

  // 24h range from wick highs/lows
  const high24h = Math.max(...candles.map(c => c.high), currentPrice)
  const low24h  = Math.min(...candles.map(c => c.low),  currentPrice)
  const distFromHigh = ((currentPrice - high24h) / high24h) * 100
  const distFromLow  = ((currentPrice - low24h)  / low24h)  * 100

  // Swing-based support/resistance from wick data
  const { resistances, supports } = findSwings(candles, currentPrice)
  const nearestResistance = resistances[0] ?? high24h
  const nearestSupport    = supports[0]    ?? low24h

  // EMAs on close series
  const ema8arr  = calcEMA(closes, 8)
  const ema21arr = calcEMA(closes, 21)
  const ema50arr = calcEMA(closes, 50)
  const ema8  = ema8arr[ema8arr.length   - 1]
  const ema21 = ema21arr[ema21arr.length - 1]
  const ema50 = ema50arr[ema50arr.length - 1]
  const priceVsEma21 = ((currentPrice - ema21) / ema21) * 100
  const emaTrend: TechnicalIndicators['emaTrend'] =
    ema8 > ema21 && ema21 > ema50 ? 'bullish' :
    ema8 < ema21 && ema21 < ema50 ? 'bearish' : 'neutral'

  // RSI
  const rsi = calcRSI(closes, 14)
  const rsiZone: TechnicalIndicators['rsiZone'] =
    rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'

  // Momentum: 5-min candles → 6 back = 30 min, 12 back = 1 h
  const price30mAgo = closes[Math.max(0, n - 7)]
  const price1hAgo  = closes[Math.max(0, n - 13)]
  const momentum30m = ((currentPrice - price30mAgo) / price30mAgo) * 100
  const momentum1h  = ((currentPrice - price1hAgo)  / price1hAgo)  * 100

  // Proper ATR using true range
  const atr    = calcTrueRangeATR(candles, 14)
  const atrPct = (atr / currentPrice) * 100

  // Volume: last 30 min vs 24 h average
  const avgVol    = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const recentVol = volumes.length >= 6
    ? volumes.slice(-6).reduce((a, b) => a + b, 0) / 6
    : avgVol
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1

  const suggestedSlLong  = nearestSupport    > 0 ? nearestSupport    - atr : currentPrice - atr * 2
  const suggestedSlShort = nearestResistance > 0 ? nearestResistance + atr : currentPrice + atr * 2

  const trend: TechnicalIndicators['trend'] =
    emaTrend === 'bullish' ? 'up' : emaTrend === 'bearish' ? 'down' : 'sideways'

  // 24h price structure: 12 h ago → 6 h ago → now (5-min candles: 144=12 h, 72=6 h)
  const price12hAgo = closes[Math.max(0, n - 145)]
  const price6hAgo  = closes[Math.max(0, n - 73)]
  const priceStructure: TechnicalIndicators['priceStructure'] =
    price12hAgo < price6hAgo && price6hAgo < currentPrice ? 'uptrend' :
    price12hAgo > price6hAgo && price6hAgo > currentPrice ? 'downtrend' : 'sideways'

  // Weekly bias from hourly candles (168 h = 7 days)
  let weeklyBias: TechnicalIndicators['weeklyBias'] = 'neutral'
  if (weeklyCandles.length >= 2) {
    const wStart = weeklyCandles[0].close
    const wEnd   = weeklyCandles[weeklyCandles.length - 1].close
    weeklyBias =
      wEnd > wStart * 1.02 ? 'bullish' :
      wEnd < wStart * 0.98 ? 'bearish' : 'neutral'
  }

  return {
    high24h, low24h, distFromHigh, distFromLow,
    resistances, supports, nearestResistance, nearestSupport,
    ema8, ema21, ema50, emaTrend, priceVsEma21,
    rsi, rsiZone, momentum30m, momentum1h,
    atr, atrPct, volumeRatio,
    suggestedSlLong, suggestedSlShort,
    priceStructure, weeklyBias,
    fundingRate,
    sma4h: ema21, priceVsSma: priceVsEma21, momentum4h: momentum1h,
    avgHourlyVol: atrPct, trend,
  }
}

// ─── Fetch functions ────────────────────────────────────────────────────────

async function binanceFetch(url: string, revalidate?: number): Promise<unknown> {
  const opts: RequestInit = revalidate !== undefined
    ? { next: { revalidate } }
    : { cache: 'no-store' }
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`Binance fetch failed ${res.status}: ${url}`)
  return res.json()
}

// Current prices + 24 h change for multiple symbols in one request
export async function fetchCurrentPrices(symbols: string[]): Promise<PriceMap> {
  const binSyms = symbols.map(s => BINANCE_SYMBOL[s]).filter(Boolean)
  if (!binSyms.length) return {}

  const param = encodeURIComponent(JSON.stringify(binSyms))
  const url = `${BINANCE_SPOT}/api/v3/ticker/24hr?symbols=${param}`
  try {
    const data = await binanceFetch(url) as Array<{
      symbol: string; lastPrice: string; priceChangePercent: string
    }>
    const result: PriceMap = {}
    for (const sym of symbols) {
      const binSym = BINANCE_SYMBOL[sym]
      if (!binSym) continue
      const ticker = data.find(d => d.symbol === binSym)
      if (!ticker) continue
      result[sym] = {
        price:     parseFloat(ticker.lastPrice),
        change_24h: parseFloat(ticker.priceChangePercent),
      }
    }
    return result
  } catch {
    return {}
  }
}

// 5-min OHLCV candles for the last 24 h (288 candles)
export async function fetchPriceHistory(symbol: string): Promise<Candle[]> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return []
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/klines?symbol=${binSym}&interval=5m&limit=288`,
    ) as unknown[][]
    return data.map(parseKline)
  } catch {
    return []
  }
}

// 1-h OHLCV candles for the last 7 days (168 candles) — weekly bias
export async function fetchWeeklyHistory(symbol: string): Promise<Candle[]> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return []
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/klines?symbol=${binSym}&interval=1h&limit=168`,
    ) as unknown[][]
    return data.map(parseKline)
  } catch {
    return []
  }
}

// Latest perpetual funding rate for a symbol
// Positive = longs pay shorts (bullish skew, slight bearish pressure)
// Negative = shorts pay longs (bearish skew, slight bullish pressure)
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  const futSym = FUTURES_SYMBOL[symbol]
  if (!futSym) return null
  try {
    const data = await binanceFetch(
      `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${futSym}&limit=1`,
    ) as Array<{ fundingRate: string }>
    return data.length ? parseFloat(data[0].fundingRate) : null
  } catch {
    return null
  }
}

// Close prices for the sparkline chart (UI only — 5 min cache)
export async function fetchSparklineHistory(symbol: string): Promise<number[]> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return []
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/klines?symbol=${binSym}&interval=5m&limit=288`,
      300,
    ) as unknown[][]
    return data.map(k => parseFloat(k[4] as string))
  } catch {
    return []
  }
}

// High/low/current over a time window — used by check-prices for TP/SL detection
// Binance 1-min klines give true intra-minute highs/lows, more accurate than CoinGecko
export async function fetchHighLow(
  symbol: string,
  fromMs: number,
  toMs: number,
): Promise<{ high: number; low: number; current: number } | null> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return null
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/klines?symbol=${binSym}&interval=1m&startTime=${fromMs}&endTime=${toMs}`,
    ) as unknown[][]
    if (!data.length) return null
    const candles = data.map(parseKline)
    return {
      high:    Math.max(...candles.map(c => c.high)),
      low:     Math.min(...candles.map(c => c.low)),
      current: candles[candles.length - 1].close,
    }
  } catch {
    return null
  }
}

// Price of a symbol at a specific UTC timestamp (±5 min)
export async function fetchPriceAtTime(symbol: string, utcTimestamp: number): Promise<number | null> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return null
  const from = utcTimestamp - 300_000
  const to   = utcTimestamp + 300_000
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/klines?symbol=${binSym}&interval=1m&startTime=${from}&endTime=${to}`,
    ) as unknown[][]
    if (!data.length) return null
    const candles = data.map(parseKline)
    const closest = candles.reduce((best, c) =>
      Math.abs(c.timestamp - utcTimestamp) < Math.abs(best.timestamp - utcTimestamp) ? c : best,
    )
    return closest.close
  } catch {
    return null
  }
}

// ─── Order book walls ──────────────────────────────────────────────────────

export interface OrderBookWall {
  price: number
  notionalUsd: number  // price × qty — indicates wall strength
}

export interface OrderBookData {
  bidWalls: OrderBookWall[]  // large buy orders below price = support zones
  askWalls: OrderBookWall[]  // large sell orders above price = resistance zones
}

// Fetch top 100 bid/ask levels, find the 3 largest notional clusters on each side
export async function fetchOrderBookWalls(symbol: string): Promise<OrderBookData | null> {
  const binSym = BINANCE_SYMBOL[symbol]
  if (!binSym) return null
  try {
    const data = await binanceFetch(
      `${BINANCE_SPOT}/api/v3/depth?symbol=${binSym}&limit=100`,
    ) as { bids: [string, string][]; asks: [string, string][] }

    const toWalls = (levels: [string, string][]): OrderBookWall[] =>
      levels
        .map(([p, q]) => ({ price: parseFloat(p), notionalUsd: parseFloat(p) * parseFloat(q) }))
        .sort((a, b) => b.notionalUsd - a.notionalUsd)
        .slice(0, 3)

    return { bidWalls: toWalls(data.bids), askWalls: toWalls(data.asks) }
  } catch {
    return null
  }
}

// ─── Market sentiment (perpetual futures) ──────────────────────────────────

export interface MarketSentiment {
  longRatio: number    // fraction of accounts that are long (0.58 = 58%)
  shortRatio: number   // fraction short
  openInterest: number // current OI in base currency (BTC, ETH …)
  oiChangePct: number  // % change vs previous 5-min interval (rising = conviction)
}

export async function fetchMarketSentiment(symbol: string): Promise<MarketSentiment | null> {
  const futSym = FUTURES_SYMBOL[symbol]
  if (!futSym) return null
  try {
    const [lsRaw, oiRaw] = await Promise.all([
      binanceFetch(
        `${BINANCE_FUTURES}/futures/data/globalLongShortAccountRatio?symbol=${futSym}&period=5m&limit=1`,
      ),
      binanceFetch(
        `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=${futSym}&period=5m&limit=2`,
      ),
    ]) as [
      Array<{ longAccount: string; shortAccount: string }>,
      Array<{ sumOpenInterest: string }>,
    ]

    if (!lsRaw.length) return null

    const longRatio  = parseFloat(lsRaw[0].longAccount)
    const shortRatio = parseFloat(lsRaw[0].shortAccount)

    let openInterest = 0, oiChangePct = 0
    if (oiRaw.length >= 2) {
      const prev = parseFloat(oiRaw[0].sumOpenInterest)
      const curr = parseFloat(oiRaw[1].sumOpenInterest)
      openInterest = curr
      oiChangePct  = prev > 0 ? ((curr - prev) / prev) * 100 : 0
    } else if (oiRaw.length === 1) {
      openInterest = parseFloat(oiRaw[0].sumOpenInterest)
    }

    return { longRatio, shortRatio, openInterest, oiChangePct }
  } catch {
    return null
  }
}

export async function fetchAllPrices(memeCoin = 'DOGE'): Promise<PriceMap> {
  try {
    return await fetchCurrentPrices(['BTC', 'ETH', 'XAU', memeCoin])
  } catch {
    return {}
  }
}

// Prices for all session symbols at a specific UTC timestamp
export async function fetchPricesAtTime(
  symbols: string[],
  utcTimestamp: number,
): Promise<Record<string, number>> {
  const results = await Promise.all(
    symbols.map(async s => {
      const price = await fetchPriceAtTime(s, utcTimestamp)
      return [s, price] as [string, number | null]
    }),
  )
  return Object.fromEntries(results.filter(([, p]) => p !== null)) as Record<string, number>
}
