'use client'

import { Star } from 'lucide-react'
import SparklineChart from './SparklineChart'
import { Signal } from '@/types'
import type { SymbolStats } from '@/app/api/signals/route'

interface Props {
  symbol: string
  signal?: Signal
  currentPrice?: number
  change24h?: number
  priceHistory: number[]
  stats?: SymbolStats
  loading: boolean
}

const ASSET: Record<string, { bg: string; text: string; symbol: string; tv: string }> = {
  BTC: { bg: '#f7931a', text: 'white', symbol: '₿', tv: 'BTCUSD' },
  ETH: { bg: '#627eea', text: 'white', symbol: 'Ξ', tv: 'ETHUSD' },
  XAU: { bg: '#e8b923', text: 'white', symbol: 'Au', tv: 'XAUUSD' },
  DOGE: { bg: '#c2a633', text: 'white', symbol: 'Ð', tv: 'DOGEUSD' },
  PEPE: { bg: '#4ade80', text: '#1a2e1a', symbol: 'P', tv: 'PEPEUSD' },
  WIF: { bg: '#a855f7', text: 'white', symbol: 'W', tv: 'WIFUSD' },
  SHIB: { bg: '#f97316', text: 'white', symbol: 'S', tv: 'SHIBUSD' },
  BONK: { bg: '#fb923c', text: 'white', symbol: 'B', tv: 'BONKUSD' },
  SOL: { bg: '#9945ff', text: 'white', symbol: '◎', tv: 'SOLUSD' },
  TRUMP: { bg: '#ef4444', text: 'white', symbol: 'T', tv: 'TRUMPUSD' },
}

const LEVERAGE_OPTIONS = [5, 10, 20, 50, 100, 200, 500]

