'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BarChart2, Calculator, Briefcase, Bell, Newspaper, Settings, Plus, LogOut, TrendingUp, Zap } from 'lucide-react'

const STARTING_BALANCE = 10_000

const NAV_ITEMS = [
  { icon: BarChart2,  label: 'Dashboard',        href: '/' },
  { icon: Calculator, label: 'Calculator',        href: '/calculator' },
  { icon: TrendingUp, label: 'Daily Predictions', href: '/dailyprediction' },
  { icon: Zap,        label: 'Instant Signals',  href: '/instant' },
  { icon: Briefcase,  label: 'Portfolio',         href: '#' },
  { icon: Bell,       label: 'Alerts',            href: '#' },
  { icon: Newspaper,  label: 'News',              href: '#' },
  { icon: Settings,   label: 'Settings',          href: '#' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/signals')
        .then(r => r.json())
        .then(d => { if (d.account_balance != null) setBalance(d.account_balance) })
        .catch(() => {})
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  const displayBalance = balance ?? STARTING_BALANCE
  const gainPct = ((displayBalance - STARTING_BALANCE) / STARTING_BALANCE) * 100
  const gainColor = gainPct >= 0 ? 'text-[#22c55e]' : 'text-red-400'
  const gainLabel = (gainPct >= 0 ? '+' : '') + gainPct.toFixed(2) + '%'

  return (
    <aside className="hidden lg:flex w-52 min-w-[208px] bg-[#0a1525] border-r border-[#1e3a5f] flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5">
        <Image src="/logo.png" alt="ModuVise" width={34} height={34} className="rounded-lg" />
        <span className="font-bold text-white text-lg tracking-wide">ModuVise</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const active = href !== '#' && (href === '/' ? pathname === '/' : pathname.startsWith(href))
          return (
            <Link
              key={label}
              href={href}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#0a2e1a] text-[#22c55e]'
                  : 'text-gray-400 hover:text-white hover:bg-[#0d1a2e]'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Portfolio Balance */}
      <div className="mx-3 mb-3 p-3.5 bg-[#0d1a2e] rounded-xl border border-[#1e3a5f]">
        <p className="text-xs text-gray-500 mb-0.5">Portfolio Balance</p>
        <p className="text-white font-bold text-lg leading-tight">
          ${displayBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className={`text-xs mb-2 ${gainColor}`}>{gainLabel}</p>
        <button className="w-full flex items-center justify-center gap-1.5 py-2 bg-[#162436] hover:bg-[#1e3a5f] text-gray-300 text-xs rounded-lg transition-colors">
          <Plus size={13} />
          Add Asset
        </button>
      </div>

      {/* Dark Mode + Logout */}
      <div className="px-3 pb-4 space-y-0.5">
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-3 text-gray-400 text-sm">
            <span>☾</span>
            <span>Dark Mode</span>
          </div>
          <div className="w-9 h-5 bg-[#16a34a] rounded-full flex items-center justify-end px-0.5 cursor-default">
            <div className="w-4 h-4 bg-white rounded-full shadow" />
          </div>
        </div>

        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-[#0d1a2e] transition-colors">
          <LogOut size={18} />
          Log Out
        </button>
      </div>
    </aside>
  )
}
