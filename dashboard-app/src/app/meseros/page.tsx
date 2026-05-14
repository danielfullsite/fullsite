'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { DollarSign, Ticket, Users, Trophy } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateMeseros, getWaiterCategories } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily, WaiterCategoryData } from '@/lib/types'

const BAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']

type Tab = 'ventas' | 'kpis' | 'detalle'

export default function MeserosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [waiterData, setWaiterData] = useState<{ fecha: string; data: WaiterCategoryData }[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<7 | 14 | 30>(7)
  const [tab, setTab] = useState<Tab>('ventas')

  useEffect(() => {
    async function load() {
      try {
        const [data, waiterCats] = await Promise.all([
          getRecentDays(30),
          getWaiterCategories(30),
        ])
        setRecentData(data)
        setWaiterData(waiterCats as { fecha: string; data: WaiterCategoryData }[])
      } catch (err) {
        console.error('Error loading meseros data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const periodData = recentData.slice(-period)
  const meseros = aggregateMeseros(periodData)

  const totalVentas = meseros.reduce((sum, m) => sum + m.total, 0)
  const totalTicketDays = meseros.reduce((sum, m) => sum + m.dias, 0)
  const avgTicket = totalTicketDays > 0
    ? Math.round(totalVentas / totalTicketDays)
    : 0
  const topMesero = meseros[0]
  const topMeseroMax = topMesero?.total || 1

  const chartData = meseros.slice(0, 10).map((m, i) => ({
    nombre: m.nombre.split(' ').slice(0, 2).join(' '),
    total: m.total,
    promedio: m.promedio,
    fill: BAR_COLORS[i % BAR_COLORS.length],
  }))

  // Aggregate waiter KPIs from wansoft_waiter_categories
  const waiterKpis = useMemo(() => {
    if (waiterData.length === 0) return []
    const map: Record<string, {
      totalVentas: number
      totalMesas: number
      totalPersonas: number
      hh: number
      pan: number
      postres: number
      bebida2: number
      dias: number
      grupos: Record<string, number>
    }> = {}

    for (const entry of waiterData) {
      const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data
      if (!d || typeof d !== 'object') continue
      for (const [nombre, info] of Object.entries(d)) {
        if (nombre.startsWith('__') || !nombre || nombre === 'MESERO EVENTO') continue
        const w = info as Record<string, unknown>
        if (!map[nombre]) {
          map[nombre] = { totalVentas: 0, totalMesas: 0, totalPersonas: 0, hh: 0, pan: 0, postres: 0, bebida2: 0, dias: 0, grupos: {} }
        }
        const kpis = w.KPIs as Record<string, number> | undefined
        if (kpis) {
          map[nombre].totalVentas += kpis.total_ventas || 0
          map[nombre].totalMesas += kpis.mesas || 0
          map[nombre].totalPersonas += kpis.personas || 0
        }
        map[nombre].hh += (w['H&H'] as number) || 0
        map[nombre].pan += (w.Pan as number) || 0
        map[nombre].postres += (w.Postres as number) || 0
        map[nombre].bebida2 += (w['2da Bebida'] as number) || 0
        map[nombre].dias += 1

        // Aggregate per-waiter group sales
        const grupoData = w.__por_mesero_grupo as Record<string, number> | undefined
        if (grupoData) {
          for (const [cat, val] of Object.entries(grupoData)) {
            map[nombre].grupos[cat] = (map[nombre].grupos[cat] || 0) + (val || 0)
          }
        }
      }
    }

    return Object.entries(map)
      .map(([nombre, d]) => ({
        nombre,
        totalVentas: d.totalVentas,
        mesas: d.totalMesas,
        personas: d.totalPersonas,
        hh: d.hh,
        pan: d.pan,
        postres: d.postres,
        bebida2: d.bebida2,
        dias: d.dias,
        alimentosPorPersona: d.totalPersonas > 0 ? (d.totalVentas / d.totalPersonas) : 0,
        grupos: Object.entries(d.grupos)
          .map(([cat, total]) => ({ cat, total }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.totalVentas - a.totalVentas)
  }, [waiterData])

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

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Meseros"
        subtitle={`Performance de meseros - ultimos ${period} dias`}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {([
          { key: 'ventas' as Tab, label: 'Ventas' },
          { key: 'kpis' as Tab, label: 'KPIs' },
          { key: 'detalle' as Tab, label: 'Detalle' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-soft hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ventas' && (
        <>
          {/* Period selector */}
          <div className="flex gap-2 mb-6">
            {([7, 14, 30] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  period === p
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-card border border-border text-text-soft hover:text-text hover:border-accent/30'
                }`}
              >
                {p} dias
              </button>
            ))}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
            <KPICard
              label="Total ventas meseros"
              value={formatCurrency(totalVentas)}
              subtitle={`Ultimos ${period} dias`}
              icon={DollarSign}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Promedio diario"
              value={formatCurrency(avgTicket)}
              subtitle="por dia total"
              icon={Ticket}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Meseros activos"
              value={formatNumber(meseros.length)}
              subtitle={`en ${period} dias`}
              icon={Users}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="Top mesero"
              value={topMesero ? topMesero.nombre.split(' ').slice(0, 2).join(' ') : '-'}
              subtitle={topMesero ? formatCurrency(topMesero.total) : ''}
              icon={Trophy}
              accentClass="kpi-accent-purple"
            />
          </div>

          {/* Bar chart */}
          <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
            <h3 className="text-sm font-semibold text-text mb-1">
              Ventas por mesero (top 10)
            </h3>
            <p className="text-xs text-text-muted mb-4">Ultimos {period} dias</p>
            <div className="h-[360px]">
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
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                    width={130}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
                    contentStyle={{
                      background: '#fff',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '12px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  />
                  <Bar
                    dataKey="total"
                    radius={[0, 6, 6, 0]}
                    barSize={24}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed table */}
          <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-semibold text-text">
                Detalle por mesero
              </h3>
              <p className="text-xs text-text-muted mt-0.5">Todos los meseros activos</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-striped">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      #
                    </th>
                    <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      Mesero
                    </th>
                    <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider w-48">
                      Progreso
                    </th>
                    <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      Total ventas
                    </th>
                    <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      Prom. diario
                    </th>
                    <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      Dias
                    </th>
                    <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                      % total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {meseros.map((m, i) => {
                    const pct = totalVentas > 0
                      ? ((m.total / totalVentas) * 100).toFixed(1)
                      : '0'
                    const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                    return (
                      <tr
                        key={m.nombre}
                        className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                      >
                        <td className="py-3.5 px-4 text-sm text-text-muted tabular-nums font-medium">
                          {i + 1}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                            >
                              {m.nombre.charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-text">{m.nombre}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="w-full bg-surface rounded-full h-2">
                            <div
                              className="h-2 rounded-full animate-progress"
                              style={{
                                width: `${barWidth}%`,
                                backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                              }}
                            />
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                          {formatCurrency(m.total)}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatCurrency(m.promedio)}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-right tabular-nums text-text-soft">
                          {m.dias}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-right tabular-nums">
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
      )}

      {tab === 'kpis' && (
        <>
          {waiterKpis.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 card-shadow text-center">
              <p className="text-text-muted text-sm">Sin datos de KPIs de meseros disponibles</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-semibold text-text">KPIs por mesero</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Datos de {waiterData.length} dias - Ventas, mesas, personas, y productos clave
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-striped">
                  <thead>
                    <tr className="border-b border-border bg-surface/50">
                      <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">#</th>
                      <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Mesero</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Ventas</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Mesas</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Personas</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">$/persona</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">H&H</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Pan</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Postres</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">2da Bebida</th>
                      <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Dias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiterKpis.map((w, i) => (
                      <tr
                        key={w.nombre}
                        className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                      >
                        <td className="py-3 px-4 text-sm text-text-muted">{i + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                            >
                              {w.nombre.charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-text truncate max-w-[180px]">{w.nombre}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-text">
                          {formatCurrency(w.totalVentas)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatNumber(w.mesas)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatNumber(w.personas)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums font-semibold text-text">
                          {formatCurrency(Math.round(w.alimentosPorPersona))}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatCurrency(w.hh)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatCurrency(w.pan)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatCurrency(w.postres)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {formatCurrency(w.bebida2)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                          {w.dias}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'detalle' && (
        <>
          {waiterKpis.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 card-shadow text-center">
              <p className="text-text-muted text-sm">Sin datos de detalle por mesero disponibles</p>
            </div>
          ) : (
            <div className="space-y-6">
              {waiterKpis.filter(w => w.grupos.length > 0).map((w, wi) => (
                <div key={w.nombre} className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
                  <div className="p-5 border-b border-border flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ backgroundColor: BAR_COLORS[wi % BAR_COLORS.length] }}
                    >
                      {w.nombre.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text">{w.nombre}</h3>
                      <p className="text-xs text-text-muted">
                        Total: {formatCurrency(w.totalVentas)} - {w.grupos.length} categorias
                      </p>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {w.grupos.slice(0, 12).map((g, gi) => {
                        const maxG = w.grupos[0]?.total || 1
                        const barW = maxG > 0 ? ((g.total / maxG) * 100) : 0
                        return (
                          <div key={g.cat} className="bg-surface rounded-lg p-3">
                            <p className="text-xs font-medium text-text-soft truncate mb-1">{g.cat}</p>
                            <p className="text-sm font-bold text-text tabular-nums mb-1.5">
                              {formatCurrency(g.total)}
                            </p>
                            <div className="w-full bg-white rounded-full h-1">
                              <div
                                className="h-1 rounded-full"
                                style={{
                                  width: `${barW}%`,
                                  backgroundColor: BAR_COLORS[gi % BAR_COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
