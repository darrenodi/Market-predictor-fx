'use client'

import { useEffect, useState } from 'react'
import { Signal } from '@/types'

function fmtPrice(n: number): string {
  if (n < 0.001) return n.toFixed(8)
  if (n < 1) return n.toFixed(5)
  if (n < 100) return n.toFixed(3)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeDiff(from: string, to: string): string {
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

function slotLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// Round to nearest 30-min slot for grouping
function slotKey(dateStr: string): string {
  const d = new Date(dateStr)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30)
  return d.toISOString()
}

// Filter out signals with obviously bad TP/SL (scale errors from before the fix)
function isValid(sig: Signal): boolean {
  const tpDev = Math.abs((sig.tp - sig.market_price) / sig.market_price)
  const slDev = Math.abs((sig.sl - sig.market_price) / sig.market_price)
  return tpDev <= 0.1 && slDev <= 0.1
}

interface CellProps { sig: Signal | undefined }

function Cell({ sig }: CellProps) {
  if (!sig) return <td className="px-3 py-3 text-center text-gray-600 text-[10px]">No signal available</td>

  const closedAt = sig.tp_hit_at ?? sig.sl_hit_at ?? sig.updated_at
  const duration = timeDiff(sig.created_at, closedAt)
  const isTP = sig.status === 'tp_hit'
  const isSL = sig.status === 'sl_hit'

  return (
    <td className="px-3 py-3">
      <div className="flex flex-col items-center gap-1">
        {/* Direction */}
        <span className={`text-xs font-bold px-2 py-0.5 rounded w-full text-center ${
          sig.direction === 'long' ? 'bg-[#0a2e1a] text-[#22c55e]' : 'bg-[#2e0a0a] text-red-400'
        }`}>
          {sig.direction.toUpperCase()}
        </span>
        {/* Entry */}
        <span className="text-[10px] text-gray-400 font-mono">${fmtPrice(sig.market_price)}</span>
        {/* TP / SL prices */}
        <div className="flex gap-1 text-[10px] font-mono">
          <span className="text-[#22c55e]">↑{fmtPrice(sig.tp)}</span>
          <span className="text-red-400">↓{fmtPrice(sig.sl)}</span>
        </div>
        {/* Result */}
        {isTP && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0a2e1a] text-[#22c55e] w-full text-center">
            ✓ TP · {duration}
          </span>
        )}
        {isSL && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2e0a0a] text-red-400 w-full text-center">
            ✗ SL · {duration}
          </span>
        )}
        {!isTP && !isSL && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0d1a2e] text-gray-500 w-full text-center">
            Expired · {duration}
          </span>
        )}
      </div>
    </td>
  )
}

const PAGE_SIZE = 10

export default function SignalHistory() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => { setSignals((d.signals ?? []).filter(isValid)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5 animate-pulse">
        <div className="h-5 w-32 bg-[#1e3a5f] rounded mb-4" />
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-[#1e3a5f] rounded" />)}
        </div>
      </div>
    )
  }

  if (signals.length === 0) {
    return (
      <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Signal History</h2>
        <p className="text-gray-500 text-sm text-center py-6 animate-pulse">
          ModuVise is thinking…
        </p>
      </div>
    )
  }

  // Collect all unique symbols in order
  const symbolOrder = ['BTC/USD', 'ETH/USD', 'XAU/USD']
  const otherSymbols = [...new Set(signals.map(s => s.symbol))].filter(s => !symbolOrder.includes(s))
  const columns = [...symbolOrder.filter(s => signals.some(sig => sig.symbol === s)), ...otherSymbols]

  // Group signals by 30-min time slot
  const slotMap = new Map<string, Map<string, Signal>>()
  for (const sig of signals) {
    const slot = slotKey(sig.created_at)
    if (!slotMap.has(slot)) slotMap.set(slot, new Map())
    // Keep latest signal per symbol per slot
    if (!slotMap.get(slot)!.has(sig.symbol)) {
      slotMap.get(slot)!.set(sig.symbol, sig)
    }
  }

  const allSlots = [...slotMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  const totalPages = Math.ceil(allSlots.length / PAGE_SIZE)
  const slots = allSlots.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold">Signal History</h2>
        {totalPages > 1 && (
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e3a5f]">
              <th className="text-left text-xs text-gray-400 pb-2 pr-4 whitespace-nowrap">Time (GMT)</th>
              {columns.map(col => (
                <th key={col} className="text-center text-xs text-gray-400 pb-2 px-3 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e3a5f]">
            {slots.map(([slot, sigMap]) => (
              <tr key={slot} className="hover:bg-[#0a1a2e] transition-colors align-top">
                <td className="py-3 pr-4 text-xs text-gray-400 whitespace-nowrap font-mono">
                  {slotLabel(slot)}
                </td>
                {columns.map(col => (
                  <Cell key={col} sig={sigMap.get(col)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#1e3a5f]">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-1.5 text-sm rounded-lg border border-[#1e3a5f] text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                  i === page
                    ? 'bg-[#1e3a5f] text-white'
                    : 'text-gray-500 hover:text-white hover:bg-[#0a1a2e]'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="px-4 py-1.5 text-sm rounded-lg border border-[#1e3a5f] text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
