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

export default function KPICard({
  label,
  value,
  delta,
  deltaType = 'neutral',
  subtitle,
  icon: Icon,
  accentClass,
}: KPICardProps) {
  return (
    <div
      className={`bg-card rounded-xl p-5 card-shadow hover:card-shadow-hover transition-all duration-200 hover:-translate-y-0.5 ${
        accentClass || 'border border-border'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-text-soft text-xs font-medium uppercase tracking-wider mb-2">
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight text-text truncate">
            {value}
          </p>
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 ml-3">
            <Icon size={20} className="text-accent" />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
              deltaType === 'up'
                ? 'bg-success-bg text-success'
                : deltaType === 'down'
                ? 'bg-danger-bg text-danger'
                : 'bg-border-light text-text-muted'
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
        <p className="text-text-muted text-xs mt-2">{subtitle}</p>
      )}
    </div>
  )
}
