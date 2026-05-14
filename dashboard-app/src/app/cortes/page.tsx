'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, Ticket, Users, Receipt } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, percentChange } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const HEATMAP_COLORS = [
  { min: 0, max: 0, bg: 'bg-gray-100', text: 'text-gray-400' },
  { min: 1, max: 20000, bg: 'bg-red-100', text: 'text-red-700' },
  { min: 20001, max: 40000, bg: 'bg-orange-100', text: 'text-orange-700' },
  { min: 40001, max: 60000, bg: 'bg-yellow-100', text: 'text-yellow-700' },
  { min: 60001, max: 80000, bg: 'bg-lime-100', text: 'text-lime-700' },
  { min: 80001, max: Infinity, bg: 'bg-emerald-100', text: 'text-emerald-700' },
]

function getHeatColor(value: number) {
  const c = HEATMAP_COLORS.find(h => value >= h.min && value <= h.max) || HEATMAP_COLORS[0]
  return c
}

export default function CortesPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<30 | 60 | 90>(30)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRecentDays(90)
        setRecentData(data)
      } catch (err) {
        console.error('Error loading cortes data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const periodData = useMemo(() => recentData.slice(-period), [recentData, period])

  // Totals
  const totalVentas = periodData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const totalTickets = periodData.reduce((s, d) => s + (d.tickets_count || 0), 0)
  const totalPersonas = periodData.reduce((s, d) => s + (d.personas_restaurant || 0), 0)
  const totalEfectivo = periodData.reduce((s, d) => s + (d.efectivo || 0), 0)
  const totalTarjeta = periodData.reduce((s, d) => s + (d.tarjeta || 0), 0)
  const avgTicket = totalTickets > 0 ? Math.round(totalVentas / totalTickets) : 0

  // Previous period for comparison
  const prevPeriodData = useMemo(() => {
    const start = Math.max(0, recentData.length - period * 2)
    const end = Math.max(0, recentData.length - period)
    return recentData.slice(start, end)
  }, [recentData, period])

  const prevTotalVentas = prevPeriodData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const ventasChange = percentChange(totalVentas, prevTotalVentas)

  // Calendar heatmap data - group by week
  const calendarWeeks = useMemo(() => {
    if (periodData.length === 0) return []
    const weeks: { days: { fecha: string; ventas: number; dow: number }[] }[] = []
    let currentWeek: { fecha: string; ventas: number; dow: number }[] = []

    for (const d of periodData) {
      const date = new Date(d.fecha + 'T12:00:00')
      const dow = date.getDay()
      if (dow === 1 && currentWeek.length > 0) {
        weeks.push({ days: currentWeek })
        currentWeek = []
      }
      currentWeek.push({ fecha: d.fecha, ventas: d.ventas_dia || 0, dow })
    }
    if (currentWeek.length > 0) {
      weeks.push({ days: currentWeek })
    }
    return weeks
  }, [periodData])

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
        title="Cortes de Caja"
        subtitle={`Historico de cortes diarios - ultimos ${period} dias`}
      />

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {([30, 60, 90] as const).map(p => (
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
          label="Ventas acumuladas"
          value={formatCurrency(totalVentas)}
          delta={prevTotalVentas > 0 ? `${formatPercent(ventasChange)} vs periodo anterior` : undefined}
          deltaType={ventasChange >= 0 ? 'up' : 'down'}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Tickets totales"
          value={formatNumber(totalTickets)}
          subtitle={`${period} dias`}
          icon={Ticket}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Personas atendidas"
          value={formatNumber(totalPersonas)}
          subtitle={`${period} dias`}
          icon={Users}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Ticket promedio"
          value={formatCurrency(avgTicket)}
          subtitle="promedio del periodo"
          icon={Receipt}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Calendar Heatmap */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <h3 className="text-sm font-semibold text-text mb-1">
          Mapa de calor de ventas
        </h3>
        <p className="text-xs text-text-muted mb-4">Verde = ventas altas, Rojo = ventas bajas</p>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs text-text-muted">Menor</span>
          {HEATMAP_COLORS.slice(1).map((c, i) => (
            <div key={i} className={`w-5 h-5 rounded ${c.bg}`} />
          ))}
          <span className="text-xs text-text-muted">Mayor</span>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-2">
          {calendarWeeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.days.map(day => {
                const color = getHeatColor(day.ventas)
                const dateStr = new Date(day.fecha + 'T12:00:00').toLocaleDateString('es-MX', {
                  day: 'numeric',
                  month: 'short',
                })
                return (
                  <div
                    key={day.fecha}
                    className={`w-8 h-8 rounded flex items-center justify-center cursor-default ${color.bg}`}
                    title={`${dateStr}: ${formatCurrency(day.ventas)}`}
                  >
                    <span className={`text-[8px] font-bold ${color.text}`}>
                      {new Date(day.fecha + 'T12:00:00').getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Efectivo vs Tarjeta summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Total Efectivo</p>
          <p className="text-2xl font-bold text-text">{formatCurrency(totalEfectivo)}</p>
          <p className="text-xs text-text-muted mt-1">
            {totalVentas > 0 ? ((totalEfectivo / totalVentas) * 100).toFixed(1) : 0}% del total
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Total Tarjeta</p>
          <p className="text-2xl font-bold text-text">{formatCurrency(totalTarjeta)}</p>
          <p className="text-xs text-text-muted mt-1">
            {totalVentas > 0 ? ((totalTarjeta / totalVentas) * 100).toFixed(1) : 0}% del total
          </p>
        </div>
      </div>

      {/* Daily cortes table */}
      <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="text-sm font-semibold text-text">Cortes diarios</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {periodData.length} dias - Totales acumulados abajo
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Fecha</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Ventas</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Tickets</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Personas</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Ticket Prom.</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Efectivo</th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">Tarjeta</th>
              </tr>
            </thead>
            <tbody>
              {[...periodData].reverse().map((d, i) => {
                const prev = [...periodData].reverse()[i + 1]
                const change = prev ? percentChange(d.ventas_dia, prev.ventas_dia) : 0
                return (
                  <tr
                    key={d.fecha}
                    className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div>
                        <span className="text-sm font-medium text-text">
                          {new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        {prev && (
                          <span className={`ml-2 text-xs font-semibold ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-text">
                      {formatCurrency(d.ventas_dia)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatNumber(d.tickets_count)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatNumber(d.personas_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatCurrency(d.ticket_promedio_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatCurrency(d.efectivo)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatCurrency(d.tarjeta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface/80 border-t-2 border-border">
                <td className="py-3.5 px-4 text-sm font-bold text-text">TOTAL</td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-accent">
                  {formatCurrency(totalVentas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                  {formatNumber(totalTickets)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                  {formatNumber(totalPersonas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                  {formatCurrency(avgTicket)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                  {formatCurrency(totalEfectivo)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                  {formatCurrency(totalTarjeta)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}
