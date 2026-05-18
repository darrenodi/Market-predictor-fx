'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Bell, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, Minus } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import type { DailySessionRow, DailyStats } from '@/app/api/daily-sessions/route'

const SESSION_META: Record<string, { name: string; flag: string; openUTC: number; closeUTC: number }> = {
  asia:    { name: 'Asia',     flag: '🌏', openUTC: 0,  closeUTC: 8  },
  london:  { name: 'London',   flag: '🇬🇧', openUTC: 9,  closeUTC: 17 },
  newyork: { name: 'New York', flag: '🇺🇸', openUTC: 13, closeUTC: 21 },
}

const SESSION_ORDER: Array<keyof typeof SESSION_META> = ['asia', 'london', 'newyork']

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 0.001) return '$' + n.toFixed(8)
  if (n < 1) return '$' + n.toFixed(5)
  if (n < 100) return '$' + n.toFixed(3)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number | null | undefined, showSign = true): string {
  if (n == null) return '—'
  return (showSign && n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function fmtUSD(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n >= 0 ? '+' : '') + '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000) return (n >= 0 ? '+' : '') + '$' + (n / 1_000).toFixed(2) + 'K'
  return (n >= 0 ? '+' : '') + '$' + n.toFixed(2)
}

function winRate(correct: number, total: number): string {
  if (total === 0) return '—'
  return Math.round((correct / total) * 100) + '%'
}

function getSessionStatus(openUTC: number, closeUTC: number): 'upcoming' | 'open' | 'closed' {
  const h = new Date().getUTCHours()
  if (h < openUTC) return 'upcoming'
  if (h >= closeUTC) return 'closed'
  return 'open'
}

function StatusBadge({ status }: { status: 'upcoming' | 'open' | 'closed' }) {
  if (status === 'open') return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-[#22c55e] bg-[#0a2e1a] border border-[#22c55e]/30 rounded-full px-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
      LIVE
    </span>
  )
  if (status === 'upcoming') return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400 bg-[#0a1220] border border-[#1e3a5f] rounded-full px-2 py-0.5">
      <Clock size={10} />
      UPCOMING
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-[#0a1220] border border-[#1e3a5f] rounded-full px-2 py-0.5">
      CLOSED
    </span>
  )
}

function OutcomeIcon({ outcome }: { outcome: 'correct' | 'incorrect' | null }) {
  if (outcome === 'correct') return <CheckCircle size={14} className="text-[#22c55e] shrink-0" />
  if (outcome === 'incorrect') return <XCircle size={14} className="text-red-400 shrink-0" />
  return <Minus size={14} className="text-gray-600 shrink-0" />
}

interface SessionCardProps {
  session: string
  todayRows: DailySessionRow[]
}

function SessionCard({ session, todayRows }: SessionCardProps) {
  const meta = SESSION_META[session]
  const status = getSessionStatus(meta.openUTC, meta.closeUTC)
  const rows = todayRows.filter(r => r.session === session)

  return (
    <div className={`bg-[#0d1627] rounded-xl border ${status === 'open' ? 'border-[#22c55e]/40' : 'border-[#1e3a5f]'} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{meta.flag}</span>
          <div>
            <p className="text-sm font-bold text-white">{meta.name}</p>
            <p className="text-[10px] text-gray-500">{meta.openUTC}:00 – {meta.closeUTC}:00 UTC</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-600 py-2 text-center">
          No signal available
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => {
            const actualMove = row.close_price != null
              ? ((row.close_price - row.open_price) / row.open_price) * 100
              : null

            return (
              <div key={row.id} className="bg-[#060d1a] rounded-lg px-3 py-2.5 space-y-1.5">
                {/* Asset + direction + outcome */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {row.predicted_direction === 'up'
                      ? <TrendingUp size={13} className="text-[#22c55e]" />
                      : <TrendingDown size={13} className="text-red-400" />
                    }
                    <span className="text-xs font-bold text-white">{row.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500">{Math.round(row.confidence * 100)}% conf.</span>
                    <OutcomeIcon outcome={row.outcome} />
                  </div>
                </div>

                {/* Price line */}
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  <div>
                    <p className="text-gray-600">Open</p>
                    <p className="text-gray-300 font-medium">{fmtPrice(row.open_price)}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Predicted</p>
                    <p className={`font-medium ${row.predicted_direction === 'up' ? 'text-[#22c55e]' : 'text-red-400'}`}>
                      {fmtPrice(row.predicted_close)}
                      <span className="text-gray-500 ml-1">({fmtPct(row.predicted_pct)})</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Actual</p>
                    {row.close_price != null ? (
                      <p className={`font-medium ${actualMove != null && actualMove >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                        {fmtPrice(row.close_price)}
                        <span className="text-gray-500 ml-1">({fmtPct(actualMove)})</span>
                      </p>
                    ) : (
                      <p className="text-gray-600">Pending…</p>
                    )}
                  </div>
                </div>

                {/* Reasoning */}
                {row.reasoning && (
                  <p className="text-[10px] text-gray-500 italic leading-relaxed border-t border-[#1e3a5f] pt-1.5">
                    {row.reasoning}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HistoryCell({ row }: { row: DailySessionRow | undefined }) {
  if (!row) return (
    <td className="px-2 py-3 text-center text-gray-700 text-[10px]">No signal available</td>
  )

  const actualPct = row.close_price != null
    ? ((row.close_price - row.open_price) / row.open_price) * 100
    : null
  const isUp = row.predicted_direction === 'up'

  return (
    <td className="px-2 py-2.5">
      <div className="flex flex-col items-center gap-1 min-w-[100px]">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded w-full text-center ${
          isUp ? 'bg-[#0d1a3a] text-blue-400' : 'bg-[#2a1800] text-amber-400'
        }`}>
          {isUp ? '↑ UP' : '↓ DOWN'}
        </span>
        <span className="text-[10px] text-gray-500 font-mono">{fmtPrice(row.open_price)}</span>
        <span className={`text-[10px] font-medium font-mono ${isUp ? 'text-[#22c55e]' : 'text-red-400'}`}>
          → {fmtPrice(row.predicted_close)}
        </span>
        <span className={`text-[10px] font-mono ${isUp ? 'text-[#22c55e]/70' : 'text-red-400/70'}`}>
          {fmtPct(row.predicted_pct)}
        </span>
        {row.close_price != null ? (
          <>
            <span className={`text-[10px] font-mono font-semibold ${actualPct != null && actualPct >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
              {fmtPrice(row.close_price)}
            </span>
            <span className={`text-[10px] font-mono ${actualPct != null && actualPct >= 0 ? 'text-[#22c55e]/70' : 'text-red-400/70'}`}>
              {fmtPct(actualPct)}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-gray-600 italic">pending…</span>
        )}
        {row.outcome === 'correct' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0a2e1a] text-[#22c55e] w-full text-center">
            ✓ {row.daily_pnl != null ? fmtUSD(row.daily_pnl) : 'correct'}
          </span>
        )}
        {row.outcome === 'incorrect' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2e0a0a] text-red-400 w-full text-center">
            ✗ {row.daily_pnl != null ? fmtUSD(row.daily_pnl) : 'wrong'}
          </span>
        )}
        {row.outcome == null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0d1a2e] text-gray-500 w-full text-center">
            open
          </span>
        )}
      </div>
    </td>
  )
}

