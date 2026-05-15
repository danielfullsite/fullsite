'use client'

import { formatCurrency } from '@/lib/format'
import { PieChart } from 'lucide-react'

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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 h-full flex flex-col">
        {title && (
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
              <PieChart size={14} className="text-purple-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400 text-sm">Sin datos de categorias</p>
        </div>
      </div>
    )
  }

  const maxVal = topItems[0]?.total || 1

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 h-full flex flex-col">
      {title && (
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
            <PieChart size={14} className="text-purple-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
      )}
      <p className="text-xs text-slate-400 mb-5 ml-9">
        Total: {formatCurrency(grandTotal)}
      </p>
      <div className="space-y-3.5 flex-1">
        {topItems.map((item, i) => {
          const pct = grandTotal > 0 ? ((item.total / grandTotal) * 100) : 0
          const barWidth = maxVal > 0 ? ((item.total / maxVal) * 100) : 0
          return (
            <div key={item.nombre}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-xs font-medium text-slate-700 truncate">
                    {item.nombre}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-slate-500 ml-2 shrink-0">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full animate-progress transition-all"
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
