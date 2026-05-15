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
import { TrendingUp } from 'lucide-react'

interface RevenueChartProps {
  data: { fecha: string; ventas_dia: number }[]
  title?: string
}

export default function RevenueChart({ data, title }: RevenueChartProps) {
  // Filter out trailing days with ventas_dia = 0 (today with no data yet)
  let trimmedData = [...data]
  while (trimmedData.length > 0 && trimmedData[trimmedData.length - 1].ventas_dia <= 0) {
    trimmedData.pop()
  }

  const chartData = trimmedData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    ventas: d.ventas_dia,
  }))

  // Find min and max for annotations
  let minIdx = 0
  let maxIdx = 0
  chartData.forEach((d, i) => {
    if (d.ventas < chartData[minIdx].ventas) minIdx = i
    if (d.ventas > chartData[maxIdx].ventas) maxIdx = i
  })

  return (
    <div className="premium-card p-6">
      {title && (
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
            <TrendingUp size={14} className="text-blue-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
      )}
      <p className="text-xs text-slate-400 mb-5 ml-9">{chartData.length} dias con datos</p>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorVentasPremium" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="30%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="70%" stopColor="#3b82f6" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
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
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(8px)',
                border: 'none',
                borderRadius: '12px',
                fontSize: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                padding: '10px 14px',
              }}
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="ventas"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#colorVentasPremium)"
              dot={false}
              activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff', filter: 'url(#glow)' }}
            />
            {chartData.length > 2 && (
              <ReferenceDot
                x={chartData[maxIdx].fecha}
                y={chartData[maxIdx].ventas}
                r={5}
                fill="#10b981"
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            {chartData.length > 2 && minIdx !== maxIdx && (
              <ReferenceDot
                x={chartData[minIdx].fecha}
                y={chartData[minIdx].ventas}
                r={5}
                fill="#ef4444"
                stroke="#fff"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {chartData.length > 2 && (
        <div className="flex items-center gap-4 mt-3 ml-9 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            Max: {formatCurrency(chartData[maxIdx].ventas)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            Min: {formatCurrency(chartData[minIdx].ventas)}
          </span>
        </div>
      )}
    </div>
  )
}
