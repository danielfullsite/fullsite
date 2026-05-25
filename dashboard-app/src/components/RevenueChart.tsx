'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from 'recharts'
import { formatCurrency, formatShortDate } from '@/lib/format'

interface RevenueChartProps {
  data: { fecha: string; ventas_dia: number }[]
  title?: string
}

export default function RevenueChart({ data, title }: RevenueChartProps) {
  let trimmedData = [...data]
  while (trimmedData.length > 0 && trimmedData[trimmedData.length - 1].ventas_dia <= 0) {
    trimmedData.pop()
  }

  const chartData = trimmedData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    Ventas: d.ventas_dia,
  }))

  const maxVal = Math.max(...chartData.map(d => d.Ventas))
  const minVal = Math.min(...chartData.map(d => d.Ventas))
  const total = chartData.reduce((s, d) => s + d.Ventas, 0)

  return (
    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-1)]">{title || 'Ventas'}</h3>
          <p className="text-2xl font-bold text-[var(--text-1)] mt-1">{formatCurrency(total)}</p>
          <p className="text-xs text-[var(--text-3)] mt-0.5">{chartData.length} dias</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-[var(--text-2)]">Max: {formatCurrency(maxVal)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="text-[var(--text-2)]">Min: {formatCurrency(minVal)}</span>
          </div>
        </div>
      </div>
      <div className="h-[240px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradientVentas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="50%" stopColor="#10b981" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="fecha"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={55}
            />
            <Tooltip
              formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
              contentStyle={{
                backgroundColor: '#0f172a',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 14px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
              }}
              itemStyle={{ color: '#10b981', fontSize: '13px', fontWeight: 600 }}
              labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}
              cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="Ventas"
              stroke="#10b981"
              strokeWidth={2.5}
              fill="url(#gradientVentas)"
              dot={false}
              activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
