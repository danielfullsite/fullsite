'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Cell,
} from 'recharts'
import { UtensilsCrossed, TrendingUp, BarChart3, Coffee } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateGrupos } from '@/lib/data'
import { formatCurrency, formatShortDate, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
]

export default function PlatillosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRecentDays(30)
        setRecentData(data)
      } catch (err) {
        console.error('Error loading platillos data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-soft text-sm font-medium">Cargando datos...</p>
        </div>
      </div>
    )
  }

  const grupos = aggregateGrupos(recentData)
  const topGrupos = grupos.slice(0, 15)
  const totalAll = grupos.reduce((s, x) => s + x.total, 0)
  const topGrupoMax = topGrupos[0]?.total || 1

  const chartData = topGrupos.map((g, i) => ({
    nombre: g.nombre.length > 22 ? g.nombre.slice(0, 20) + '...' : g.nombre,
    fullName: g.nombre,
    total: g.total,
    fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }))

  // Chilaquiles & H&H trend
  const specialTrend = recentData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    chilaquiles: d.chilaquiles_total || 0,
    hh: d.half_half_total || 0,
  }))

  const totalChilaquiles = recentData.reduce((s, d) => s + (d.chilaquiles_total || 0), 0)
  const totalHH = recentData.reduce((s, d) => s + (d.half_half_total || 0), 0)

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Platillos y Categorias"
        subtitle="Desglose de ventas por grupo y platillos destacados (30 dias)"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Total categorias"
          value={formatNumber(grupos.length)}
          subtitle="categorias activas"
          icon={BarChart3}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Ventas totales"
          value={formatCurrency(totalAll)}
          subtitle="30 dias"
          icon={UtensilsCrossed}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Chilaquiles"
          value={formatCurrency(totalChilaquiles)}
          subtitle="30 dias acumulado"
          icon={Coffee}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Half & Half"
          value={formatCurrency(totalHH)}
          subtitle="30 dias acumulado"
          icon={TrendingUp}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Top categories horizontal bar chart */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <h3 className="text-sm font-semibold text-text mb-1">
          Ventas por categoria (top 15)
        </h3>
        <p className="text-xs text-text-muted mb-4">Ultimos 30 dias</p>
        <div className="h-[480px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                width={170}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
                labelFormatter={(label) => {
                  const item = chartData.find(d => d.nombre === label)
                  return item?.fullName || label
                }}
                contentStyle={{
                  background: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={20}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category cards grid */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-text mb-4">Categorias principales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {topGrupos.slice(0, 10).map((g, i) => {
            const pct = totalAll > 0 ? ((g.total / totalAll) * 100) : 0
            return (
              <div
                key={g.nombre}
                className="bg-card rounded-xl border border-border p-4 card-shadow hover:card-shadow-hover transition-all duration-200 hover:-translate-y-0.5"
              >
                <div
                  className="w-3 h-3 rounded-full mb-3"
                  style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                />
                <p className="text-xs font-medium text-text-soft truncate mb-1">
                  {g.nombre}
                </p>
                <p className="text-lg font-bold text-text tabular-nums">
                  {formatCurrency(g.total)}
                </p>
                <p className="text-xs text-text-muted tabular-nums mt-0.5">
                  {pct.toFixed(1)}% del total
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Chilaquiles & H&H trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Chilaquiles (ventas $)
          </h3>
          <p className="text-xs text-text-muted mb-4">Tendencia 30 dias</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <defs>
                  <linearGradient id="colorChilaquiles" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
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
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), 'Chilaquiles']}
                  contentStyle={{
                    background: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="chilaquiles"
                  stroke="#ef4444"
                  fill="url(#colorChilaquiles)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, stroke: '#ef4444', strokeWidth: 2, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Half & Half (ventas $)
          </h3>
          <p className="text-xs text-text-muted mb-4">Tendencia 30 dias</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <defs>
                  <linearGradient id="colorHH" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
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
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), 'H&H']}
                  contentStyle={{
                    background: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="hh"
                  stroke="#f59e0b"
                  fill="url(#colorHH)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, stroke: '#f59e0b', strokeWidth: 2, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Categories table */}
      <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="text-sm font-semibold text-text">
            Todas las categorias
          </h3>
          <p className="text-xs text-text-muted mt-0.5">Ultimos 30 dias - {grupos.length} categorias</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">#</th>
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Categoria</th>
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider w-40">Progreso</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Total ventas</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">% del total</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => {
                const pct = totalAll > 0 ? ((g.total / totalAll) * 100).toFixed(1) : '0'
                const barWidth = topGrupoMax > 0 ? ((g.total / topGrupoMax) * 100) : 0
                return (
                  <tr
                    key={g.nombre}
                    className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-text-muted tabular-nums font-medium">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                        />
                        <span className="text-sm font-medium text-text">{g.nombre}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-full bg-surface rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full animate-progress"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-text">
                      {formatCurrency(g.total)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/10 text-accent">
                        {pct}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
