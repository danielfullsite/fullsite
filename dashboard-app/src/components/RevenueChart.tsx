'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { formatCurrency, formatShortDate } from '@/lib/format'
import { TrendingUp } from 'lucide-react'

interface RevenueChartProps {
  data: { fecha: string; ventas_dia: number }[]
  title?: string
}

export default function RevenueChart({ data, title }: RevenueChartProps) {
  // Filter out trailing days with ventas_dia = 0
  let trimmedData = [...data]
  while (trimmedData.length > 0 && trimmedData[trimmedData.length - 1].ventas_dia <= 0) {
    trimmedData.pop()
  }

  const chartData = trimmedData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    ventas: d.ventas_dia,
  }))

  // Find min and max
  let minIdx = 0
  let maxIdx = 0
  chartData.forEach((d, i) => {
    if (d.ventas < chartData[minIdx].ventas) minIdx = i
    if (d.ventas > chartData[maxIdx].ventas) maxIdx = i
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {title && (
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <TrendingUp size={14} className="text-blue-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400 mb-5 ml-9">{chartData.length} días con datos</p>
      <div className="h-[220px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
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
                background: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="ventas"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorVentas)"
              dot={false}
              activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {chartData.length > 2 && (
        <div className="flex items-center gap-4 mt-3 ml-9 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Max: {formatCurrency(chartData[maxIdx].ventas)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            Min: {formatCurrency(chartData[minIdx].ventas)}
          </span>
        </div>
      )}
    </div>
  )
}
