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

const iconStyles: Record<string, { bg: string; icon: string }> = {
  'kpi-accent-blue': { bg: 'bg-blue-100', icon: 'text-blue-600' },
  'kpi-accent-green': { bg: 'bg-emerald-100', icon: 'text-emerald-600' },
  'kpi-accent-amber': { bg: 'bg-amber-100', icon: 'text-amber-600' },
  'kpi-accent-purple': { bg: 'bg-purple-100', icon: 'text-purple-600' },
  'kpi-accent-pink': { bg: 'bg-pink-100', icon: 'text-pink-600' },
  'kpi-accent-cyan': { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
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
  const style = accentClass ? iconStyles[accentClass] || { bg: 'bg-slate-100', icon: 'text-slate-500' } : { bg: 'bg-slate-100', icon: 'text-slate-500' }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
            <Icon size={22} strokeWidth={1.8} className={style.icon} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-500 font-medium mb-0.5">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </p>
        </div>
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
            deltaType === 'up' ? 'text-emerald-600' : deltaType === 'down' ? 'text-red-500' : 'text-slate-400'
          }`}>
            {deltaType === 'up' && <TrendingUp size={13} />}
            {deltaType === 'down' && <TrendingDown size={13} />}
            {deltaType === 'neutral' && <Minus size={13} />}
            {delta}
          </span>
          {subtitle && <span className="text-slate-400 text-xs">{subtitle}</span>}
        </div>
      )}
    </div>
  )
}
