import { Signal } from '@/types'

interface Props {
  signals: Signal[]
  loading: boolean
}

const PORTFOLIO_BALANCE = 24_560

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function GaugeChart({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  // Semicircle: center (50,45), radius 32, from left (-180°) to right (0°)
  const r = 32
  const cx = 50
  const cy = 45
  const angle = Math.PI - (clamped / 100) * Math.PI
  const ex = cx + r * Math.cos(Math.PI - (clamped / 100) * Math.PI)
  const ey = cy - r * Math.sin(Math.PI - (clamped / 100) * Math.PI)

  // Start is left end of semicircle
  const sx = cx - r
  const sy = cy

  const largeArc = clamped > 50 ? 1 : 0
  const color = clamped > 50 ? '#f97316' : clamped > 25 ? '#eab308' : '#22c55e'

  // Recalculate properly
  // Arc from angle=PI (left) sweeping clockwise by pct/100 * PI
  const startAngle = Math.PI
  const sweepAngle = (clamped / 100) * Math.PI
  const endAngle = startAngle - sweepAngle
  const progressEndX = cx + r * Math.cos(endAngle)
  const progressEndY = cy - r * Math.sin(endAngle)

  return (
    <svg width="72" height="46" viewBox="0 0 100 50">
      {/* Track */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#1e3a5f"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Progress */}
      {clamped > 0 && (
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${progressEndX.toFixed(2)} ${progressEndY.toFixed(2)}`}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

export default function Overview({ signals, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5 animate-pulse">
        <div className="h-5 w-24 bg-[#1e3a5f] rounded mb-4" />
        <div className="grid grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-[#1e3a5f] rounded" />
              <div className="h-5 w-28 bg-[#1e3a5f] rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const active = signals.filter(s => s.status === 'active')
  const marginUsed = active.reduce((sum, s) => sum + PORTFOLIO_BALANCE * (s.portfolio_pct / 100), 0)
  const availableMargin = PORTFOLIO_BALANCE - marginUsed
  const potentialExposure = active.reduce(
    (sum, s) => sum + PORTFOLIO_BALANCE * (s.portfolio_pct / 100) * s.leverage,
    0,
  )
  const marginUsagePct = (marginUsed / PORTFOLIO_BALANCE) * 100

  let riskLabel = 'Low'
  let riskColor = 'text-[#22c55e]'
  if (marginUsagePct > 50) { riskLabel = 'Extreme'; riskColor = 'text-red-400' }
  else if (marginUsagePct > 25) { riskLabel = 'High'; riskColor = 'text-orange-400' }
  else if (marginUsagePct > 10) { riskLabel = 'Moderate'; riskColor = 'text-yellow-400' }

  return (
    <div className="bg-[#0d1627] border border-[#1e3a5f] rounded-xl p-5">
      <h2 className="text-white font-semibold mb-4">Overview</h2>
      <div className="grid grid-cols-6 gap-4 items-center">
        <div>
          <p className="text-xs text-gray-400 mb-1">Total Portfolio Size</p>
          <p className="text-white font-bold">${fmt(PORTFOLIO_BALANCE)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Potential Exposure</p>
          <p className="text-white font-bold">${fmt(potentialExposure)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Margin Used</p>
          <p className="text-white font-bold">${fmt(marginUsed)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Available Margin</p>
          <p className="text-white font-bold">${fmt(availableMargin)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Risk Level</p>
          <p className={`font-bold ${riskColor}`}>{riskLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <GaugeChart pct={marginUsagePct} />
          <div>
            <p className="text-white font-bold text-lg leading-tight">{marginUsagePct.toFixed(0)}%</p>
            <p className="text-xs text-gray-400">Margin Usage</p>
          </div>
        </div>
      </div>
    </div>
  )
}
