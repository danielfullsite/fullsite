'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { ShoppingCart, Package, Receipt, TrendingUp } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const ECOMMERCE_KEYWORDS = ['ubereats', 'rappi', 'uber eats', 'didi food']

function extractEcommerce(day: WansoftDaily) {
  let total = 0
  const channels: Record<string, number> = {}
  const ventasDia = day.ventas_dia || 0

  if (day.pago_métodos && Array.isArray(day.pago_métodos)) {
    for (const m of day.pago_métodos) {
      const name = (m.nombre || '').toLowerCase()
      for (const kw of ECOMMERCE_KEYWORDS) {
        if (name.includes(kw)) {
          const label = name.includes('rappi') ? 'Rappi' : name.includes('ubereats') || name.includes('uber eats') ? 'Ubereats' : 'Otro'
          // m.total can be percentage or MXN — if < 100, treat as percentage of ventas_dia
          const amount = (m.total || 0) < 100 ? (m.total || 0) / 100 * ventasDia : (m.total || 0)
          channels[label] = (channels[label] || 0) + amount
          total += amount
          break
        }
      }
    }
  }

  return { total, channels }
}

export default function EcommercePage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(90).then(d => {
      setData(d)
      setLoading(false)
    })
  }, [])

  const ecommerceData = useMemo(() => {
    let totalEcommerce = 0
    let totalVentas = 0
    let ordenes = 0
    const channelTotals: Record<string, number> = {}
    const dailyData: { fecha: string; total: number; [key: string]: string | number }[] = []

    for (const day of data) {
      const ec = extractEcommerce(day)
      totalEcommerce += ec.total
      totalVentas += day.ventas_dia || 0
      if (ec.total > 0) ordenes++

      for (const [ch, val] of Object.entries(ec.channels)) {
        channelTotals[ch] = (channelTotals[ch] || 0) + val
      }

      dailyData.push({
        fecha: new Date(day.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        total: ec.total,
        ...ec.channels,
      })
    }

    const ticketPromedio = ordenes > 0 ? totalEcommerce / ordenes : 0
    const pctTotal = totalVentas > 0 ? (totalEcommerce / totalVentas) * 100 : 0

    const channels = Object.entries(channelTotals)
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Monthly aggregation
    const monthlyMap: Record<string, number> = {}
    for (const day of data) {
      const month = day.fecha.slice(0, 7)
      const ec = extractEcommerce(day)
      monthlyMap[month] = (monthlyMap[month] || 0) + ec.total
    }
    const monthly = Object.entries(monthlyMap)
      .map(([mes, total]) => ({
        mes: new Date(mes + '-15T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        total,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes))

    return { totalEcommerce, ordenes, ticketPromedio, pctTotal, channels, dailyData, monthly }
  }, [data])

  const channelColors: Record<string, string> = { Rappi: '#ff5a00', Ubereats: '#06c167', Otro: '#8b5cf6' }
  const channelMax = ecommerceData.channels[0]?.total || 1

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="eCommerce"
        subtitle="Rappi, Ubereats y plataformas de delivery"
      />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--text-2)] text-sm font-medium">Cargando datos...</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <KPICard
              label="Ventas eCommerce"
              value={formatCurrency(ecommerceData.totalEcommerce)}
              subtitle="Total en el periodo"
              icon={ShoppingCart}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Dias con ordenes"
              value={formatNumber(ecommerceData.ordenes)}
              subtitle="Dias con ventas eCommerce"
              icon={Package}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Ticket promedio eCommerce"
              value={formatCurrency(ecommerceData.ticketPromedio)}
              subtitle="Promedio por día con ordenes"
              icon={Receipt}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="% del total"
              value={`${ecommerceData.pctTotal.toFixed(1)}%`}
              subtitle="Proporcion sobre ventas totales"
              icon={TrendingUp}
              accentClass="kpi-accent-purple"
            />
          </div>

          {ecommerceData.totalEcommerce === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
              <p className="text-sm text-amber-400 font-medium">
                Sin datos de eCommerce
              </p>
              <p className="text-xs text-amber-400 mt-1">
                No se encontraron ventas de Rappi, Ubereats u otras plataformas en los métodos de pago.
                Si tu restaurante usa delivery, verifica que los pagos se registren correctamente en Wansoft.
              </p>
            </div>
          ) : (
            <>
              {/* Channel breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
                  <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
                    Ventas por canal
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mb-5">
                    Desglose por plataforma
                  </p>
                  <div className="space-y-4">
                    {ecommerceData.channels.map((ch) => {
                      const pct = ecommerceData.totalEcommerce > 0
                        ? ((ch.total / ecommerceData.totalEcommerce) * 100).toFixed(1)
                        : '0'
                      const barWidth = channelMax > 0 ? ((ch.total / channelMax) * 100) : 0
                      const color = channelColors[ch.nombre] || '#3b82f6'
                      return (
                        <div key={ch.nombre}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-sm font-medium text-[var(--text-1)]">{ch.nombre}</span>
                            </div>
                            <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">
                              {formatCurrency(ch.total)}{' '}
                              <span className="text-[var(--text-3)] text-xs font-normal">({pct}%)</span>
                            </span>
                          </div>
                          <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                            <div
                              className="h-2 rounded-full animate-progress"
                              style={{ width: `${barWidth}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Bar chart by channel */}
                {ecommerceData.channels.length > 0 && (
                  <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
                    <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
                      Comparativo por canal
                    </h3>
                    <p className="text-xs text-[var(--text-3)] mb-5">Total acumulado</p>
                    <div className="h-[200px] sm:h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ecommerceData.channels}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                          <XAxis
                            dataKey="nombre"
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
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
                              background: 'var(--surface)',
                              border: '1px solid var(--line)',
                              borderRadius: '8px',
                              fontSize: '12px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            }}
                          />
                          <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {/* Monthly trend */}
              {ecommerceData.monthly.length > 1 && (
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
                  <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
                    Tendencia mensual eCommerce
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mb-5">Ventas por mes</p>
                  <div className="h-[250px] sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ecommerceData.monthly}>
                        <defs>
                          <linearGradient id="colorEcommerce" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                        <XAxis
                          dataKey="mes"
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                          width={55}
                        />
                        <Tooltip
                          formatter={(value) => [formatCurrency(Number(value)), 'eCommerce']}
                          contentStyle={{
                            background: 'var(--surface)',
                            border: '1px solid var(--line)',
                            borderRadius: '8px',
                            fontSize: '12px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          fill="url(#colorEcommerce)"
                          dot={false}
                          activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: 'var(--text-3)' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
