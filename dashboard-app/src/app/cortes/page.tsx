'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, Ticket, Users, Receipt, Banknote, CreditCard, Vault, ArrowDownCircle, Building2 } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, getWansoftData } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, percentChange } from '@/lib/format'
import type { WansoftDaily, PagoMetodoEntry } from '@/lib/types'

function extractPayment(d: WansoftDaily): { efectivo: number; tarjeta: number; transferencia: number } {
  // If efectivo/tarjeta fields have data, use them
  if ((d.efectivo || 0) > 0 || (d.tarjeta || 0) > 0) {
    return { efectivo: d.efectivo || 0, tarjeta: d.tarjeta || 0, transferencia: 0 }
  }
  // Otherwise extract from pago_metodos JSONB
  const metodos = Array.isArray(d.pago_metodos) ? d.pago_metodos : []
  let efectivo = 0, tarjeta = 0, transferencia = 0
  for (const m of metodos) {
    const name = (m.nombre || '').toLowerCase()
    if (name.includes('efectivo')) efectivo += m.total || 0
    else if (name.includes('tarjeta') || name.includes('crédito') || name.includes('débito')) tarjeta += m.total || 0
    else if (name.includes('transferencia')) transferencia += m.total || 0
  }
  return { efectivo, tarjeta, transferencia }
}

