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
  const chartData = data.map((d) => ({
    fecha: formatShortDate(d.fecha),
    ventas: d.ventas_dia,
  }))

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {title && (
        <h3 className="text-sm font-semibold text-text mb-4">{title}</h3>
      )}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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
              formatter={(value: any) => [formatCurrency(Number(value)), 'Ventas']}
              contentStyle={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Area
              type="monotone"
              dataKey="ventas"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorVentas)"
              dot={false}
              activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
