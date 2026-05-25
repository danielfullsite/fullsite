'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from 'recharts'
import {
  DollarSign,
  Ticket,
  Users,
  Trophy,
  ChevronUp,
  ChevronDown,
  Award,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  User,
  ChevronRight,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateMeseros, getWaiterCategories } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily, WaiterCategoryData } from '@/lib/types'

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
]

const RADAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

type Tab = 'ventas' | 'kpis' | 'detalle'
type SortKey = 'nombre' | 'total' | 'promedio' | 'dias' | 'pct'
type SortDir = 'asc' | 'desc'

const MEDAL_COLORS: Record<number, { bg: string; text: string; icon: string }> = {
  0: { bg: 'bg-amber-100', text: 'text-amber-400', icon: '1' },
  1: { bg: 'bg-[var(--surface-2)]', text: 'text-[var(--text-2)]', icon: '2' },
  2: { bg: 'bg-orange-500/15', text: 'text-orange-400', icon: '3' },
}

interface WaiterKpi {
  nombre: string
  totalVentas: number
  mesas: number
  personas: number
  hh: number
  pan: number
  postres: number
  bebida2: number
  dias: number
  ticketPromedio: number
  bebidasPorPersona: number
  alimentosPorPersona: number
  pctSegundaBebida: number
  grupos: { cat: string; total: number }[]
  platillos: { cat: string; total: number }[]
}

