import { BarChart2, GitCompare, Briefcase, Bell, Newspaper, Settings, Plus, LogOut } from 'lucide-react'

const NAV_ITEMS = [
  { icon: BarChart2, label: 'Dashboard', active: true },
  { icon: GitCompare, label: 'Compare' },
  { icon: Briefcase, label: 'Portfolio' },
  { icon: Bell, label: 'Alerts' },
  { icon: Newspaper, label: 'News' },
  { icon: Settings, label: 'Settings' },
]

function ModuViseLogo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
      <rect width="34" height="34" rx="7" fill="#16a34a" />
      {/* Double-check / M shape */}
      <path
        d="M5 21 L9 25 L15 14"
        stroke="white"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 21 L18 25 L29 12"
        stroke="white"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-52 min-w-[208px] bg-[#0a1525] border-r border-[#1e3a5f] flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5">
        <ModuViseLogo />
        <span className="font-bold text-white text-lg tracking-wide">ModuVise</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-[#0a2e1a] text-[#22c55e]'
                : 'text-gray-400 hover:text-white hover:bg-[#0d1a2e]'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>

      {/* Portfolio Balance */}
      <div className="mx-3 mb-3 p-3.5 bg-[#0d1a2e] rounded-xl border border-[#1e3a5f]">
        <p className="text-xs text-gray-500 mb-0.5">Portfolio Balance</p>
        <p className="text-white font-bold text-lg leading-tight">$24,560.00</p>
        <p className="text-[#22c55e] text-xs mb-2">+3.68%</p>
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
          {/* Toggle — always on */}
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