function fmtPrice(n: number): string {
  if (n === 0) return '--'
  if (n < 0.001) return n.toFixed(8)
  if (n < 1) return n.toFixed(5)
  if (n < 100) return n.toFixed(3)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.floor(min / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export default function AssetCard({ symbol, signal, currentPrice, change24h, priceHistory, stats, loading }: Props) {
  const base = symbol.replace('/USD', '')
  const cfg = ASSET[base] ?? { bg: '#22c55e', text: 'white', symbol: base[0] ?? '?', tv: `${base}USD` }
  const displayPrice = currentPrice ?? signal?.market_price ?? 0
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${cfg.tv}`

  if (loading) {
    return (
      <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4 flex flex-col gap-3 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[#1e3a5f]" />
          <div className="h-4 w-20 bg-[#1e3a5f] rounded" />
        </div>
        <div className="h-3 w-full bg-[#1e3a5f] rounded" />
        <div className="h-8 w-32 bg-[#1e3a5f] rounded" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-9 bg-[#1e3a5f] rounded-lg" />
          <div className="h-9 bg-[#1e3a5f] rounded-lg" />
        </div>
        {[1, 2, 3, 4].map(i => <div key={i} className="h-9 bg-[#1e3a5f] rounded-lg" />)}
        <div className="h-10 bg-[#1e3a5f] rounded-lg" />
      </div>
    )
  }

  return (
    <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
            style={{ backgroundColor: cfg.bg, color: cfg.text }}
          >
            {cfg.symbol}
          </div>
          <span className="font-bold text-white text-[15px]">{symbol}</span>
        </div>
        <button className="text-yellow-400 hover:text-yellow-300 transition-colors">
          <Star size={15} />
        </button>
      </div>

      {/* Timestamp */}
      {signal ? (
        <div className="text-xs leading-relaxed">
          <span className="text-gray-400">Last updated {fmtDate(signal.updated_at ?? signal.created_at)}</span>
          <br />
          <span className="text-[#22c55e]">({relativeTime(signal.updated_at ?? signal.created_at)})</span>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Waiting for signal…</p>
      )}

      {/* Rationale */}
      {signal?.reasoning && (
        <div className="bg-[#0a1a2e] border border-[#1e3a5f] rounded-lg px-3 py-2.5">
          <p className="text-xs text-[#22c55e] font-semibold mb-1">AI Rationale</p>
          <p className="text-xs text-gray-300 leading-relaxed">{signal.reasoning}</p>
        </div>
      )}

      {/* Market Price + sparkline */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Market Price</p>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[#22c55e] text-[26px] font-bold leading-tight">
              {fmtPrice(displayPrice)}
            </p>
            {change24h !== undefined && (
              <p className={`text-xs mt-0.5 ${change24h >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                {change24h >= 0 ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
              </p>
            )}
          </div>
          {priceHistory.length > 1 && (
            <SparklineChart
              data={priceHistory}
              width={80}
              height={32}
              color={change24h !== undefined && change24h < 0 ? '#f87171' : '#22c55e'}
            />
          )}
        </div>
      </div>

      {/* Long / Short */}
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
            signal?.direction === 'long'
              ? 'bg-[#16a34a] text-white'
              : 'bg-[#0a1220] text-gray-500 border border-[#1e3a5f]'
          }`}
        >
          Long
        </button>
        <button
          className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
            signal?.direction === 'short'
              ? 'bg-red-700 text-white'
              : 'bg-[#0a1220] text-gray-500 border border-[#1e3a5f]'
          }`}
        >
          Short
        </button>
      </div>

      {/* Leverage */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Leverage</p>
        <div className="relative">
          <select
            disabled
            value={signal?.leverage ?? ''}
            className="w-full bg-[#0a1220] border border-[#1e3a5f] text-white rounded-lg px-3 py-2 text-sm appearance-none"
          >
            {!signal && <option value="">--</option>}
            {LEVERAGE_OPTIONS.map(l => (
              <option key={l} value={l}>{l}x</option>
            ))}
          </select>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-xs">▾</span>
        </div>
      </div>

      {/* % of Portfolio */}
      <div>
        <p className="text-xs text-gray-400 mb-1">% of Portfolio</p>
        <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2">
          <input
            readOnly
            value={signal?.portfolio_pct ?? ''}
            placeholder="--"
            className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
          />
          <span className="text-gray-400 text-sm">%</span>
        </div>
      </div>

      {/* Take Profit */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Take Profit (TP)</p>
        <input
          readOnly
          value={signal?.tp ? fmtPrice(signal.tp) : ''}
          placeholder="--"
          className="w-full bg-[#0a1220] border border-[#1e3a5f] text-white rounded-lg px-3 py-2 text-sm outline-none"
        />
      </div>

      {/* Stop Loss */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Stop Loss (SL)</p>
        <input
          readOnly
          value={signal?.sl ? fmtPrice(signal.sl) : ''}
          placeholder="--"
          className="w-full bg-[#0a1220] border border-[#1e3a5f] text-white rounded-lg px-3 py-2 text-sm outline-none"
        />
      </div>

      {/* 24h outcome stats */}
      <div className="bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2.5">
        <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wide">
          Last {stats?.windowHours ?? 24}h outcomes
        </p>
        {stats && stats.total > 0 ? (
          <div className="flex items-center justify-between gap-1 text-xs">
            <div className="flex flex-col items-center">
              <span className="text-[#22c55e] font-bold text-sm">{stats.tp}</span>
              <span className="text-gray-500 text-[10px]">TP Hit</span>
            </div>
            <div className="w-px h-8 bg-[#1e3a5f]" />
            <div className="flex flex-col items-center">
              <span className="text-red-400 font-bold text-sm">{stats.sl}</span>
              <span className="text-gray-500 text-[10px]">SL Hit</span>
            </div>
            <div className="w-px h-8 bg-[#1e3a5f]" />
            <div className="flex flex-col items-center">
              <span className="text-yellow-400 font-bold text-sm">{stats.expired}</span>
              <span className="text-gray-500 text-[10px]">Expired</span>
            </div>
            <div className="w-px h-8 bg-[#1e3a5f]" />
            <div className="flex flex-col items-center">
              <span className="text-white font-bold text-sm">
                {stats.total > 0 ? Math.round((stats.tp / stats.total) * 100) : 0}%
              </span>
              <span className="text-gray-500 text-[10px]">Win rate</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-gray-600">No closed trades yet</p>
        )}
      </div>

      {/* View Chart */}
      <a
        href={tvUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full py-2.5 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-lg text-sm font-semibold text-center transition-colors block mt-auto"
      >
        View Chart
      </a>
    </div>
  )
}
