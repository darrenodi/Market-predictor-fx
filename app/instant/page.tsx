'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Zap, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'
import type { GeneratedSignal } from '@/lib/signals'

interface PriceInfo { price: number; change_24h: number }

interface InstantResult {
  signals: GeneratedSignal[]
  prices: Record<string, PriceInfo>
  generatedAt: string
}

const ASSETS = ['BTC', 'ETH', 'XAU']
const SYMBOL_LABELS: Record<string, string> = { BTC: 'BTC/USD', ETH: 'ETH/USD', XAU: 'XAU/USD' }

function fmt(n: number) {
  if (n < 1) return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function stars(c: number) {
  if (c >= 0.8) return '⭐⭐⭐'
  if (c >= 0.6) return '⭐⭐'
  return '⭐'
}

function SignalCard({ asset, signal, price }: {
  asset: string
  signal: GeneratedSignal | undefined
  price: PriceInfo | undefined
}) {
  const symbol = SYMBOL_LABELS[asset]
  const hasSignal = !!signal
  const change = price?.change_24h ?? 0
  const changeColor = change >= 0 ? 'text-[#22c55e]' : 'text-red-400'

  return (
    <div className="bg-[#0a1525] border border-[#1e3a5f] rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest">{asset === 'XAU' ? 'Gold' : asset}</p>
          <p className="text-white font-bold text-xl mt-0.5">
            {price?.price ? `$${fmt(price.price)}` : '—'}
          </p>
          <p className={`text-xs mt-0.5 ${changeColor}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}% 24h
          </p>
        </div>
        {hasSignal ? (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
            signal.direction === 'long'
              ? 'bg-[#0a2e1a] text-[#22c55e] border border-[#22c55e]/30'
              : 'bg-[#2e0a0a] text-red-400 border border-red-400/30'
          }`}>
            {signal.direction === 'long' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {signal.direction.toUpperCase()}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#0d1a2e] text-gray-500 border border-[#1e3a5f]">
            <Minus size={13} />
            No Signal
          </div>
        )}
      </div>

      {hasSignal ? (
        <>
          {/* Confidence bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">Confidence</span>
              <span className="text-xs font-semibold text-white">
                {Math.round(signal.confidence * 100)}% {stars(signal.confidence)}
              </span>
            </div>
            <div className="h-1.5 bg-[#162436] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  signal.confidence >= 0.8 ? 'bg-[#22c55e]' :
                  signal.confidence >= 0.6 ? 'bg-yellow-400' : 'bg-orange-400'
                }`}
                style={{ width: `${Math.round(signal.confidence * 100)}%` }}
              />
            </div>
          </div>

          {/* Levels */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-[#0d1a2e] rounded-xl p-2.5">
              <p className="text-xs text-gray-500 mb-1">Entry</p>
              <p className="text-white text-sm font-semibold">${fmt(signal.market_price)}</p>
            </div>
            <div className="bg-[#0a2e1a] rounded-xl p-2.5 border border-[#22c55e]/20">
              <p className="text-xs text-[#22c55e] mb-1">TP</p>
              <p className="text-[#22c55e] text-sm font-semibold">${fmt(signal.tp)}</p>
            </div>
            <div className="bg-[#2e0a0a] rounded-xl p-2.5 border border-red-400/20">
              <p className="text-xs text-red-400 mb-1">SL</p>
              <p className="text-red-400 text-sm font-semibold">${fmt(signal.sl)}</p>
            </div>
          </div>

          {/* Leverage / size */}
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-[#162436] rounded-lg text-xs text-gray-300">⚡ {signal.leverage}x</span>
            <span className="px-2 py-1 bg-[#162436] rounded-lg text-xs text-gray-300">💼 {signal.portfolio_pct}%</span>
          </div>

          {/* Reasoning */}
          <p className="text-xs text-gray-400 leading-relaxed italic border-t border-[#1e3a5f] pt-3">
            {signal.reasoning}
          </p>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center py-6">
          <p className="text-sm text-gray-500 text-center">
            No clear setup right now.<br />
            <span className="text-xs">Market too choppy or signals conflicting.</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default function InstantPage() {
  const [result, setResult] = useState<InstantResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGetSignals() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/instant')
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const generatedTime = result
    ? new Date(result.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="flex h-screen bg-[#060d1a] text-white overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0a1525] border-b border-[#1e3a5f] shrink-0">
          <div className="flex items-center gap-2.5">
            <Zap size={20} className="text-[#22c55e]" />
            <span className="font-bold text-white text-base tracking-wide">Instant Signals</span>
          </div>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f] shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Instant Signals</h1>
            <p className="text-gray-500 text-xs mt-0.5">On-demand AI analysis for BTC, ETH &amp; Gold — any time you want</p>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-4 lg:p-6">

          {/* Get Signals button */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <button
              onClick={handleGetSignals}
              disabled={loading}
              className="flex items-center gap-2.5 px-8 py-3.5 bg-[#22c55e] hover:bg-[#16a34a] disabled:bg-[#162436] disabled:text-gray-500 text-black font-bold rounded-xl transition-colors text-sm shadow-lg shadow-[#22c55e]/20"
            >
              {loading ? (
                <><Loader2 size={17} className="animate-spin text-gray-400" /> Thinking…</>
              ) : (
                <><Zap size={17} /> Get Signals Now</>
              )}
            </button>
            {generatedTime && !loading && (
              <p className="text-xs text-gray-500">Last generated at {generatedTime}</p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="max-w-2xl mx-auto mb-6 px-4 py-3 bg-red-900/30 border border-red-500/40 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {ASSETS.map(a => (
                <div key={a} className="bg-[#0a1525] border border-[#1e3a5f] rounded-2xl p-5 animate-pulse h-72" />
              ))}
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {ASSETS.map(asset => {
                const sym = SYMBOL_LABELS[asset]
                const signal = result.signals.find(s => s.symbol === sym)
                const price = result.prices[asset]
                return <SignalCard key={asset} asset={asset} signal={signal} price={price} />
              })}
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && !error && (
            <div className="flex flex-col items-center justify-center gap-3 mt-16 text-center">
              <div className="w-16 h-16 rounded-full bg-[#0a1525] border border-[#1e3a5f] flex items-center justify-center">
                <Zap size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 text-sm">Hit the button to get AI-generated signals right now.</p>
              <p className="text-gray-600 text-xs">Works at any time — not tied to the 30-min cron schedule.</p>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