export default function DailyPredictionPage() {
  const [data, setData] = useState<{
    today: DailySessionRow[]
    history: DailySessionRow[]
    stats: DailyStats
    daily_balance: number
  } | null>(null)
  const [historyTab, setHistoryTab] = useState<string>('asia')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () =>
      fetch('/api/daily-sessions')
        .then(r => r.json())
        .then(d => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const stats = data?.stats
  const dailyBalance = data?.daily_balance ?? 10000
  const initialBalance = 10_000
  const gainPct = ((dailyBalance - initialBalance) / initialBalance) * 100

  // Group history by date for the table
  const history = data?.history ?? []

  return (
    <div className="flex h-screen bg-[#060d1a] text-white overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0a1525] border-b border-[#1e3a5f] shrink-0">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="ModuVise" width={28} height={28} className="rounded-lg" />
            <span className="font-bold text-white text-base tracking-wide">ModuVise</span>
          </div>
          <button className="p-2 text-gray-400"><Bell size={18} /></button>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f] shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Daily Predictions</h1>
            <p className="text-gray-500 text-xs mt-0.5">Session-level price forecasts — Asia · London · New York</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Daily Simulation Balance</p>
            <p className="text-lg font-bold text-white">${dailyBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className={`text-xs ${gainPct >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
              {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(2)}% from $10,000
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-6">

          <div className="lg:hidden">
            <h1 className="text-lg font-bold text-white">Daily Predictions</h1>
            <p className="text-gray-500 text-xs mt-0.5">Session-level price forecasts — Asia · London · New York</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Daily Balance</p>
              <p className="text-lg font-bold text-white">${dailyBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
              <p className={`text-xs mt-0.5 ${gainPct >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(2)}%
              </p>
            </div>
            <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Overall Accuracy</p>
              <p className="text-lg font-bold text-white">
                {stats ? winRate(stats.overall.correct, stats.overall.total) : '—'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {stats ? `${stats.overall.correct} / ${stats.overall.total} correct` : 'No data yet'}
              </p>
            </div>
            {Object.entries(stats?.bySession ?? {}).slice(0, 2).map(([ses, s]) => (
              <div key={ses} className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{SESSION_META[ses]?.flag} {SESSION_META[ses]?.name ?? ses}</p>
                <p className="text-lg font-bold text-white">{winRate(s.correct, s.total)}</p>
                <p className={`text-xs mt-0.5 ${s.pnl >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                  {fmtUSD(s.pnl)} P&L
                </p>
              </div>
            ))}
          </div>

          {/* Today's sessions */}
          <div>
            <h2 className="text-sm font-bold text-white mb-3">
              Today's Sessions — {new Date().toUTCString().slice(0, 16)} UTC
            </h2>
            {loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4 h-48 flex flex-col items-center justify-center gap-2 animate-pulse">
                    <p className="text-xs text-gray-500">ModuVise is thinking…</p>
                    <p className="text-[10px] text-gray-600">Generating session predictions</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {SESSION_ORDER.map(ses => (
                  <SessionCard key={ses} session={ses} todayRows={data?.today ?? []} />
                ))}
              </div>
            )}
          </div>

          {/* Per-session + per-asset stats */}
          {stats && stats.overall.total > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* By session */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">By Session</h3>
                <div className="space-y-2">
                  {SESSION_ORDER.map(ses => {
                    const s = stats.bySession[ses]
                    if (!s) return null
                    const pct = Math.round((s.correct / s.total) * 100)
                    return (
                      <div key={ses} className="flex items-center gap-3">
                        <span className="text-sm">{SESSION_META[ses].flag}</span>
                        <span className="text-xs text-gray-400 w-20">{SESSION_META[ses].name}</span>
                        <div className="flex-1 bg-[#0a1220] rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${pct >= 60 ? 'bg-[#22c55e]' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-white w-8 text-right">{pct}%</span>
                        <span className={`text-xs w-16 text-right ${s.pnl >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                          {fmtUSD(s.pnl)}
                        </span>
                        <span className="text-xs text-gray-600">{s.correct}/{s.total}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* By symbol */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">By Asset</h3>
                <div className="space-y-2">
                  {Object.entries(stats.bySymbol).map(([sym, s]) => {
                    const pct = Math.round((s.correct / s.total) * 100)
                    return (
                      <div key={sym} className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-20">{sym.replace('/USD', '')}</span>
                        <div className="flex-1 bg-[#0a1220] rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${pct >= 60 ? 'bg-[#22c55e]' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-white w-8 text-right">{pct}%</span>
                        <span className={`text-xs w-16 text-right ${s.pnl >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                          {fmtUSD(s.pnl)}
                        </span>
                        <span className="text-xs text-gray-600">{s.correct}/{s.total}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* History — 3 tabbed session views */}
          <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white">Prediction History</h2>
              {/* Session tabs */}
              <div className="flex gap-1 bg-[#060d1a] rounded-lg p-1">
                {SESSION_ORDER.map(ses => {
                  const meta = SESSION_META[ses]
                  const sesStats = stats?.bySession[ses]
                  return (
                    <button
                      key={ses}
                      onClick={() => setHistoryTab(ses)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        historyTab === ses
                          ? 'bg-[#1e3a5f] text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      <span>{meta.flag}</span>
                      <span>{meta.name}</span>
                      {sesStats && sesStats.total > 0 && (
                        <span className={`text-[10px] ml-0.5 ${
                          Math.round(sesStats.correct / sesStats.total * 100) >= 60
                            ? 'text-[#22c55e]' : 'text-gray-500'
                        }`}>
                          {Math.round(sesStats.correct / sesStats.total * 100)}%
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {(() => {
              const sesRows = history.filter(r => r.session === historyTab)

              if (sesRows.length === 0) {
                return (
                  <p className="text-xs text-gray-600 text-center py-8">
                    No history for {SESSION_META[historyTab]?.name} yet.
                  </p>
                )
              }

              // Group by date, columns are unique symbols
              const byDate = new Map<string, Map<string, DailySessionRow>>()
              for (const row of sesRows) {
                if (!byDate.has(row.session_date)) byDate.set(row.session_date, new Map())
                byDate.get(row.session_date)!.set(row.symbol, row)
              }
              const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))

              const symbolOrder = ['BTC/USD', 'ETH/USD', 'XAU/USD']
              const allSymbols = [...new Set(sesRows.map(r => r.symbol))]
              const others = allSymbols.filter(s => !symbolOrder.includes(s))
              const columns = [...symbolOrder.filter(s => allSymbols.includes(s)), ...others]

              return (
                <div className="overflow-auto max-h-[420px] rounded-lg border border-[#1e3a5f]">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-[#0a1525] z-10">
                      <tr>
                        <th className="text-left text-gray-400 font-medium px-3 py-2.5 border-b border-[#1e3a5f] whitespace-nowrap">Date</th>
                        {columns.map(col => (
                          <th key={col} className="text-center text-gray-400 font-medium px-2 py-2.5 border-b border-[#1e3a5f] whitespace-nowrap">
                            {col.replace('/USD', '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]">
                      {dates.map(date => (
                        <tr key={date} className="hover:bg-[#0a1a2e]/50 transition-colors align-top">
                          <td className="px-3 py-3 text-gray-400 text-[11px] font-mono whitespace-nowrap">
                            {date}
                          </td>
                          {columns.map(col => (
                            <HistoryCell key={col} row={byDate.get(date)?.get(col)} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>

        </div>
      </main>
    </div>
  )
}
