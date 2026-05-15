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
  'kpi-accent-blue': 'bg-blue-100/80 text-blue-600',
  'kpi-accent-green': 'bg-emerald-100/80 text-emerald-600',
  'kpi-accent-amber': 'bg-amber-100/80 text-amber-600',
  'kpi-accent-purple': 'bg-purple-100/80 text-purple-600',
  'kpi-accent-pink': 'bg-pink-100/80 text-pink-600',
  'kpi-accent-cyan': 'bg-cyan-100/80 text-cyan-600',
}

const gradientBgMap: Record<string, string> = {
  'kpi-accent-blue': 'kpi-bg-blue',
  'kpi-accent-green': 'kpi-bg-green',
  'kpi-accent-amber': 'kpi-bg-amber',
  'kpi-accent-purple': 'kpi-bg-purple',
}

const glowMap: Record<string, string> = {
  'kpi-accent-blue': 'kpi-glow-blue',
  'kpi-accent-green': 'kpi-glow-green',
  'kpi-accent-amber': 'kpi-glow-amber',
  'kpi-accent-purple': 'kpi-glow-purple',
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
  const iconStyle = accentClass ? iconBgMap[accentClass] || 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-500'
  const gradientBg = accentClass ? gradientBgMap[accentClass] || '' : ''
  const glowStyle = accentClass ? glowMap[accentClass] || '' : ''

  return (
    <div
      className={`rounded-2xl border border-slate-200/60 p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 gradient-border ${gradientBg} ${glowStyle}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight text-slate-900 truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </p>
        </div>
        {Icon && (
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ml-3 ${iconStyle}`}>
            <Icon size={22} strokeWidth={2} />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3.5 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
              deltaType === 'up'
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                : deltaType === 'down'
                ? 'bg-red-50 text-red-600 border border-red-100'
                : 'bg-slate-100 text-slate-500 border border-slate-200'
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
        <p className="text-slate-400 text-xs mt-2">{subtitle}</p>
      )}
    </div>
  )
}
