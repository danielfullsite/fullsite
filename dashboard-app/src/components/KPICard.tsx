'use client'

import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
  subtitle?: string
  icon?: LucideIcon
  accentClass?: string
}

const iconBgMap: Record<string, string> = {
  'kpi-accent-blue': 'bg-blue-50 text-blue-600',
  'kpi-accent-green': 'bg-emerald-50 text-emerald-600',
  'kpi-accent-amber': 'bg-amber-50 text-amber-600',
  'kpi-accent-purple': 'bg-purple-50 text-purple-600',
  'kpi-accent-pink': 'bg-pink-50 text-pink-600',
  'kpi-accent-cyan': 'bg-cyan-50 text-cyan-600',
}

export default function KPICard({
  label,
  value,
  delta,
  deltaType = 'neutral',
  subtitle,
  icon: Icon,
  accentClass,
}: KPICardProps) {
  const iconStyle = accentClass ? iconBgMap[accentClass] || 'bg-slate-50 text-slate-500' : 'bg-slate-50 text-slate-500'

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            {label}
          </p>
          <p className="text-2xl font-bold tracking-tight text-slate-900 truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </p>
        </div>
        {Icon && (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-3 ${iconStyle}`}>
            <Icon size={20} strokeWidth={1.8} />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              deltaType === 'up'
                ? 'text-emerald-600'
                : deltaType === 'down'
                ? 'text-red-500'
                : 'text-slate-500'
            }`}
          >
            {deltaType === 'up' && <TrendingUp size={12} />}
            {deltaType === 'down' && <TrendingDown size={12} />}
            {deltaType === 'neutral' && <Minus size={12} />}
            {delta}
          </span>
        </div>
      )}
      {subtitle && (
        <p className="text-slate-400 text-xs mt-1.5">{subtitle}</p>
      )}
    </div>
  )
}
