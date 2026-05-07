'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { Bell, Settings, User } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import AssetCard from '@/components/AssetCard'
import Overview from '@/components/Overview'
import SignalHistory from '@/components/SignalHistory'
import { Signal, PriceInfo } from '@/types'

type PriceMap = Record<string, PriceInfo>


export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [memeCoin, setMemeCoin] = useState('DOGE')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [sigRes, priceRes] = await Promise.allSettled([
      fetch('/api/signals').then(r => r.json()),
      fetch('/api/prices').then(r => r.json()),
    ])

    if (sigRes.status === 'fulfilled') {
      setSignals(sigRes.value.signals ?? [])
      setMemeCoin(sigRes.value.meme_coin ?? 'DOGE')
    }

    if (priceRes.status === 'fulfilled') {
      setPrices(priceRes.value.prices ?? {})
      if (priceRes.value.meme_coin) setMemeCoin(priceRes.value.meme_coin)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const symbols = ['BTC/USD', 'ETH/USD', 'XAU/USD', `${memeCoin}/USD`]

  return (
    <div className="flex h-screen bg-[#060d1a] text-white overflow-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ── Mobile header ── */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0a1525] border-b border-[#1e3a5f] shrink-0">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="ModuVise" width={28} height={28} className="rounded-lg" />
            <span className="font-bold text-white text-base tracking-wide">ModuVise</span>
          </div>
          <button className="p-2 text-gray-400">
            <Bell size={18} />
          </button>
        </div>

        {/* ── Desktop header ── */}
        <div className="hidden lg:flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f] shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Compare Markets</h1>
            <p className="text-gray-500 text-xs mt-0.5">Real-time comparison of 4 assets</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1e3a5f] rounded-lg text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
              <Settings size={13} />
              Customize
            </button>
            <button className="p-2 text-gray-400 hover:text-white transition-colors">
              <Bell size={19} />
            </button>
            <button className="p-2 text-gray-400 hover:text-white transition-colors">
              <User size={19} />
            </button>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4 lg:space-y-5">

          {/* Mobile page title */}
          <div className="lg:hidden">
            <h1 className="text-lg font-bold text-white">Compare Markets</h1>
            <p className="text-gray-500 text-xs mt-0.5">Real-time comparison of 4 assets</p>
          </div>

          {/* Asset cards — 1 col mobile, 2 col tablet, 4 col desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {symbols.map(symbol => {
              const base = symbol.replace('/USD', '')
              const signal = signals.find(s => s.symbol === symbol)
              const priceInfo = prices[base]

              return (
                <AssetCard
                  key={symbol}
                  symbol={symbol}
                  signal={signal}
                  currentPrice={priceInfo?.price}
                  change24h={priceInfo?.change_24h}
                  priceHistory={priceInfo?.history ?? []}
                  loading={loading}
                />
              )
            })}
          </div>

          {/* Overview */}
          <Overview signals={signals} loading={loading} />

          {/* Signal History */}
          <SignalHistory />
        </div>
      </main>
    </div>
  )
}
