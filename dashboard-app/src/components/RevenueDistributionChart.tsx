'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { formatCurrency } from '@/lib/format'

interface Props {
  data: { nombre: string; total: number }[]
  title?: string
}

const COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
  '#f97316', '#6366f1', '#14b8a6', '#e11d48',
]

export default function RevenueDistributionChart({ data, title }: Props) {
  const sorted = [...data].filter(d => d.total > 0).sort((a, b) => b.total - a.total)
  const total = sorted.reduce((s, d) => s + d.total, 0)
  const top8 = sorted.slice(0, 8)

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-900">{title || 'Distribucion por categoria'}</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4">Total: {formatCurrency(total)}</p>

      <div className="flex items-center gap-6">
        {/* Donut Chart */}
        <div className="w-[160px] h-[160px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={top8}
                dataKey="total"
                nameKey="nombre"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
                stroke="none"
              >
                {top8.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
                }}
                itemStyle={{ color: '#fff', fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          {top8.map((item, i) => {
            const pct = total > 0 ? ((item.total / total) * 100).toFixed(0) : '0'
            return (
              <div key={item.nombre} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="text-xs text-slate-600 flex-1 truncate">{item.nombre}</span>
                <span className="text-xs font-semibold text-slate-400">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
