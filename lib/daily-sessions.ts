import { GoogleGenerativeAI } from '@google/generative-ai'
import { TechnicalIndicators } from '@/types'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']

export type SessionKey = 'asia' | 'london' | 'newyork'

export interface SessionConfig {
  name: string
  flag: string
  openUTC: number
  closeUTC: number
  character: string
}

export const SESSIONS: Record<SessionKey, SessionConfig> = {
  asia: {
    name: 'Asia',
    flag: '🌏',
    openUTC: 0,
    closeUTC: 8,
    character: 'Risk sentiment, JPY/AUD institutional flows, thin liquidity — fakeouts common, trend is set by the previous NY close',
  },
  london: {
    name: 'London',
    flag: '🇬🇧',
    openUTC: 9,
    closeUTC: 17,
    character: 'Heaviest institutional flow of the day — defines the day\'s trend. EUR/GBP correlation. Smart money shows its hand here',
  },
  newyork: {
    name: 'New York',
    flag: '🇺🇸',
    openUTC: 13,
    closeUTC: 21,
    character: 'Equity market correlation, macro data releases, momentum continuation or reversal. Most volatile 2h is 13:00–15:00 UTC',
  },
}

export interface DailyPrediction {
  symbol: string
  open_price: number
  predicted_close: number
  predicted_direction: 'up' | 'down'
  predicted_pct: number
  confidence: number
  reasoning: string
}

interface AssetInput {
  symbol: string
  price: number
  change_24h: number
  indicators: TechnicalIndicators | null
  priceHistory: number[]
}

interface PastRecord {
  session: string
  session_date: string
  symbol: string
  open_price: number
  close_price: number
  predicted_direction: string
  predicted_close: number
  predicted_pct: number
  outcome: string | null
}

function plain(n: number): string {
  if (n < 0.0001) return n.toFixed(8)
  if (n < 1) return n.toFixed(6)
  if (n < 100) return n.toFixed(3)
  return n.toFixed(2)
}

function buildPrompt(session: SessionKey, assets: AssetInput[], past: PastRecord[]): string {
  const cfg = SESSIONS[session]
  const now = new Date().toUTCString()
  const sessionDate = new Date().toISOString().slice(0, 10)
  const hours = cfg.closeUTC - cfg.openUTC

  // Build self-learning track record
  let perfBlock = ''
  if (past.length > 0) {
    const bySymbol: Record<string, { correct: number; total: number }> = {}
    const bySession: Record<string, { correct: number; total: number }> = {}
    for (const r of past) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { correct: 0, total: 0 }
      if (!bySession[r.session]) bySession[r.session] = { correct: 0, total: 0 }
      bySymbol[r.symbol].total++
      bySession[r.session].total++
      if (r.outcome === 'correct') { bySymbol[r.symbol].correct++; bySession[r.session].correct++ }
    }
    const overall = past.filter(r => r.outcome === 'correct').length
    const winPct = Math.round((overall / past.length) * 100)

    const symLines = Object.entries(bySymbol)
      .map(([sym, s]) => `    ${sym.padEnd(10)}: ${s.correct}/${s.total} (${Math.round(s.correct / s.total * 100)}%)`)
      .join('\n')
    const sesLines = Object.entries(bySession)
      .map(([ses, s]) => `    ${ses.padEnd(10)}: ${s.correct}/${s.total} (${Math.round(s.correct / s.total * 100)}%)`)
      .join('\n')
    const recent = past.slice(-5).map(r =>
      `    ${r.session_date} ${r.session.padEnd(9)} ${r.symbol.padEnd(10)}: predicted ${r.predicted_direction.toUpperCase()} @ $${plain(r.predicted_close)} — open $${plain(r.open_price)} → close $${plain(r.close_price)} → ${r.outcome === 'correct' ? '✓ CORRECT' : '✗ WRONG'}`
    ).join('\n')

    perfBlock = `
━━━ YOUR DAILY PREDICTION TRACK RECORD (${past.length} evaluated) ━━━
Overall accuracy: ${overall}/${past.length} — ${winPct}% correct

By asset:
${symLines}

By session:
${sesLines}

Recent predictions:
${recent}

→ Diagnose your mistakes. If you keep getting a specific asset or session wrong, adjust your bias. Do NOT repeat the same errors.
`
  }

  // Per-asset technical data
  const assetBlocks = assets.map(a => {
    const ind = a.indicators
    const ph = a.priceHistory
    const n = ph.length
    const p12h = n > 0 ? ph[Math.max(0, n - 145)] : a.price
    const p6h  = n > 0 ? ph[Math.max(0, n - 73)] : a.price
    const p3h  = n > 0 ? ph[Math.max(0, n - 37)] : a.price
    const p1h  = n > 0 ? ph[Math.max(0, n - 13)] : a.price
    const trajectory = `12h: $${plain(p12h)} → 6h: $${plain(p6h)} → 3h: $${plain(p3h)} → 1h: $${plain(p1h)} → Now: $${plain(a.price)}`

    return `━━━ ${a.symbol} ━━━
  Open price (this session): $${plain(a.price)}
  24h change: ${a.change_24h >= 0 ? '+' : ''}${a.change_24h.toFixed(2)}%
  Price trajectory: ${trajectory}
${ind ? `  24h Range: $${plain(ind.low24h)} — $${plain(ind.high24h)}
  EMA (8/21/50): $${plain(ind.ema8)} / $${plain(ind.ema21)} / $${plain(ind.ema50)} → ${ind.emaTrend.toUpperCase()}
  RSI(14): ${ind.rsi.toFixed(1)} [${ind.rsiZone.toUpperCase()}]
  Structure: ${ind.priceStructure.toUpperCase()} | Weekly bias: ${ind.weeklyBias.toUpperCase()}
  Volume: ${ind.volumeRatio >= 1.5 ? '🔥 HIGH (strong conviction)' : ind.volumeRatio <= 0.6 ? '⚠ LOW (weak conviction)' : `normal (${ind.volumeRatio.toFixed(2)}×)`}
  Nearest resistance: $${plain(ind.nearestResistance)} | Support: $${plain(ind.nearestSupport)}
  Momentum: 30m ${ind.momentum30m >= 0 ? '+' : ''}${ind.momentum30m.toFixed(3)}% | 1h ${ind.momentum1h >= 0 ? '+' : ''}${ind.momentum1h.toFixed(3)}%` : '  Insufficient technical data — rely on price trajectory and 24h context'}`
  }).join('\n\n')

  return `You are the best macro and technical analyst in the world, running a high-conviction daily futures book.

━━━ MISSION ━━━
At the open of every major trading session, you predict where each asset closes at session end.
You are measured on accuracy. Your track record above is your report card — learn from it.

━━━ SESSION ━━━
${cfg.flag} ${cfg.name.toUpperCase()} | ${now}
Window: ${cfg.openUTC}:00 → ${cfg.closeUTC}:00 UTC (${hours} hours) | Date: ${sessionDate}
Character: ${cfg.character}
${perfBlock}
━━━ MARKET DATA AT SESSION OPEN ━━━
${assetBlocks}

━━━ ANALYTICAL FRAMEWORK ━━━

You are forecasting a ${hours}-hour directional move — not a scalp. Think at the session level:

1. MACRO FLOW — What is the dominant risk narrative today? (risk-on = crypto/gold up; risk-off = dollar up, alts down)
2. SESSION BIAS — ${cfg.name} session historically ${cfg.character}. Does current structure support continuation or reversal?
3. WEEKLY + DAILY STRUCTURE — Weekly bias and 24h price structure define the path of least resistance.
4. KEY LEVELS — Where is price most likely to gravitate by ${cfg.closeUTC}:00 UTC? What resistance or support will it test?
5. MOMENTUM — Is the current trajectory (12h→6h→3h→1h) likely to continue into this session or exhaust?
6. VOLUME CONFIRMATION — High volume on the move? Trust it. Low volume? Fade or reduce confidence.

GIVE A SPECIFIC PRICE, not a range. Commit to a number.
CONFIDENCE should reflect how clearly the factors align — 0.8+ only when weekly, daily, and session all agree.

━━━ OUTPUT — JSON only, no other text ━━━
{
  "predictions": [
    {
      "symbol": "BTC/USD",
      "predicted_direction": "up",
      "predicted_close": 81500.00,
      "predicted_pct": 1.88,
      "confidence": 0.74,
      "reasoning": "Weekly bias bullish, EMA stack aligned long, London session typically amplifies Asia direction when volume confirms. Resistance at $82,200 — targeting a test by close. RSI 52 leaves room to run."
    }
  ]
}`
}

function isRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted')
}

export async function generateDailyPredictions(
  session: SessionKey,
  assets: AssetInput[],
  past: PastRecord[],
): Promise<DailyPrediction[]> {
  const prompt = buildPrompt(session, assets, past)
  let lastError: unknown

  for (const modelId of MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId })
      const result = await model.generateContent(prompt)
      const text = result.response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error(`${modelId} returned no JSON`)
      const parsed = JSON.parse(jsonMatch[0]) as { predictions: DailyPrediction[] }

      const validated: DailyPrediction[] = []
      for (const p of parsed.predictions) {
        const asset = assets.find(a => a.symbol === p.symbol)
        if (!asset || !p.predicted_close || p.confidence <= 0) continue

        // Reject if predicted close is unrealistically far from open (>15%)
        const deviation = Math.abs((p.predicted_close - asset.price) / asset.price)
        if (deviation > 0.15) {
          console.warn(`[daily] Dropped ${p.symbol}: predicted_close ${p.predicted_close} is ${(deviation * 100).toFixed(1)}% from open`)
          continue
        }

        // Ensure direction matches predicted_close vs open
        const impliedDir = p.predicted_close >= asset.price ? 'up' : 'down'
        validated.push({
          symbol: p.symbol,
          open_price: asset.price,
          predicted_close: p.predicted_close,
          predicted_direction: impliedDir,
          predicted_pct: ((p.predicted_close - asset.price) / asset.price) * 100,
          confidence: Math.min(1, Math.max(0, p.confidence)),
          reasoning: p.reasoning ?? '',
        })
      }

      console.log(`[daily] ${validated.length}/${parsed.predictions.length} valid predictions via ${modelId}`)
      return validated
    } catch (err) {
      lastError = err
      if (isRateLimitError(err)) { console.warn(`[daily] ${modelId} rate limited`); continue }
      console.warn(`[daily] ${modelId} failed: ${err}`)
    }
  }

  throw new Error(`All models failed. Last: ${lastError}`)
}
