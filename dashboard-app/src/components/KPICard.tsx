'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
  subtitle?: string
}

export default function KPICard({
  label,
  value,
  delta,
  deltaType = 'neutral',
  subtitle,
}: KPICardProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-sm transition-shadow">
      <p className="text-text-soft text-sm font-medium mb-2">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-text">
        {value}
      </p>
      {delta && (
        <div className="mt-2 flex items-center gap-1.5">
          {deltaType === 'up' && (
            <TrendingUp size={14} className="text-success" />
          )}
          {deltaType === 'down' && (
            <TrendingDown size={14} className="text-danger" />
          )}
          {deltaType === 'neutral' && (
            <Minus size={14} className="text-text-muted" />
          )}
          <span
            className={`text-xs font-medium ${
              deltaType === 'up'
                ? 'text-success'
                : deltaType === 'down'
                ? 'text-danger'
                : 'text-text-muted'
            }`}
          >
            {delta}
          </span>
        </div>
      )}
      {subtitle && (
        <p className="text-text-muted text-xs mt-1">{subtitle}</p>
      )}
    </div>
  )
}
