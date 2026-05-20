'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Bell, AlertTriangle, Check } from 'lucide-react'
import Sidebar from '@/components/Sidebar'

function fmtUSD(n: number, _compact = false): string {
  if (!isFinite(n) || isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000_000_000) return '$' + (n / 1_000_000_000_000).toFixed(2) + 'T'
  if (a >= 1_000_000_000)     return '$' + (n / 1_000_000_000).toFixed(2) + 'B'
  if (a >= 1_000_000)         return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (a >= 1_000)             return '$' + (n / 1_000).toFixed(2) + 'K'
  if (a < 0.001)              return '$' + n.toFixed(6)
  if (a < 1)                  return '$' + n.toFixed(4)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '—'
  const a = Math.abs(n)
  const s = a >= 1_000_000_000_000 ? (n / 1_000_000_000_000).toFixed(2) + 'T%'
          : a >= 1_000_000_000     ? (n / 1_000_000_000).toFixed(2) + 'B%'
          : a >= 1_000_000         ? (n / 1_000_000).toFixed(2) + 'M%'
          : a >= 10_000            ? (n / 1_000).toFixed(1) + 'K%'
          : a >= 100               ? n.toFixed(1) + '%'
          :                          n.toFixed(2) + '%'
  return (n >= 0 ? '+' : '') + s
}

const XAF_RATE = 580

type AssetKey = 'BTC' | 'XAU' | 'ETH'
const ASSETS: Record<AssetKey, { label: string; price: number; move: number; fee: number }> = {
  BTC: { label: 'BTC',  price: 80000, move: 100, fee: 0.01 },
  XAU: { label: 'Gold', price: 4500,  move: 3,   fee: 0    },
  ETH: { label: 'ETH',  price: 2300,  move: 10,  fee: 0.04 },
}

function fmtXAF(usd: number): string {
  if (!isFinite(usd) || isNaN(usd)) return '—'
  const n = usd * XAF_RATE
  if (Math.abs(n) >= 1_000_000_000_000) return 'XAF ' + (n / 1_000_000_000_000).toFixed(2) + 'T'
  if (Math.abs(n) >= 1_000_000_000) return 'XAF ' + (n / 1_000_000_000).toFixed(2) + 'B'
  if (Math.abs(n) >= 1_000_000) return 'XAF ' + (n / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(n) >= 1_000) return 'XAF ' + (n / 1_000).toFixed(1) + 'K'
  return 'XAF ' + Math.round(n).toLocaleString()
}

