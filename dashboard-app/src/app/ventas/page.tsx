'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { DollarSign, Receipt, Tag, Gift, Store, ShoppingBag, Smartphone } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getDateRange, aggregatePayments, aggregateGrupos } from '@/lib/data'
import { formatCurrency, formatPercent, percentChange } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

type Preset = 'hoy' | 'ayer' | 'semana' | 'mes' | 'custom'

function getPresetDates(preset: Preset): { from: string; to: string } {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  switch (preset) {
    case 'hoy':
      return { from: fmt(today), to: fmt(today) }
    case 'ayer': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { from: fmt(y), to: fmt(y) }
    }
    case 'semana': {
      const start = new Date(today)
      start.setDate(start.getDate() - start.getDay() + 1)
      return { from: fmt(start), to: fmt(today) }
    }
    case 'mes': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: fmt(start), to: fmt(today) }
    }
    default:
      return { from: fmt(today), to: fmt(today) }
  }
}

const PAYMENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']
const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
]

export default function VentasPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [prevData, setPrevData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<Preset>('mes')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const dates = useMemo(() => {
    if (preset === 'custom' && customFrom && customTo) {
      return { from: customFrom, to: customTo }
    }
    return getPresetDates(preset)
  }, [preset, customFrom, customTo])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getDateRange(dates.from, dates.to)
      setData(result)

      const fromDate = new Date(dates.from + 'T12:00:00')
      const toDate = new Date(dates.to + 'T12:00:00')
      const diff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
      const prevTo = new Date(fromDate)
      prevTo.setDate(prevTo.getDate() - 1)
      const prevFrom = new Date(prevTo)
      prevFrom.setDate(prevFrom.getDate() - diff + 1)
      const prevResult = await getDateRange(
        prevFrom.toISOString().slice(0, 10),
        prevTo.toISOString().slice(0, 10)
      )
      setPrevData(prevResult)
    } catch (err) {
      console.error('Error loading ventas data:', err)
    } finally {
      setLoading(false)
    }
  }, [dates])

  useEffect(() => {
    loadData()
  }, [loadData])

  // KPIs
  const totalVentasNetas = data.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const totalVentasBrutas = data.reduce((s, d) => s + (d.ventas_brutas || 0), 0)
  const totalDescuentos = data.reduce((s, d) => s + (d.descuentos || 0), 0)
  const totalDevoluciones = data.reduce((s, d) => s + (d.devoluciones || 0), 0)

  const prevVentasNetas = prevData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const prevVentasBrutas = prevData.reduce((s, d) => s + (d.ventas_brutas || 0), 0)

  const ventasNetasChange = percentChange(totalVentasNetas, prevVentasNetas)
  const ventasBrutasChange = percentChange(totalVentasBrutas, prevVentasBrutas)

  // Payment methods
  const payments = aggregatePayments(data)
  const paymentMax = payments[0]?.total || 1
  const paymentTotal = payments.reduce((s, p) => s + p.total, 0)

  // Categories
  const grupos = aggregateGrupos(data)
  const topGrupos = grupos.slice(0, 10)
  const grupoMax = topGrupos[0]?.total || 1

  // Daily revenue for area chart
  const dailyChart = data.map(d => ({
    fecha: new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
    ventas: d.ventas_dia,
  }))

  const presets: { key: Preset; label: string }[] = [
    { key: 'hoy', label: 'Hoy' },
    { key: 'ayer', label: 'Ayer' },
    { key: 'semana', label: 'Semana' },
    { key: 'mes', label: 'Mes' },
    { key: 'custom', label: 'Personalizado' },
  ]

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Ventas Detalladas"
        subtitle={`${dates.from} al ${dates.to} ${data.length > 0 ? `- ${data.length} días con datos` : ''}`}
      />

      {/* Segmented date range picker */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="segmented-control">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={preset === p.key ? 'active' : ''}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
            <span className="text-slate-400 text-sm">a</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 text-sm font-medium">Cargando datos...</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <KPICard
              label="Ventas netas"
              value={formatCurrency(totalVentasNetas)}
              delta={prevVentasNetas > 0 ? `${formatPercent(ventasNetasChange)} vs periodo anterior` : undefined}
              deltaType={ventasNetasChange >= 0 ? 'up' : 'down'}
              icon={DollarSign}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Ventas brutas"
              value={formatCurrency(totalVentasBrutas)}
              delta={prevVentasBrutas > 0 ? `${formatPercent(ventasBrutasChange)} vs periodo anterior` : undefined}
              deltaType={ventasBrutasChange >= 0 ? 'up' : 'down'}
              icon={Receipt}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Descuentos"
              value={formatCurrency(totalDescuentos)}
              subtitle={totalVentasBrutas > 0 ? `${((totalDescuentos / totalVentasBrutas) * 100).toFixed(1)}% de ventas brutas` : ''}
              icon={Tag}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="Devoluciones"
              value={formatCurrency(totalDevoluciones)}
              subtitle="Cortesías y devoluciones"
              icon={Gift}
              accentClass="kpi-accent-purple"
            />
          </div>

          {/* Daily sales area chart */}
          {dailyChart.length > 1 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Ventas por día
              </h3>
              <p className="text-xs text-slate-400 mb-5">{data.length} días</p>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChart}>
                    <defs>
                      <linearGradient id="colorVentasDiarias" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
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
                    />
                    <Area
                      type="monotone"
                      dataKey="ventas"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      fill="url(#colorVentasDiarias)"
                      dot={false}
                      activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Payment methods */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Métodos de pago
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Total: {formatCurrency(paymentTotal)}
              </p>
              {payments.length > 0 ? (
                <div className="space-y-4">
                  {payments.map((p, i) => {
                    const pct = paymentTotal > 0 ? ((p.total / paymentTotal) * 100).toFixed(1) : '0'
                    const barWidth = paymentMax > 0 ? ((p.total / paymentMax) * 100) : 0
                    return (
                      <div key={p.nombre}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }}
                            />
                            <span className="text-sm font-medium text-slate-700">{p.nombre}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatCurrency(p.total)}{' '}
                            <span className="text-slate-400 text-xs font-normal">({pct}%)</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full animate-progress"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-slate-400 text-sm py-8 text-center">Sin datos de métodos de pago</p>
              )}
            </div>

            {/* Revenue distribution by category */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Distribución por categoría
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Top 10 categorías
              </p>
              {topGrupos.length > 0 ? (
                <div className="space-y-3">
                  {topGrupos.map((g, i) => {
                    const totalGrupos = grupos.reduce((s, x) => s + x.total, 0)
                    const pct = totalGrupos > 0 ? ((g.total / totalGrupos) * 100).toFixed(1) : '0'
                    const barWidth = grupoMax > 0 ? ((g.total / grupoMax) * 100) : 0
                    return (
                      <div key={g.nombre}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                            />
                            <span className="text-xs font-medium text-slate-700 truncate">{g.nombre}</span>
                          </div>
                          <span className="text-xs tabular-nums text-slate-500 ml-2 shrink-0">
                            {formatCurrency(g.total)} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full animate-progress"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-slate-400 text-sm py-8 text-center">Sin datos de categorías</p>
              )}
            </div>
          </div>

          {/* Sales by order type */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Desglose por tipo de orden
            </h3>
            <p className="text-xs text-slate-400 mb-5">Restaurante vs Para llevar</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-xl p-5 text-center border border-slate-100">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Store size={18} className="text-blue-500" />
                </div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Personas restaurante</p>
                <p className="text-2xl font-bold text-slate-900">{data.reduce((s, d) => s + (d.personas_restaurant || 0), 0).toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-5 text-center border border-slate-100">
                <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <ShoppingBag size={18} className="text-emerald-500" />
                </div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Ordenes para llevar</p>
                <p className="text-2xl font-bold text-slate-900">{data.reduce((s, d) => s + (d.ordenes_llevar || 0), 0).toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-5 text-center border border-slate-100">
                <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Smartphone size={18} className="text-purple-500" />
                </div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Propinas totales</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(data.reduce((s, d) => s + (d.propinas_total || 0), 0))}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
