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
  highlightDate?: string
}

export default function RevenueChart({ data, title, highlightDate }: RevenueChartProps) {
  let trimmedData = [...data]
  while (trimmedData.length > 0 && trimmedData[trimmedData.length - 1].ventas_dia <= 0) {
    trimmedData.pop()
  }

  const chartData = trimmedData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    Ventas: d.ventas_dia,
  }))

  // `Math.max(...[])` devuelve -Infinity y `Math.min(...[])` +Infinity. Con un
  // restaurante sin ventas —o sea, TODO cliente nuevo el día 1— la leyenda de la
  // gráfica principal del dashboard decía, literal:
  //
  //     Alta -$∞        Baja $∞
  //
  // formatCurrency sólo filtra null y NaN; isNaN(-Infinity) es false, así que
  // pasaba de largo. Es lo primero que vería un prospecto a 600px de scroll.
  const maxVal = chartData.length > 0 ? Math.max(...chartData.map(d => d.Ventas)) : null
  const minVal = chartData.length > 0 ? Math.min(...chartData.map(d => d.Ventas)) : null
  const total = chartData.reduce((s, d) => s + d.Ventas, 0)

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-[var(--line)] p-4 sm:p-[18px]" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
      <div className="flex items-start justify-between mb-4 sm:mb-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-1)]">{title || 'Ventas'}</h3>
          <p className="text-xl sm:text-[26px] font-black tracking-[-0.03em] text-[var(--text-1)] tnum mt-1 leading-none">{formatCurrency(total)}</p>
          <p className="text-[10px] sm:text-[11px] text-[var(--text-3)] mt-1">{chartData.length} días</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-1 sm:gap-3.5 text-[10px] sm:text-[11px]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: 'var(--accent-bright)' }} />
            {/* Sin ventas no hay alta ni baja. formatCurrency(null) daría '$0',
                que se leería como "tu mejor día fueron cero pesos" — y eso no es
                lo mismo que "todavía no hay días". */}
            <span className="text-[var(--text-2)]">Alta {maxVal === null ? '—' : formatCurrency(maxVal)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: '#f87171' }} />
            <span className="text-[var(--text-2)]">Baja {minVal === null ? '—' : formatCurrency(minVal)}</span>
          </div>
        </div>
      </div>
      <div className="h-[180px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradientVentas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 6" stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="fecha"
              tick={{ fontSize: 11, fill: 'var(--text-3)' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-3)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={55}
            />
            <Tooltip
              formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
              contentStyle={{
                backgroundColor: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: '12px',
                padding: '10px 14px',
                boxShadow: 'var(--shadow-mid)',
              }}
              itemStyle={{ color: 'var(--accent-ink)', fontSize: '13px', fontWeight: 600 }}
              labelStyle={{ color: 'var(--text-3)', fontSize: '11px', marginBottom: '4px' }}
              cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="Ventas"
              stroke="var(--accent)"
              strokeWidth={2.4}
              fill="url(#gradientVentas)"
              dot={false}
              // Recharts anima por omisión, pero con 1500 ms y curva genérica: se
              // siente lento y a nadie le queda claro si terminó. 900 ms con
              // salida suave lee como "se está dibujando" en vez de "está
              // tardando". La misma curva que usa el resto del sistema.
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
              activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }}
            />
            {/* Emphasized endpoint dot (matches DS v2 .chart-end) */}
            {chartData.length > 0 && !highlightDate && (
              <ReferenceDot
                x={chartData[chartData.length - 1].fecha}
                y={chartData[chartData.length - 1].Ventas}
                r={5.5}
                fill="var(--accent)"
                stroke="var(--bg)"
                strokeWidth={2}
              />
            )}
            {highlightDate && (() => {
              const hlLabel = formatShortDate(highlightDate)
              const hlPoint = chartData.find(d => d.fecha === hlLabel)
              if (!hlPoint) return null
              return (
                <ReferenceDot
                  x={hlPoint.fecha}
                  y={hlPoint.Ventas}
                  r={8}
                  fill="var(--accent)"
                  stroke="var(--bg)"
                  strokeWidth={3}
                />
              )
            })()}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