export default function CalculatorPage() {
  const [asset, setAsset] = useState<AssetKey>('BTC')
  const [entryPrice, setEntryPrice] = useState(ASSETS.BTC.price)
  const [balance, setBalance] = useState(50)
  const [leverage, setLeverage] = useState(50)
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [moveAmount, setMoveAmount] = useState(ASSETS.BTC.move)

  function selectAsset(key: AssetKey) {
    setAsset(key)
    setEntryPrice(ASSETS[key].price)
    setMoveAmount(ASSETS[key].move)
    setMarketFee(ASSETS[key].fee)
  }
  const [tradesPerDay, setTradesPerDay] = useState(10)
  const [tradingDays, setTradingDays] = useState(30)
  const [marketFee, setMarketFee] = useState(ASSETS.BTC.fee)
  const [profitRemoval, setProfitRemoval] = useState(0)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  function toggleDay(day: number) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day); else next.add(day)
      return next
    })
  }

  const isLong = direction === 'long'

  // Target price is always derived from moveAmount + direction
  const targetPrice = isLong ? entryPrice + moveAmount : entryPrice - moveAmount

  // Core calculations
  const positionSize = balance * leverage
  const liqPrice = isLong
    ? entryPrice - entryPrice / leverage
    : entryPrice + entryPrice / leverage
  const liqDist = Math.abs(entryPrice - liqPrice)
  const liqDistPct = entryPrice > 0 ? (liqDist / entryPrice) * 100 : 0
  const movePct = entryPrice > 0 ? (moveAmount / entryPrice) * 100 : 0
  const fee = positionSize * (marketFee / 100)
  const profit = entryPrice > 0 ? (moveAmount / entryPrice) * positionSize - fee : 0
  const roi = balance > 0 ? (profit / balance) * 100 : 0

  // Warning: target is on the liquidation side (trade wiped before TP)
  const isInvalidSetup = isLong ? targetPrice <= liqPrice : targetPrice >= liqPrice

  // Compound projection — each trade: remove profitRemoval% of profit, bank it, compound the rest
  const projection = useMemo(() => {
    if (entryPrice <= 0 || balance <= 0 || moveAmount <= 0) return []
    const movePctDecimal = moveAmount / entryPrice
    const feeRate = marketFee / 100
    const removalRate = profitRemoval / 100
    let bal = balance
    let totalRemoved = 0
    const rows: { day: number; dailyProfit: number; dailySaved: number; balance: number; totalRemoved: number; totalValue: number }[] = []
    for (let d = 1; d <= Math.min(tradingDays, 365); d++) {
      let dailyProfit = 0
      let dailySaved = 0
      for (let t = 0; t < tradesPerDay; t++) {
        const posSize = bal * leverage
        const gross = movePctDecimal * posSize - posSize * feeRate
        const removed = gross > 0 ? gross * removalRate : 0
        bal += gross - removed
        totalRemoved += removed
        dailyProfit += gross
        dailySaved += removed
      }
      rows.push({ day: d, dailyProfit, dailySaved, balance: bal, totalRemoved, totalValue: bal + totalRemoved })
    }
    return rows
  }, [entryPrice, balance, leverage, moveAmount, tradesPerDay, tradingDays, marketFee, profitRemoval])

  function handleTargetInput(val: number) {
    const move = isLong ? val - entryPrice : entryPrice - val
    setMoveAmount(Math.max(0, move))
  }

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
            <h1 className="text-xl font-bold text-white">Futures Calculator</h1>
            <p className="text-gray-500 text-xs mt-0.5">Estimate P&amp;L, position size, and liquidation price</p>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-4 lg:p-6">

          <div className="lg:hidden mb-4">
            <h1 className="text-lg font-bold text-white">Futures Calculator</h1>
            <p className="text-gray-500 text-xs mt-0.5">Estimate P&amp;L, position size, and liquidation price</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-start">

            {/* ── INPUTS ── */}
            <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5 space-y-6">

              {/* Asset selector */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Asset</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(ASSETS) as AssetKey[]).map(key => (
                    <button
                      key={key}
                      onClick={() => selectAsset(key)}
                      className={`py-2 rounded-lg text-sm font-semibold transition-all ${
                        asset === key
                          ? 'bg-[#16a34a] text-white ring-1 ring-[#22c55e]/40'
                          : 'bg-[#0a1220] border border-[#1e3a5f] text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                    >
                      {ASSETS[key].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Asset price */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Asset Price (USD)</label>
                <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2.5 focus-within:border-[#22c55e] transition-colors">
                  <span className="text-gray-500 text-sm mr-2">$</span>
                  <input
                    type="number"
                    value={entryPrice || ''}
                    onChange={e => setEntryPrice(parseFloat(e.target.value) || 0)}
                    placeholder="81224"
                    className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                    min={0}
                  />
                </div>
              </div>

              {/* Balance */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Your Balance / Margin (USD)</label>
                <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2.5 focus-within:border-[#22c55e] transition-colors">
                  <span className="text-gray-500 text-sm mr-2">$</span>
                  <input
                    type="number"
                    value={balance || ''}
                    onChange={e => setBalance(parseFloat(e.target.value) || 0)}
                    placeholder="1000"
                    className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                    min={1}
                  />
                </div>
              </div>

              {/* Leverage slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400">Leverage</label>
                  <div className="flex items-center gap-1 bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-2 py-0.5 focus-within:border-[#22c55e] transition-colors">
                    <input
                      type="number"
                      value={leverage}
                      onChange={e => setLeverage(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-14 bg-transparent text-[#22c55e] font-bold text-base outline-none text-right"
                      min={1}
                      max={500}
                    />
                    <span className="text-[#22c55e] font-bold text-base">×</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={500}
                  value={leverage}
                  onChange={e => setLeverage(Number(e.target.value))}
                  className="w-full accent-[#22c55e] cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-1.5">
                  <span>1×</span>
                  <span>125×</span>
                  <span>250×</span>
                  <span>375×</span>
                  <span>500×</span>
                </div>
              </div>

              {/* Direction toggle */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection('long')}
                    className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      isLong
                        ? 'bg-[#16a34a] text-white ring-1 ring-[#22c55e]/40'
                        : 'bg-[#0a1220] border border-[#1e3a5f] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    ↑ Long
                  </button>
                  <button
                    onClick={() => setDirection('short')}
                    className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      !isLong
                        ? 'bg-red-700 text-white ring-1 ring-red-500/40'
                        : 'bg-[#0a1220] border border-[#1e3a5f] text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                  >
                    ↓ Short
                  </button>
                </div>
              </div>

              {/* Price move — slider + dual input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400">Price Move</label>
                  <span className="text-xs text-gray-500">{movePct.toFixed(2)}% of entry</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20000}
                  value={Math.min(moveAmount, 20000)}
                  onChange={e => setMoveAmount(Number(e.target.value))}
                  className="w-full accent-[#22c55e] cursor-pointer mb-3"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Move Amount ($)</p>
                    <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                      <span className="text-gray-500 text-xs mr-1">$</span>
                      <input
                        type="number"
                        value={moveAmount || ''}
                        onChange={e => setMoveAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                        min={0}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Target Price ($)</p>
                    <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                      <span className="text-gray-500 text-xs mr-1">$</span>
                      <input
                        type="number"
                        value={targetPrice || ''}
                        onChange={e => handleTargetInput(parseFloat(e.target.value) || 0)}
                        className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── RESULTS ── */}
            <div className="space-y-3">

              {/* Warning banner */}
              {isInvalidSetup && (
                <div className="flex items-start gap-3 bg-orange-950/60 border border-orange-600/50 rounded-xl p-4">
                  <AlertTriangle size={16} className="text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-orange-300">Liquidated before TP</p>
                    <p className="text-xs text-orange-400/80 mt-0.5 leading-relaxed">
                      Your target ({fmtUSD(targetPrice)}) falls on the wrong side of your liquidation price ({fmtUSD(liqPrice)}). The position would be wiped out before the target is reached.
                    </p>
                  </div>
                </div>
              )}

              {/* Position size */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Position Size</p>
                <p className="text-2xl font-bold text-white">{fmtUSD(positionSize, true)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtUSD(balance)} × {leverage}× leverage = {fmtUSD(positionSize)}
                </p>
              </div>

              {/* Liquidation price */}
              <div className={`bg-[#0d1627] border rounded-xl p-4 ${isInvalidSetup ? 'border-orange-600/50' : 'border-[#1e3a5f]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500">Liquidation Price</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-950/50 text-orange-400 border border-orange-700/30">
                    {isLong ? 'below entry' : 'above entry'}
                  </span>
                </div>
                <p className="text-2xl font-bold text-orange-400">{fmtUSD(liqPrice)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtUSD(liqDist)} ({liqDistPct.toFixed(2)}%) from entry — 1 / {leverage}× leverage
                </p>
              </div>

              {/* Target price */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500">Target Price</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    isLong
                      ? 'bg-green-950/50 text-[#22c55e] border-green-800/30'
                      : 'bg-red-950/50 text-red-400 border-red-800/30'
                  }`}>
                    {isLong ? 'above entry' : 'below entry'}
                  </span>
                </div>
                <p className={`text-2xl font-bold ${isLong ? 'text-[#22c55e]' : 'text-red-400'}`}>
                  {fmtUSD(targetPrice)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {isLong ? '+' : '−'}{fmtUSD(moveAmount)} ({movePct.toFixed(2)}%) from entry
                </p>
              </div>

              {/* Potential profit */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Potential Profit</p>
                <p className="text-2xl font-bold text-[#22c55e]">{fmtUSD(profit, true)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {movePct.toFixed(2)}% move × {fmtUSD(positionSize, true)} − {fmtUSD(fee)} fee ({marketFee}%)
                </p>
              </div>

              {/* ROI */}
              <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">ROI on Balance</p>
                <p className="text-2xl font-bold text-[#22c55e]">{fmtPct(roi)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtUSD(profit, true)} profit on {fmtUSD(balance)} balance
                </p>
              </div>

              {/* Disclaimer */}
              <p className="text-xs text-gray-600 px-1 pt-1 leading-relaxed">
                Estimates only — does not include funding fees, trading fees, or exchange-specific margin modes.
              </p>
            </div>

          </div>

          {/* ── COMPOUND PROJECTION ── */}
          <div className="max-w-5xl mx-auto mt-5 lg:mt-6">
            <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5">

              <h2 className="text-base font-bold text-white mb-1">Compound Growth Projection</h2>
              <p className="text-xs text-gray-500 mb-5">Assumes every trade hits TP at the move % above. Balance compounds after each trade.</p>

              {/* Controls */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Trades per day</label>
                  <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                    <input
                      type="number"
                      value={tradesPerDay}
                      onChange={e => setTradesPerDay(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                      min={1}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Trading days</label>
                  <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                    <input
                      type="number"
                      value={tradingDays}
                      onChange={e => setTradingDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
                      className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                      min={1}
                      max={365}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Profit removal per trade</label>
                  <div className="flex items-center bg-[#0a1220] border border-[#22c55e]/40 rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                    <input
                      type="number"
                      value={profitRemoval}
                      onChange={e => setProfitRemoval(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                      className="flex-1 bg-transparent text-[#22c55e] text-sm font-semibold outline-none min-w-0"
                      min={0}
                      max={100}
                      step={5}
                    />
                    <span className="text-[#22c55e] text-xs ml-1 font-semibold">%</span>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">banked each trade, added to final value</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Fee per trade (%)</label>
                  <div className="flex items-center bg-[#0a1220] border border-[#1e3a5f] rounded-lg px-3 py-2 focus-within:border-[#22c55e] transition-colors">
                    <input
                      type="number"
                      value={marketFee}
                      onChange={e => setMarketFee(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="flex-1 bg-transparent text-white text-sm outline-none min-w-0"
                      min={0}
                      step={0.001}
                    />
                    <span className="text-gray-500 text-xs ml-1">%</span>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">deducted from position size each trade</p>
                </div>
              </div>

              {/* Summary stats */}
              {projection.length > 0 && (() => {
                const last = projection[projection.length - 1]
                const netPerTrade = (projection[0].dailyProfit - projection[0].dailySaved) / tradesPerDay
                const totalReturn = (last.totalValue - balance) / balance * 100
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                    <div className="bg-[#060d1a] border border-[#1e3a5f] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Net per trade (kept)</p>
                      <p className="text-sm font-bold text-[#22c55e]">{fmtUSD(netPerTrade, true)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{fmtXAF(netPerTrade)}</p>
                    </div>
                    <div className="bg-[#060d1a] border border-[#1e3a5f] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Trading balance (day {tradingDays})</p>
                      <p className="text-sm font-bold text-white">{fmtUSD(last.balance, true)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{fmtXAF(last.balance)}</p>
                    </div>
                    <div className="bg-[#060d1a] border border-[#1e3a5f] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Total banked (day {tradingDays})</p>
                      <p className="text-sm font-bold text-yellow-400">{fmtUSD(last.totalRemoved, true)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{fmtXAF(last.totalRemoved)}</p>
                    </div>
                    <div className="bg-[#060d1a] border border-[#22c55e]/30 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Total value (day {tradingDays})</p>
                      <p className="text-sm font-bold text-[#22c55e]">{fmtUSD(last.totalValue, true)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{fmtXAF(last.totalValue)}</p>
                    </div>
                    <div className="bg-[#060d1a] border border-[#1e3a5f] rounded-lg p-3 col-span-2 lg:col-span-4">
                      <p className="text-xs text-gray-500 mb-1">Total % return on initial balance</p>
                      <p className="text-lg font-bold text-[#22c55e]">{fmtPct(totalReturn)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {fmtUSD(balance)} → {fmtUSD(last.totalValue, true)} over {tradingDays} days
                        {profitRemoval > 0 && ` (${fmtUSD(last.balance, true)} trading + ${fmtUSD(last.totalRemoved, true)} banked)`}
                      </p>
                    </div>
                  </div>
                )
              })()}

              {/* Table */}
              {projection.length > 0 ? (
                <div className="overflow-auto max-h-96 rounded-lg border border-[#1e3a5f]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-[#0a1525] z-10">
                      <tr>
                        <th className="text-left text-xs text-gray-400 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Day</th>
                        <th className="text-right text-xs text-gray-400 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Daily Profit</th>
                        {profitRemoval > 0 && <th className="text-right text-xs text-yellow-500/70 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Banked</th>}
                        <th className="text-right text-xs text-gray-400 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Trading Bal.</th>
                        {profitRemoval > 0 && <th className="text-right text-xs text-yellow-500/70 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Total Banked</th>}
                        <th className="text-right text-xs text-[#22c55e]/80 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Total Value</th>
                        <th className="text-right text-xs text-gray-400 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">Total Value (XAF)</th>
                        <th className="text-right text-xs text-gray-400 font-medium px-4 py-2.5 border-b border-[#1e3a5f]">% Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.map((row, i) => {
                        const returnPct = (row.totalValue - balance) / balance * 100
                        const isEven = i % 2 === 0
                        const isDone = checked.has(row.day)
                        return (
                          <tr key={row.day} className={isDone ? 'bg-[#0a1f0a]/60' : isEven ? 'bg-[#060d1a]/40' : ''}>
                            <td className="px-4 py-2 text-xs font-medium">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleDay(row.day)}
                                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                                    isDone ? 'bg-[#22c55e] border-[#22c55e]' : 'border-gray-600 hover:border-[#22c55e]'
                                  }`}
                                >
                                  {isDone && <Check size={9} className="text-black" strokeWidth={3} />}
                                </button>
                                <span className={isDone ? 'text-gray-500 line-through' : 'text-gray-400'}>{row.day}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right text-[#22c55e] text-xs font-medium">{fmtUSD(row.dailyProfit, true)}</td>
                            {profitRemoval > 0 && <td className="px-4 py-2 text-right text-yellow-400 text-xs">{fmtUSD(row.dailySaved, true)}</td>}
                            <td className="px-4 py-2 text-right text-white text-xs">{fmtUSD(row.balance, true)}</td>
                            {profitRemoval > 0 && <td className="px-4 py-2 text-right text-yellow-400 text-xs font-medium">{fmtUSD(row.totalRemoved, true)}</td>}
                            <td className="px-4 py-2 text-right text-[#22c55e] text-xs font-semibold">{fmtUSD(row.totalValue, true)}</td>
                            <td className="px-4 py-2 text-right text-gray-300 text-xs">{fmtXAF(row.totalValue)}</td>
                            <td className="px-4 py-2 text-right text-[#22c55e] text-xs font-semibold">{fmtPct(returnPct)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-500 text-center py-6">Enter a valid asset price, balance, and move amount above to see the projection.</p>
              )}

              <p className="text-xs text-gray-600 mt-4 leading-relaxed">
                Estimates only — assumes all trades hit TP. Does not account for slippage, SL hits, funding rates, or exchange-specific margin rules. $1 = {XAF_RATE} XAF.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
