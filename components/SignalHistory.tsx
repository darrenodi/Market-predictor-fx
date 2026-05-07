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
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function SignalHistory() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => { setSignals(d.signals ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5">
      <h2 className="text-white font-semibold mb-4">Signal History</h2>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1,2,3,4].map(i => <div key={i} className="h-10 bg-[#1e3a5f] rounded" />)}
        </div>
      ) : signals.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-6">No closed signals yet — history will appear here once trades complete.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-[#1e3a5f]">
                <th className="text-left pb-2 pr-4">Asset</th>
                <th className="text-left pb-2 pr-4">Dir</th>
                <th className="text-right pb-2 pr-4">Entry</th>
                <th className="text-right pb-2 pr-4">TP</th>
                <th className="text-right pb-2 pr-4">SL</th>
                <th className="text-left pb-2 pr-4">Result</th>
                <th className="text-right pb-2 pr-4">Time to Close</th>
                <th className="text-right pb-2">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e3a5f]">
              {signals.map(sig => {
                const closedAt = sig.tp_hit_at ?? sig.sl_hit_at ?? sig.updated_at
                const duration = timeDiff(sig.created_at, closedAt)
                const isTP = sig.status === 'tp_hit'
                const isSL = sig.status === 'sl_hit'

                return (
                  <tr key={sig.id} className="hover:bg-[#0a1a2e] transition-colors">
                    <td className="py-2.5 pr-4 font-semibold text-white">{sig.symbol}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${sig.direction === 'long' ? 'bg-[#0a2e1a] text-[#22c55e]' : 'bg-[#2e0a0a] text-red-400'}`}>
                        {sig.direction.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-300 font-mono">${fmtPrice(sig.market_price)}</td>
                    <td className="py-2.5 pr-4 text-right text-[#22c55e] font-mono">${fmtPrice(sig.tp)}</td>
                    <td className="py-2.5 pr-4 text-right text-red-400 font-mono">${fmtPrice(sig.sl)}</td>
                    <td className="py-2.5 pr-4">
                      {isTP && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#0a2e1a] text-[#22c55e]">✓ TP Hit</span>
                      )}
                      {isSL && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#2e0a0a] text-red-400">✗ SL Hit</span>
                      )}
                      {!isTP && !isSL && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#1e3a5f] text-gray-400">Expired</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-400">{duration}</td>
                    <td className="py-2.5 text-right text-gray-500 text-xs">{fmtDate(sig.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
