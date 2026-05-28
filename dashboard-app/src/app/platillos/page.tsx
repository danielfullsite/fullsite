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
import { UtensilsCrossed, TrendingUp, BarChart3, Coffee, Sparkles } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateGrupos, getWansoftDataLatest } from '@/lib/data'
import { formatCurrency, formatShortDate, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
]

export default function PlatillosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [modifiers, setModifiers] = useState<{ nombre: string; total: number; _cols?: string[] }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [data, modsResult] = await Promise.all([
          getRecentDays(30),
          getWansoftDataLatest('modifiers_sold'),
        ])
        setRecentData(data)
        if (modsResult?.data) {
          const raw = Array.isArray(modsResult.data) ? modsResult.data : []
          setModifiers(raw.filter((m: any) => m.nombre && m.total > 0).sort((a: any, b: any) => b.total - a.total))
        }
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
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-2)] text-sm font-medium">Cargando datos...</p>
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
        title="Platillos y Categorías"
        subtitle="Desglose de ventas por grupo y platillos destacados (30 días)"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <KPICard
          label="Total categorías"
          value={formatNumber(grupos.length)}
          subtitle="categorías activas"
          icon={BarChart3}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Ventas totales"
          value={formatCurrency(totalAll)}
          subtitle="30 días"
          icon={UtensilsCrossed}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Chilaquiles"
          value={formatCurrency(totalChilaquiles)}
          subtitle="30 días acumulado"
          icon={Coffee}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Half & Half"
          value={formatCurrency(totalHH)}
          subtitle="30 días acumulado"
          icon={TrendingUp}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Top categories horizontal bar chart */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
          Ventas por categoría (top 15)
        </h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Últimos 30 días</p>
        <div className="h-[350px] sm:h-[480px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
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
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
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
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Categorías principales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {topGrupos.slice(0, 10).map((g, i) => {
            const pct = totalAll > 0 ? ((g.total / totalAll) * 100) : 0
            return (
              <div
                key={g.nombre}
                className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
              >
                <div
                  className="w-3 h-3 rounded-full mb-3"
                  style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                />
                <p className="text-xs font-medium text-[var(--text-2)] truncate mb-1">
                  {g.nombre}
                </p>
                <p className="text-lg font-bold text-[var(--text-1)] tabular-nums">
                  {formatCurrency(g.total)}
                </p>
                <p className="text-xs text-[var(--text-3)] tabular-nums mt-0.5">
                  {pct.toFixed(1)}% del total
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Chilaquiles & H&H trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
            Chilaquiles (ventas $)
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-5">Tendencia 30 días</p>
          <div className="h-[180px] sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <defs>
                  <linearGradient id="colorChilaquiles" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
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
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
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
                  activeDot={{ r: 4, stroke: '#ef4444', strokeWidth: 2, fill: 'var(--text-3)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
            Half & Half (ventas $)
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-5">Tendencia 30 días</p>
          <div className="h-[180px] sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <defs>
                  <linearGradient id="colorHH" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
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
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
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
                  activeDot={{ r: 4, stroke: '#f59e0b', strokeWidth: 2, fill: 'var(--text-3)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Categories table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="p-6 border-b border-[var(--line)]">
          <h3 className="text-sm font-semibold text-[var(--text-1)]">
            Todas las categorías
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-0.5">Últimos 30 días - {grupos.length} categorías</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/50">
                <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">#</th>
                <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Categoria</th>
                <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider w-40">Progreso</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Total ventas</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">% del total</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => {
                const pct = totalAll > 0 ? ((g.total / totalAll) * 100).toFixed(1) : '0'
                const barWidth = topGrupoMax > 0 ? ((g.total / topGrupoMax) * 100) : 0
                return (
                  <tr
                    key={g.nombre}
                    className="border-b border-[var(--line-soft)] hover:bg-blue-500/10/30 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-[var(--text-3)] tabular-nums font-medium">{i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                        />
                        <span className="text-sm font-medium text-[var(--text-1)]">{g.nombre}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-full bg-[var(--surface-2)] rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full animate-progress"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                      {formatCurrency(g.total)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">
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

      {/* Modifiers sold */}
      {modifiers.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mt-6">
          <div className="px-4 py-3 border-b border-[var(--line-soft)]">
            <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400" /> Modificadores más vendidos
            </h3>
            <p className="text-xs text-[var(--text-3)]">Extras, quitar, agregar — lo que más piden los clientes</p>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {modifiers.slice(0, 20).map((mod, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-3)] w-5">{i + 1}</span>
                  <div>
                    <span className="text-sm text-[var(--text-1)]">{mod.nombre}</span>
                    {mod._cols && mod._cols[1] && (
                      <p className="text-xs text-[var(--text-3)]">{mod._cols[1]}</p>
                    )}
                  </div>
                </div>
                <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(mod.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