const HEATMAP_COLORS = [
  { min: 0, max: 0, bg: 'bg-[var(--surface-2)]', text: 'text-[var(--text-3)]', hex: '#e2e8f0' },
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
  const [cashClosing, setCashClosing] = useState<{ nombre: string; total: number }[]>([])
  const [withdrawals, setWithdrawals] = useState<{ nombre: string; total: number }[]>([])
  const [deposits, setDeposits] = useState<{ nombre: string; total: number }[]>([])
  const [cashClosingFecha, setCashClosingFecha] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<30 | 60 | 90>(30)

  useEffect(() => {
    async function load() {
      try {
        const [data, cashClosingRes, withdrawalsRes, depositsRes] = await Promise.all([
          getRecentDays(90),
          getWansoftData('cash_closing'),
          getWansoftData('cash_withdrawals'),
          getWansoftData('bank_deposits'),
        ])
        setRecentData(data)
        if (cashClosingRes) {
          setCashClosingFecha(cashClosingRes.fecha)
          const items = Array.isArray(cashClosingRes.data) ? cashClosingRes.data as { nombre: string; total: number }[] : []
          setCashClosing(items)
        }
        if (withdrawalsRes) {
          const items = Array.isArray(withdrawalsRes.data) ? withdrawalsRes.data as { nombre: string; total: number }[] : []
          setWithdrawals(items)
        }
        if (depositsRes) {
          const items = Array.isArray(depositsRes.data) ? depositsRes.data as { nombre: string; total: number }[] : []
          setDeposits(items)
        }
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
  const totalEfectivo = periodData.reduce((s, d) => s + extractPayment(d).efectivo, 0)
  const totalTarjeta = periodData.reduce((s, d) => s + extractPayment(d).tarjeta, 0)
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
          <p className="text-[var(--text-2)] text-sm font-medium">Cargando datos...</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
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
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
          Mapa de calor de ventas
        </h3>
        <p className="text-xs text-[var(--text-3)] mb-4">Verde = ventas altas, Rojo = ventas bajas</p>

        {/* Legend */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-[var(--text-3)]">Menor</span>
          {HEATMAP_COLORS.slice(1).map((c, i) => (
            <div key={i} className={`w-5 h-5 rounded-md ${c.bg} border border-white shadow-sm`} />
          ))}
          <span className="text-xs text-[var(--text-3)]">Mayor</span>
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
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center">
              <Banknote size={20} className="text-emerald-500" />
            </div>
            <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Total Efectivo</p>
          </div>
          <p className="text-3xl font-bold text-[var(--text-1)]">{formatCurrency(totalEfectivo)}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-[var(--surface-2)] rounded-full h-2">
              <div
                className="h-2 rounded-full bg-emerald-500 animate-progress"
                style={{ width: `${totalVentas > 0 ? (totalEfectivo / totalVentas) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-[var(--text-2)] font-medium tabular-nums">
              {totalVentas > 0 ? ((totalEfectivo / totalVentas) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
              <CreditCard size={20} className="text-blue-500" />
            </div>
            <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Total Tarjeta</p>
          </div>
          <p className="text-3xl font-bold text-[var(--text-1)]">{formatCurrency(totalTarjeta)}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 bg-[var(--surface-2)] rounded-full h-2">
              <div
                className="h-2 rounded-full bg-blue-500 animate-progress"
                style={{ width: `${totalVentas > 0 ? (totalTarjeta / totalVentas) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-[var(--text-2)] font-medium tabular-nums">
              {totalVentas > 0 ? ((totalTarjeta / totalVentas) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>
      </div>

      {/* Daily cortes table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="p-6 border-b border-[var(--line)]">
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Cortes diarios</h3>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {periodData.length} días - Totales acumulados abajo
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/80 backdrop-blur-sm">
                <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Fecha</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Ventas</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Tickets</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Personas</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Ticket Prom.</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Efectivo</th>
                <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Tarjeta</th>
              </tr>
            </thead>
            <tbody>
              {[...periodData].reverse().map((d, i) => {
                const prev = [...periodData].reverse()[i + 1]
                const change = prev ? percentChange(d.ventas_dia, prev.ventas_dia) : 0
                return (
                  <tr
                    key={d.fecha}
                    className="border-b border-[var(--line-soft)] hover:bg-blue-50/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-1)]">
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
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                      {formatCurrency(d.ventas_dia)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
                      {formatNumber(d.tickets_count)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
                      {formatNumber(d.personas_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
                      {formatCurrency(d.ticket_promedio_restaurant)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
                      {formatCurrency(extractPayment(d).efectivo)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
                      {formatCurrency(extractPayment(d).tarjeta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--surface-2)]/80 border-t-2 border-[var(--line)]">
                <td className="py-3.5 px-4 text-sm font-bold text-[var(--text-1)]">TOTAL</td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-blue-600">
                  {formatCurrency(totalVentas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                  {formatNumber(totalTickets)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                  {formatNumber(totalPersonas)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                  {formatCurrency(avgTicket)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                  {formatCurrency(totalEfectivo)}
                </td>
                <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                  {formatCurrency(totalTarjeta)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Detalle de Corte de Caja */}
      {cashClosing.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow mt-6">
          <div className="p-6 border-b border-[var(--line)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-50 rounded-full flex items-center justify-center">
                <Vault size={20} className="text-violet-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-1)]">Detalle de Corte de Caja</h3>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  Último corte: {cashClosingFecha ? new Date(cashClosingFecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                </p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-striped">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/80 backdrop-blur-sm">
                  <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Concepto</th>
                  <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3.5 px-4 uppercase tracking-wider">Monto</th>
                </tr>
              </thead>
              <tbody>
                {cashClosing.map((item, i) => (
                  <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-blue-50/30 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-[var(--text-1)]">{item.nombre}</td>
                    <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">
                      {formatCurrency(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--surface-2)]/80 border-t-2 border-[var(--line)]">
                  <td className="py-3.5 px-4 text-sm font-bold text-[var(--text-1)]">TOTAL</td>
                  <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-blue-600">
                    {formatCurrency(cashClosing.reduce((s, item) => s + (item.total || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Retiros y Depósitos */}
      {(withdrawals.length > 0 || deposits.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          {/* Retiros */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="p-6 border-b border-[var(--line)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center">
                  <ArrowDownCircle size={20} className="text-red-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-1)]">Retiros de Caja</h3>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">{withdrawals.length} movimiento{withdrawals.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
            {withdrawals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full table-striped">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/80">
                      <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Concepto</th>
                      <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((item, i) => (
                      <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-red-50/30 transition-colors">
                        <td className="py-3 px-4 text-sm text-[var(--text-1)]">{item.nombre}</td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-red-600">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--surface-2)]/80 border-t-2 border-[var(--line)]">
                      <td className="py-3 px-4 text-sm font-bold text-[var(--text-1)]">TOTAL</td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-red-600">
                        {formatCurrency(withdrawals.reduce((s, item) => s + (item.total || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[var(--text-3)]">Sin retiros registrados</div>
            )}
          </div>

          {/* Depósitos */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="p-6 border-b border-[var(--line)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                  <Building2 size={20} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-1)]">Depositos Bancarios</h3>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">{deposits.length} movimiento{deposits.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
            {deposits.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full table-striped">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/80">
                      <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Concepto</th>
                      <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((item, i) => (
                      <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-blue-50/30 transition-colors">
                        <td className="py-3 px-4 text-sm text-[var(--text-1)]">{item.nombre}</td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-blue-600">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--surface-2)]/80 border-t-2 border-[var(--line)]">
                      <td className="py-3 px-4 text-sm font-bold text-[var(--text-1)]">TOTAL</td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums font-bold text-blue-600">
                        {formatCurrency(deposits.reduce((s, item) => s + (item.total || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[var(--text-3)]">Sin depositos registrados</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
