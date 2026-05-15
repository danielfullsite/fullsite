'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, Ticket, Users, Receipt, Banknote, CreditCard } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, percentChange } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const HEATMAP_COLORS = [
  { min: 0, max: 0, bg: 'bg-slate-100', text: 'text-slate-400', hex: '#e2e8f0' },
  { min: 1, max: 20000, bg: 'bg-red-100', text: 'text-red-700', hex: '#fecaca' },
  { min: 20001, max: 40000, bg: 'bg-orange-100', text: 'text-orange-700', hex: '#fed7aa' },
  { min: 40001, max: 60000, bg: 'bg-yellow-100', text: 'text-yellow-700', hex: '#fef08a' },
  { min: 60001, max: 80000, bg: 'bg-lime-100', text: 'text-lime-700', hex: '#d9f99d' },
  { min: 80001, max: Infinity, bg: 'bg-emerald-100', text: 'text-emerald-700', hex: '#a7f3d0' },
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
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">Cargando datos...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Cortes de Caja"
        subtitle={`Histórico de cortes diarios - últimos ${period} días`}
      />

      {/* Period selector */}
      <div className="mb-6">
        <div className="segmented-control">
          {([30, 60, 90] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={period === p ? 'active' : ''}
            >
              {p} días
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
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
          subtitle={`${period} días`}
          icon={Ticket}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Personas atendidas"
          value={formatNumber(totalPersonas)}
          subtitle={`${period} días`}
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Mapa de calor de ventas
        </h3>
        <p className="text-xs text-slate-400 mb-4">Verde = ventas altas, Rojo = ventas bajas</p>

        {/* Legend */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-slate-400">Menor</span>
          {HEATMAP_COLORS.slice(1).map((c, i) => (
            <div key={i} className={`w-5 h-5 rounded-md ${c.bg} border border-white shadow-sm`} />
          ))}
          <span className="text-xs text-slate-400">Mayor</span>
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
                    className={`w-9 h-9 rounded-md flex items-center justify-center cursor-default ${color.bg} border border-white/50 shadow-sm transition-transform hover:scale-110`}
                    title={`${dateStr}: ${formatCurrency(day.ventas)}`}
                  >
                    <span className={`text-[9px] font-bold ${color.text}`}>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center">
              <Banknote size={20} className="text-emerald-500" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Efectivo</p>
          </div>
          <p className="text-3xl font-bold text-slate-900">{formatCurrency(totalEfectivo)}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div
                className="h-2 rounded-full bg-emerald-500 animate-progress"
                style={{ width: `${totalVentas > 0 ? (totalEfectivo / totalVentas) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 font-medium tabular-nums">
              {totalVentas > 0 ? ((totalEfectivo / totalVentas) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
              <CreditCard size={20} className="text-blue-500" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Tarjeta</p>
          </div>
          <p className="text-3xl font-bold text-slate-900">{formatCurrency(totalTarjeta)}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div
                className="h-2 rounded-full bg-blue-500 animate-progress"
                style={{ width: `${totalVentas > 0 ? (totalTarjeta / totalVentas) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 font-medium tabular-nums">
              {totalVentas > 0 ? ((totalTarjeta / totalVentas) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>
      </div>

      {/* Daily cortes table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Cortes diarios</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {periodData.length} días - Totales acumulados abajo
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 bg-slate-50/80 backdrop-blur-sm">
                <th className="text-left text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Fecha</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Ventas</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Tickets</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Personas</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Ticket Prom.</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Efectivo</th>
                <th className="text-right text-xs font-semibold text-slate-500 py-3.5 px-4 uppercase tracking-wider">Tarjeta</th>
              </tr>
            </thead>
            <tbody>
              {[...periodData].reverse().map((d, i) => {
                const prev = [...periodData].reverse()[i + 1]
                const change = prev ? percentChange(d.ventas_dia, prev.ventas_dia) : 0
                return (
                  <tr
                    key={d.fecha}
                    className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        {prev && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
                      {formatCurrency(d.ventas_dia)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
                      {formatNumber(d.tickets_count)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
                      {formatNumber(d.personas_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
                      {formatCurrency(d.ticket_promedio_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
                      {formatCurrency(d.efectivo)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
                      {formatCurrency(d.tarjeta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50/80 border-t-2 border-slate-200">
                <td className="py-3.5 px-4 text-sm font-bold text-slate-900">TOTAL</td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-blue-600">
                  {formatCurrency(totalVentas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
                  {formatNumber(totalTickets)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
                  {formatNumber(totalPersonas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
                  {formatCurrency(avgTicket)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
                  {formatCurrency(totalEfectivo)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-slate-900">
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
