'use client'

import { formatCurrency } from '@/lib/format'

interface Props {
  data: { nombre: string; total: number }[]
  title?: string
}

const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
]

export default function RevenueDistributionChart({ data, title }: Props) {
  const sorted = [...data].filter(d => d.total > 0).sort((a, b) => b.total - a.total)
  const topItems = sorted.slice(0, 8)
  const grandTotal = sorted.reduce((sum, d) => sum + d.total, 0)

  if (topItems.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-5 card-shadow h-full flex flex-col">
        {title && (
          <h3 className="text-sm font-semibold text-text mb-4">{title}</h3>
        )}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm">Sin datos de categorías</p>
        </div>
      </div>
    )
  }

  const maxVal = topItems[0]?.total || 1

  return (
    <div className="bg-card rounded-xl border border-border p-5 card-shadow h-full flex flex-col">
      {title && (
        <h3 className="text-sm font-semibold text-text mb-1">{title}</h3>
      )}
      <p className="text-xs text-text-muted mb-4">
        Total: {formatCurrency(grandTotal)}
      </p>
      <div className="space-y-3 flex-1">
        {topItems.map((item, i) => {
          const pct = grandTotal > 0 ? ((item.total / grandTotal) * 100) : 0
          const barWidth = maxVal > 0 ? ((item.total / maxVal) * 100) : 0
          return (
            <div key={item.nombre}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-xs font-medium text-text truncate">
                    {item.nombre}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-text-soft ml-2 shrink-0">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-surface rounded-full h-2">
                <div
                  className="h-2 rounded-full animate-progress transition-all"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: COLORS[i % COLORS.length],
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
