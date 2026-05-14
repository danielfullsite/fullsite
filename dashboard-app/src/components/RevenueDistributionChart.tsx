'use client'

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'
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
  const sorted = [...data].sort((a, b) => b.total - a.total)
  const top6 = sorted.slice(0, 6)
  const othersTotal = sorted.slice(6).reduce((sum, d) => sum + d.total, 0)
  const chartData =
    othersTotal > 0
      ? [...top6, { nombre: 'Otros', total: othersTotal }]
      : top6

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {title && (
        <h3 className="text-sm font-semibold text-text mb-4">{title}</h3>
      )}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={90}
              dataKey="total"
              nameKey="nombre"
              paddingAngle={2}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: any) => formatCurrency(Number(value))}
              contentStyle={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '11px' }}
              iconType="circle"
              iconSize={8}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
