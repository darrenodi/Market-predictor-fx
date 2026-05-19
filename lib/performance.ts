import { supabaseAdmin } from '@/lib/supabase'

export interface PerformanceSummary {
  total: number
  tp: number
  sl: number
  winRate: number
  bySymbol: Record<string, { tp: number; sl: number }>
  byDirection: { long: { tp: number; sl: number }; short: { tp: number; sl: number } }
  bySession: Record<string, { tp: number; sl: number }>
  // symbol + direction + session combos (only entries with ≥5 closed trades)
  patterns: Array<{ key: string; tp: number; sl: number; wr: number }>
  // does our confidence score actually predict outcomes?
  byConfidence: Record<string, { tp: number; sl: number }>
}

function sessionLabel(createdAt: string): string {
  const h = new Date(createdAt).getUTCHours()
  if (h >= 13 && h < 16) return 'London/NY Overlap'
  if (h >= 16 && h < 21) return 'New York'
  if (h >= 8 && h < 13) return 'London'
  return 'Asia/Off-hours'
}

function winPct(tp: number, sl: number): number {
  const total = tp + sl
  return total === 0 ? 0 : Math.round((tp / total) * 100)
}

export async function fetchPerformanceSummary(): Promise<PerformanceSummary | null> {
  try {
    const { data } = await supabaseAdmin
      .from('signals')
      .select('symbol, direction, status, created_at, confidence')
      .in('status', ['tp_hit', 'sl_hit'])
      .order('created_at', { ascending: false })
      .limit(500)

    if (!data?.length) return null

    const summary: PerformanceSummary = {
      total: data.length,
      tp: 0, sl: 0, winRate: 0,
      bySymbol: {},
      byDirection: { long: { tp: 0, sl: 0 }, short: { tp: 0, sl: 0 } },
      bySession: {},
      patterns: [],
      byConfidence: {
        '50-59%': { tp: 0, sl: 0 },
        '60-69%': { tp: 0, sl: 0 },
        '70-79%': { tp: 0, sl: 0 },
        '80%+':   { tp: 0, sl: 0 },
      },
    }

    const patternMap: Record<string, { tp: number; sl: number }> = {}

    for (const row of data) {
      const isTP = row.status === 'tp_hit'
      if (isTP) summary.tp++; else summary.sl++

      if (!summary.bySymbol[row.symbol]) summary.bySymbol[row.symbol] = { tp: 0, sl: 0 }
      if (isTP) summary.bySymbol[row.symbol].tp++; else summary.bySymbol[row.symbol].sl++

      const dir = row.direction as 'long' | 'short'
      if (isTP) summary.byDirection[dir].tp++; else summary.byDirection[dir].sl++

      const session = sessionLabel(row.created_at)
      if (!summary.bySession[session]) summary.bySession[session] = { tp: 0, sl: 0 }
      if (isTP) summary.bySession[session].tp++; else summary.bySession[session].sl++

      // Pattern: symbol + direction + session
      const patKey = `${row.symbol} ${dir.toUpperCase()} @ ${session}`
      if (!patternMap[patKey]) patternMap[patKey] = { tp: 0, sl: 0 }
      if (isTP) patternMap[patKey].tp++; else patternMap[patKey].sl++

      // Confidence tier
      const conf = (row.confidence ?? 0) * 100
      const tier = conf >= 80 ? '80%+' : conf >= 70 ? '70-79%' : conf >= 60 ? '60-69%' : '50-59%'
      if (isTP) summary.byConfidence[tier].tp++; else summary.byConfidence[tier].sl++
    }

    // Only keep patterns with ≥5 closed trades, sorted by win rate
    summary.patterns = Object.entries(patternMap)
      .filter(([, s]) => s.tp + s.sl >= 5)
      .map(([key, s]) => ({ key, tp: s.tp, sl: s.sl, wr: winPct(s.tp, s.sl) }))
      .sort((a, b) => b.wr - a.wr)

    summary.winRate = winPct(summary.tp, summary.sl)
    return summary
  } catch {
    return null
  }
}

export function formatPerformanceForPrompt(p: PerformanceSummary): string {
  const trend = (tp: number, sl: number) => {
    const pct = winPct(tp, sl)
    if (pct >= 65) return '✓ strong'
    if (pct <= 40) return '✗ weak'
    return ''
  }

  const symbolLines = Object.entries(p.bySymbol)
    .map(([sym, s]) => `  ${sym.padEnd(10)}: ${s.tp} TP / ${s.sl} SL (${winPct(s.tp, s.sl)}%) ${trend(s.tp, s.sl)}`)
    .join('\n')

  const sessionLines = Object.entries(p.bySession)
    .sort(([, a], [, b]) => winPct(b.tp, b.sl) - winPct(a.tp, a.sl))
    .map(([ses, s]) => `  ${ses.padEnd(20)}: ${s.tp} TP / ${s.sl} SL (${winPct(s.tp, s.sl)}%) ${trend(s.tp, s.sl)}`)
    .join('\n')

  const { long, short } = p.byDirection

  return `━━━ YOUR SIGNAL TRACK RECORD (all-time, ${p.total} trades) ━━━
Overall: ${p.tp} TP / ${p.sl} SL — ${p.winRate}% win rate

By asset:
${symbolLines}

By direction:
  Long : ${long.tp} TP / ${long.sl} SL (${winPct(long.tp, long.sl)}%) ${trend(long.tp, long.sl)}
  Short: ${short.tp} TP / ${short.sl} SL (${winPct(short.tp, short.sl)}%) ${trend(short.tp, short.sl)}

By session:
${sessionLines}

→ Increase confidence for setups matching ✓ strong patterns. Pull back on ✗ weak ones — adjust direction or skip if no catalyst.

Pattern edge (symbol + direction + session, ≥5 trades):
${p.patterns.length === 0 ? '  Insufficient data' : p.patterns.slice(0, 8).map(pat => {
    const flag = pat.wr >= 65 ? ' ✓ EDGE' : pat.wr <= 40 ? ' ✗ AVOID' : ''
    return `  ${pat.key.padEnd(48)}: ${pat.tp} TP / ${pat.sl} SL (${pat.wr}%)${flag}`
  }).join('\n')}

Does your confidence score actually predict outcomes?
${Object.entries(p.byConfidence).map(([tier, s]) => {
    const wr = winPct(s.tp, s.sl)
    const total = s.tp + s.sl
    if (total === 0) return `  ${tier}: no data`
    const flag = wr >= 67 ? ' ✓ profitable' : wr <= 50 ? ' ✗ losing' : ' — marginal'
    return `  ${tier}: ${s.tp} TP / ${s.sl} SL (${wr}%)${flag}`
  }).join('\n')}
→ Only assign 80%+ confidence when ALL signals agree and the pattern edge is confirmed above.`
}