export default function MeserosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [waiterData, setWaiterData] = useState<{ fecha: string; data: WaiterCategoryData }[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<7 | 14 | 30>(7)
  const [tab, setTab] = useState<Tab>('ventas')
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedMesero, setSelectedMesero] = useState<string>('')

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
  const avgDaily = totalTicketDays > 0 ? Math.round(totalVentas / totalTicketDays) : 0
  const topMesero = meseros[0]
  const topMeseroMax = topMesero?.total || 1

  const chartData = meseros.slice(0, 10).map((m, i) => ({
    nombre: m.nombre.split(' ').slice(0, 2).join(' '),
    total: m.total,
    promedio: m.promedio,
    fill: COLORS[i % COLORS.length],
  }))

  // Sorted meseros for table
  const sortedMeseros = useMemo(() => {
    const arr = meseros.map(m => ({
      ...m,
      pct: totalVentas > 0 ? (m.total / totalVentas) * 100 : 0,
    }))
    return arr.sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'nombre') return mult * a.nombre.localeCompare(b.nombre)
      return mult * ((a[sortKey] as number) - (b[sortKey] as number))
    })
  }, [meseros, sortKey, sortDir, totalVentas])

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  // Aggregate waiter KPIs from wansoft_waiter_categories
  const waiterKpis: WaiterKpi[] = useMemo(() => {
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
      ticketSums: number
      ticketCount: number
      grupos: Record<string, number>
      platillos: Record<string, number>
    }> = {}

    for (const entry of waiterData) {
      const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data
      if (!d || typeof d !== 'object') continue
      for (const [nombre, info] of Object.entries(d)) {
        if (nombre.startsWith('__') || !nombre || nombre === 'MESERO EVENTO') continue
        const lowerName = nombre.toLowerCase()
        if (lowerName.includes('cajero') || lowerName.includes('market')) continue
        const w = info as Record<string, unknown>
        if (!map[nombre]) {
          map[nombre] = { totalVentas: 0, totalMesas: 0, totalPersonas: 0, hh: 0, pan: 0, postres: 0, bebida2: 0, dias: 0, ticketSums: 0, ticketCount: 0, grupos: {}, platillos: {} }
        }
        const kpis = w.KPIs as Record<string, number> | undefined
        if (kpis) {
          map[nombre].totalVentas += kpis.total_ventas || 0
          map[nombre].totalMesas += kpis.mesas || 0
          map[nombre].totalPersonas += kpis.personas || 0
          if (kpis.ticket_promedio) {
            map[nombre].ticketSums += kpis.ticket_promedio
            map[nombre].ticketCount += 1
          }
        }
        map[nombre].hh += (w['H&H'] as number) || 0
        map[nombre].pan += (w.Pan as number) || 0
        map[nombre].postres += (w.Postres as number) || 0
        map[nombre].bebida2 += (w['2da Bebida'] as number) || 0
        map[nombre].dias += 1

        const grupoData = w.__por_mesero_grupo as Record<string, number> | undefined
        if (grupoData) {
          for (const [cat, val] of Object.entries(grupoData)) {
            map[nombre].grupos[cat] = (map[nombre].grupos[cat] || 0) + (val || 0)
          }
        }
        const platilloData = w.__por_mesero_platillo as Record<string, number> | undefined
        if (platilloData) {
          for (const [cat, val] of Object.entries(platilloData)) {
            map[nombre].platillos[cat] = (map[nombre].platillos[cat] || 0) + (val || 0)
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
        ticketPromedio: d.ticketCount > 0 ? Math.round(d.ticketSums / d.ticketCount) : 0,
        bebidasPorPersona: d.totalPersonas > 0 ? d.hh / d.totalPersonas : 0,
        alimentosPorPersona: d.totalPersonas > 0 ? d.totalVentas / d.totalPersonas : 0,
        pctSegundaBebida: d.totalPersonas > 0 ? (d.bebida2 / d.totalPersonas) * 100 : 0,
        grupos: Object.entries(d.grupos)
          .map(([cat, total]) => ({ cat, total }))
          .sort((a, b) => b.total - a.total),
        platillos: Object.entries(d.platillos)
          .map(([cat, total]) => ({ cat, total }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.totalVentas - a.totalVentas)
  }, [waiterData])

  // Averages for KPI comparison
  const kpiAverages = useMemo(() => {
    if (waiterKpis.length === 0) return { bebidasPorPersona: 0, alimentosPorPersona: 0, ticketPromedio: 0, pctSegundaBebida: 0 }
    const n = waiterKpis.length
    return {
      bebidasPorPersona: waiterKpis.reduce((s, w) => s + w.bebidasPorPersona, 0) / n,
      alimentosPorPersona: waiterKpis.reduce((s, w) => s + w.alimentosPorPersona, 0) / n,
      ticketPromedio: waiterKpis.reduce((s, w) => s + w.ticketPromedio, 0) / n,
      pctSegundaBebida: waiterKpis.reduce((s, w) => s + w.pctSegundaBebida, 0) / n,
    }
  }, [waiterKpis])

  // Radar data for top 5 meseros
  const radarData = useMemo(() => {
    const top5 = waiterKpis.slice(0, 5)
    if (top5.length === 0) return []
    const maxBebidas = Math.max(...top5.map(w => w.bebidasPorPersona), 1)
    const maxAlimentos = Math.max(...top5.map(w => w.alimentosPorPersona), 1)
    const maxTicket = Math.max(...top5.map(w => w.ticketPromedio), 1)
    const maxBebida2 = Math.max(...top5.map(w => w.pctSegundaBebida), 1)

    const metrics = [
      { metric: 'Bebidas/persona', key: 'bebidasPorPersona', max: maxBebidas },
      { metric: 'Alimentos/persona', key: 'alimentosPorPersona', max: maxAlimentos },
      { metric: 'Ticket promedio', key: 'ticketPromedio', max: maxTicket },
      { metric: '% 2da Bebida', key: 'pctSegundaBebida', max: maxBebida2 },
    ]

    return metrics.map(m => {
      const point: Record<string, string | number> = { metric: m.metric }
      top5.forEach((w, i) => {
        const shortName = w.nombre.split(' ').slice(0, 2).join(' ')
        const raw = w[m.key as keyof WaiterKpi] as number
        point[shortName] = Math.round((raw / m.max) * 100)
      })
      return point
    })
  }, [waiterKpis])

  // Selected mesero detail
  const selectedWaiter = useMemo(() => {
    if (!selectedMesero) return null
    return waiterKpis.find(w => w.nombre === selectedMesero) || null
  }, [selectedMesero, waiterKpis])

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

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortKey !== field) return <ChevronDown size={12} className="text-[var(--text-3)]/40 ml-1" />
    return sortDir === 'desc'
      ? <ChevronDown size={12} className="text-blue-500 ml-1" />
      : <ChevronUp size={12} className="text-blue-500 ml-1" />
  }

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Meseros"
        subtitle={`Performance de meseros - últimos ${period} días`}
      />

      {/* Tabs — segmented control style */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-8">
        <div className="inline-flex bg-[var(--surface-2)] rounded-lg p-1 gap-0.5">
          {([
            { key: 'ventas' as Tab, label: 'Ventas', icon: BarChart3 },
            { key: 'kpis' as Tab, label: 'KPIs', icon: Target },
            { key: 'detalle' as Tab, label: 'Detalle', icon: User },
          ]).map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  tab === t.key
                    ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Period selector — segmented control */}
        {tab === 'ventas' && (
          <div className="inline-flex bg-[var(--surface-2)] rounded-lg p-1 gap-0.5">
            {([7, 14, 30] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  period === p
                    ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TAB: VENTAS */}
      {tab === 'ventas' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <KPICard
              label="Total ventas meseros"
              value={formatCurrency(totalVentas)}
              subtitle={`Últimos ${period} días`}
              icon={DollarSign}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Promedio diario"
              value={formatCurrency(avgDaily)}
              subtitle="por dia total"
              icon={Ticket}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Meseros activos"
              value={formatNumber(meseros.length)}
              subtitle={`en ${period} días`}
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

          {/* Horizontal bar chart — top 10 */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider">
                  Top 10 Meseros por Ventas
                </h3>
                <p className="text-xs text-[var(--text-3)] mt-1">Últimos {period} días</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 rounded-lg">
                <BarChart3 size={14} className="text-blue-500" />
                <span className="text-xs font-medium text-blue-500">Top 10</span>
              </div>
            </div>
            <div className="h-[300px] sm:h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <defs>
                    {COLORS.map((color, i) => (
                      <linearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={color} stopOpacity={0.85} />
                        <stop offset="100%" stopColor={color} stopOpacity={1} />
                      </linearGradient>
                    ))}
                  </defs>
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
                    tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                    width={140}
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
                    cursor={{ fill: 'rgba(59,130,246,0.04)' }}
                  />
                  <Bar dataKey="total" radius={[0, 8, 8, 0]} barSize={28}>
                    {chartData.map((_entry, index) => (
                      <Cell key={index} fill={`url(#barGrad${index})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ranking table */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--line-soft)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider">
                    Ranking Completo
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mt-1">{meseros.length} meseros activos en {period} días</p>
                </div>
                <span className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] px-3 py-1.5 rounded-full font-medium">
                  Click columna para ordenar
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--surface-2)]/80">
                    <th className="text-left text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider w-12">
                      #
                    </th>
                    <th
                      onClick={() => handleSort('nombre')}
                      className="text-left text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors"
                    >
                      <span className="inline-flex items-center">Mesero <SortIcon field="nombre" /></span>
                    </th>
                    <th className="text-left text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider w-44">
                      Progreso
                    </th>
                    <th
                      onClick={() => handleSort('total')}
                      className="text-right text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors"
                    >
                      <span className="inline-flex items-center justify-end">Ventas <SortIcon field="total" /></span>
                    </th>
                    <th
                      onClick={() => handleSort('promedio')}
                      className="text-right text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors"
                    >
                      <span className="inline-flex items-center justify-end">Prom. Diario <SortIcon field="promedio" /></span>
                    </th>
                    <th
                      onClick={() => handleSort('dias')}
                      className="text-right text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors"
                    >
                      <span className="inline-flex items-center justify-end">Días <SortIcon field="dias" /></span>
                    </th>
                    <th
                      onClick={() => handleSort('pct')}
                      className="text-right text-[11px] font-semibold text-[var(--text-2)] py-3 px-5 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors"
                    >
                      <span className="inline-flex items-center justify-end">% del Total <SortIcon field="pct" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMeseros.map((m, i) => {
                    const origIndex = meseros.findIndex(om => om.nombre === m.nombre)
                    const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                    const medal = MEDAL_COLORS[origIndex]
                    return (
                      <tr
                        key={m.nombre}
                        className={`border-b border-[var(--line-soft)]/80 hover:bg-blue-500/10/40 transition-colors duration-150 ${
                          i % 2 === 1 ? 'bg-[var(--surface-2)]/40' : ''
                        }`}
                      >
                        <td className="py-3.5 px-5">
                          {medal ? (
                            <div className={`w-7 h-7 rounded-full ${medal.bg} flex items-center justify-center`}>
                              <Award size={14} className={medal.text} />
                            </div>
                          ) : (
                            <span className="text-sm text-[var(--text-3)] tabular-nums font-medium pl-1.5">{origIndex + 1}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ backgroundColor: COLORS[origIndex % COLORS.length] }}
                            >
                              {m.nombre.charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-[var(--text-1)]">{m.nombre}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="w-full bg-[var(--surface-2)] rounded-full h-2 overflow-hidden">
                            <div
                              className="h-2 rounded-full animate-progress transition-all duration-500"
                              style={{
                                width: `${barWidth}%`,
                                background: `linear-gradient(90deg, ${COLORS[origIndex % COLORS.length]}cc, ${COLORS[origIndex % COLORS.length]})`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="py-3.5 px-5 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                          {formatCurrency(m.total)}
                        </td>
                        <td className="py-3.5 px-5 text-sm text-right tabular-nums text-[var(--text-2)]">
                          {formatCurrency(m.promedio)}
                        </td>
                        <td className="py-3.5 px-5 text-sm text-right tabular-nums text-[var(--text-2)]">
                          {m.dias}
                        </td>
                        <td className="py-3.5 px-5 text-sm text-right tabular-nums">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500">
                            {m.pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: KPIs */}
      {tab === 'kpis' && (
        <div className="space-y-6">
          {waiterKpis.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-16 shadow-sm text-center">
              <Target size={40} className="text-[var(--text-3)]/30 mx-auto mb-4" />
              <p className="text-[var(--text-3)] text-sm">Sin datos de KPIs de meseros disponibles</p>
            </div>
          ) : (
            <>
              {/* Radar chart — top 5 comparison */}
              {radarData.length > 0 && (
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider">
                        Comparativa Top 5 Meseros
                      </h3>
                      <p className="text-xs text-[var(--text-3)] mt-1">
                        Rendimiento relativo en métricas clave (normalizado a 100)
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 rounded-lg">
                      <Target size={14} className="text-purple-600" />
                      <span className="text-xs font-medium text-purple-600">Radar</span>
                    </div>
                  </div>
                  <div className="h-[280px] sm:h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid stroke="var(--line)" />
                        <PolarAngleAxis
                          dataKey="metric"
                          tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }}
                        />
                        <PolarRadiusAxis
                          angle={90}
                          domain={[0, 100]}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          tickCount={5}
                        />
                        {waiterKpis.slice(0, 5).map((w, i) => {
                          const shortName = w.nombre.split(' ').slice(0, 2).join(' ')
                          return (
                            <Radar
                              key={shortName}
                              name={shortName}
                              dataKey={shortName}
                              stroke={RADAR_COLORS[i]}
                              fill={RADAR_COLORS[i]}
                              fillOpacity={0.1}
                              strokeWidth={2}
                            />
                          )
                        })}
                        <Legend
                          wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--surface)',
                            border: '1px solid var(--line)',
                            borderRadius: '8px',
                            fontSize: '12px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            padding: '10px 14px',
                          }}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* KPI Cards grid */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider">
                    Métricas por Mesero
                  </h3>
                  <p className="text-xs text-[var(--text-3)]">
                    {waiterData.length} días analizados &middot; Verde = sobre el promedio
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {waiterKpis.map((w, i) => {
                    const metrics = [
                      {
                        label: 'Bebidas/persona',
                        value: w.bebidasPorPersona.toFixed(2),
                        avg: kpiAverages.bebidasPorPersona,
                        actual: w.bebidasPorPersona,
                        prefix: '',
                      },
                      {
                        label: 'Alimentos/persona',
                        value: formatCurrency(Math.round(w.alimentosPorPersona)),
                        avg: kpiAverages.alimentosPorPersona,
                        actual: w.alimentosPorPersona,
                        prefix: '',
                      },
                      {
                        label: 'Ticket promedio',
                        value: formatCurrency(w.ticketPromedio),
                        avg: kpiAverages.ticketPromedio,
                        actual: w.ticketPromedio,
                        prefix: '',
                      },
                      {
                        label: '2da Bebida',
                        value: `${w.pctSegundaBebida.toFixed(1)}%`,
                        avg: kpiAverages.pctSegundaBebida,
                        actual: w.pctSegundaBebida,
                        prefix: '',
                      },
                    ]
                    return (
                      <div
                        key={w.nombre}
                        className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
                      >
                        {/* Header with accent */}
                        <div className="px-5 py-4 border-b border-[var(--line-soft)] flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          >
                            {w.nombre.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-[var(--text-1)] truncate">{w.nombre}</h4>
                            <p className="text-xs text-[var(--text-3)]">
                              {formatCurrency(w.totalVentas)} &middot; {w.personas} personas &middot; {w.dias} días
                            </p>
                          </div>
                        </div>
                        {/* Metrics */}
                        <div className="grid grid-cols-2 gap-px bg-[var(--surface-2)]">
                          {metrics.map((m) => {
                            const isAbove = m.actual >= m.avg
                            return (
                              <div key={m.label} className="bg-[var(--surface)] px-4 py-3.5">
                                <p className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">{m.label}</p>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-lg font-bold text-[var(--text-1)] tabular-nums">{m.value}</span>
                                  {isAbove ? (
                                    <TrendingUp size={14} className="text-emerald-500" />
                                  ) : (
                                    <TrendingDown size={14} className="text-red-400" />
                                  )}
                                </div>
                                <p className={`text-[10px] font-medium mt-0.5 ${isAbove ? 'text-emerald-600' : 'text-red-400'}`}>
                                  {isAbove ? 'Sobre' : 'Bajo'} promedio
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: DETALLE */}
      {tab === 'detalle' && (
        <div className="space-y-6">
          {waiterKpis.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-16 shadow-sm text-center">
              <User size={40} className="text-[var(--text-3)]/30 mx-auto mb-4" />
              <p className="text-[var(--text-3)] text-sm">Sin datos de detalle por mesero disponibles</p>
            </div>
          ) : (
            <>
              {/* Mesero selector */}
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
                <label className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider block mb-3">
                  Seleccionar Mesero
                </label>
                <div className="flex flex-wrap gap-2">
                  {waiterKpis.map((w, i) => (
                    <button
                      key={w.nombre}
                      onClick={() => setSelectedMesero(w.nombre === selectedMesero ? '' : w.nombre)}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border ${
                        selectedMesero === w.nombre
                          ? 'border-blue-500 bg-blue-500/10 text-blue-500 shadow-sm'
                          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-blue-500/40 hover:text-[var(--text-1)]'
                      }`}
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      >
                        {w.nombre.charAt(0)}
                      </div>
                      {w.nombre.split(' ').slice(0, 2).join(' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected mesero detail */}
              {selectedWaiter && (
                <div className="space-y-6">
                  {/* KPIs vs average */}
                  <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-[var(--line-soft)] flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                        style={{ backgroundColor: COLORS[waiterKpis.findIndex(w => w.nombre === selectedMesero) % COLORS.length] }}
                      >
                        {selectedWaiter.nombre.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-[var(--text-1)]">{selectedWaiter.nombre}</h3>
                        <p className="text-xs text-[var(--text-3)]">
                          {formatCurrency(selectedWaiter.totalVentas)} total &middot; {selectedWaiter.personas} personas &middot; {selectedWaiter.mesas} mesas &middot; {selectedWaiter.dias} días
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--surface-2)]">
                      {[
                        {
                          label: 'Bebidas/persona',
                          val: selectedWaiter.bebidasPorPersona,
                          avg: kpiAverages.bebidasPorPersona,
                          fmt: (v: number) => v.toFixed(2),
                        },
                        {
                          label: 'Alimentos/persona',
                          val: selectedWaiter.alimentosPorPersona,
                          avg: kpiAverages.alimentosPorPersona,
                          fmt: (v: number) => formatCurrency(Math.round(v)),
                        },
                        {
                          label: 'Ticket promedio',
                          val: selectedWaiter.ticketPromedio,
                          avg: kpiAverages.ticketPromedio,
                          fmt: (v: number) => formatCurrency(v),
                        },
                        {
                          label: '2da Bebida',
                          val: selectedWaiter.pctSegundaBebida,
                          avg: kpiAverages.pctSegundaBebida,
                          fmt: (v: number) => `${v.toFixed(1)}%`,
                        },
                      ].map(kpi => {
                        const diff = kpi.val - kpi.avg
                        const isAbove = diff >= 0
                        const pctDiff = kpi.avg > 0 ? Math.abs((diff / kpi.avg) * 100).toFixed(0) : '0'
                        return (
                          <div key={kpi.label} className="bg-[var(--surface)] p-5">
                            <p className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-2">{kpi.label}</p>
                            <p className="text-2xl font-bold text-[var(--text-1)] tabular-nums mb-1">{kpi.fmt(kpi.val)}</p>
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
                                isAbove ? 'bg-emerald-500/100/10 text-emerald-400' : 'bg-red-500/10 text-red-500'
                              }`}>
                                {isAbove ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                {pctDiff}%
                              </span>
                              <span className="text-[10px] text-[var(--text-3)]">vs promedio ({kpi.fmt(kpi.avg)})</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Charts: Categories and Platillos side by side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top categories */}
                    {selectedWaiter.grupos.length > 0 && (
                      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
                        <h4 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider mb-1">
                          Top Categorías
                        </h4>
                        <p className="text-xs text-[var(--text-3)] mb-4">{selectedWaiter.grupos.length} categorías vendidas</p>
                        <div className="h-[250px] sm:h-[350px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={selectedWaiter.grupos.slice(0, 10).map((g, gi) => ({
                                nombre: g.cat.length > 20 ? g.cat.slice(0, 18) + '..' : g.cat,
                                total: g.total,
                                fill: COLORS[gi % COLORS.length],
                              }))}
                              layout="vertical"
                              margin={{ left: 5, right: 20 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                              <XAxis
                                type="number"
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                              />
                              <YAxis
                                type="category"
                                dataKey="nombre"
                                tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                width={120}
                              />
                              <Tooltip
                                formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
                                contentStyle={{
                                  background: 'var(--surface)',
                                  border: '1px solid var(--line)',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                  padding: '10px 14px',
                                }}
                              />
                              <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={22}>
                                {selectedWaiter.grupos.slice(0, 10).map((_g, gi) => (
                                  <Cell key={gi} fill={COLORS[gi % COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Top platillos */}
                    {selectedWaiter.platillos.length > 0 && (
                      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
                        <h4 className="text-sm font-semibold text-[var(--text-1)] uppercase tracking-wider mb-1">
                          Top Platillos
                        </h4>
                        <p className="text-xs text-[var(--text-3)] mb-4">{selectedWaiter.platillos.length} platillos vendidos</p>
                        <div className="h-[250px] sm:h-[350px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={selectedWaiter.platillos.slice(0, 10).map((p, pi) => ({
                                nombre: p.cat.length > 20 ? p.cat.slice(0, 18) + '..' : p.cat,
                                total: p.total,
                                fill: COLORS[pi % COLORS.length],
                              }))}
                              layout="vertical"
                              margin={{ left: 5, right: 20 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                              <XAxis
                                type="number"
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                              />
                              <YAxis
                                type="category"
                                dataKey="nombre"
                                tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                width={120}
                              />
                              <Tooltip
                                formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
                                contentStyle={{
                                  background: 'var(--surface)',
                                  border: '1px solid var(--line)',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                  padding: '10px 14px',
                                }}
                              />
                              <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={22}>
                                {selectedWaiter.platillos.slice(0, 10).map((_p, pi) => (
                                  <Cell key={pi} fill={COLORS[pi % COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Prompt to select */}
              {!selectedWaiter && (
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-16 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                    <ChevronRight size={28} className="text-blue-500/40" />
                  </div>
                  <p className="text-[var(--text-2)] text-sm font-medium">Selecciona un mesero arriba para ver su detalle</p>
                  <p className="text-[var(--text-3)] text-xs mt-1">Categorías, platillos, y comparativa con el promedio</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
