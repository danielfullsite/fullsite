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

  return (
    <div className="bg-card rounded-xl border border-border p-5 card-shadow">
      {title && (
        <h3 className="text-sm font-semibold text-text mb-1">{title}</h3>
      )}
      <p className="text-xs text-text-muted mb-4">{chartData.length} días con datos</p>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.08} />
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
                background: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                padding: '10px 14px',
              }}
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="ventas"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#colorVentas)"
              dot={false}
              activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
