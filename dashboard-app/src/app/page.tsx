'use client'

import { useEffect, useState } from 'react'
import { DollarSign, Ticket, Users, Receipt } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, formatDate, percentChange } from '@/lib/format'
import type { WansoftDaily, GrupoEntry, PagoMetodoEntry } from '@/lib/types'

function safeArray<T>(val: unknown): T[] {
  if (!val) return []
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export default function DashboardPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [latestDay, setLatestDay] = useState<WansoftDaily | null>(null)
  const [prevDay, setPrevDay] = useState<WansoftDaily | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const recent = await getRecentDays(30)
        const latest = await getLatestDay()
        setRecentData(recent)
        setLatestDay(latest)
        if (recent.length >= 2) {
          const latestFecha = latest?.fecha
          const prevEntries = recent.filter(d => d.fecha !== latestFecha)
          if (prevEntries.length > 0) {
            setPrevDay(prevEntries[prevEntries.length - 1])
          } else {
            setPrevDay(recent[recent.length - 2])
          }
        }
      } catch (err) {
        console.error('Error loading dashboard data:', err)
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

  const ventasChange = latestDay && prevDay
    ? percentChange(latestDay.ventas_dia, prevDay.ventas_dia)
    : 0
  const ticketsChange = latestDay && prevDay
    ? percentChange(latestDay.tickets_count, prevDay.tickets_count)
    : 0
  const personasChange = latestDay && prevDay
    ? percentChange(latestDay.personas_restaurant, prevDay.personas_restaurant)
    : 0
  const ticketPromChange = latestDay && prevDay
    ? percentChange(
        latestDay.ticket_promedio_restaurant,
        prevDay.ticket_promedio_restaurant
      )
    : 0

  const topMeseros = latestDay
    ? aggregateMeseros([latestDay]).slice(0, 5)
    : []
  const topMeseroMax = topMeseros[0]?.total || 1

  const paymentMethods = safeArray<PagoMetodoEntry>(latestDay?.pago_metodos)
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total)
  const paymentMax = paymentMethods[0]?.total || 1

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Dashboard"
        subtitle={
          latestDay
            ? `Datos al ${formatDate(latestDay.fecha)}`
            : 'Cargando datos...'
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Ventas del dia"
          value={latestDay ? formatCurrency(latestDay.ventas_dia) : '-'}
          delta={latestDay ? `${formatPercent(ventasChange)} vs dia anterior` : undefined}
          deltaType={ventasChange >= 0 ? 'up' : 'down'}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Tickets"
          value={latestDay ? formatNumber(latestDay.tickets_count) : '-'}
          delta={latestDay ? `${formatPercent(ticketsChange)} vs dia anterior` : undefined}
          deltaType={ticketsChange >= 0 ? 'up' : 'down'}
          icon={Ticket}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Personas"
          value={latestDay ? formatNumber(latestDay.personas_restaurant) : '-'}
          delta={latestDay ? `${formatPercent(personasChange)} vs dia anterior` : undefined}
          deltaType={personasChange >= 0 ? 'up' : 'down'}
          icon={Users}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Ticket promedio"
          value={
            latestDay
              ? formatCurrency(latestDay.ticket_promedio_restaurant)
              : '-'
          }
          delta={
            latestDay
              ? `${formatPercent(ticketPromChange)} vs dia anterior`
              : undefined
          }
          deltaType={ticketPromChange >= 0 ? 'up' : 'down'}
          icon={Receipt}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <RevenueChart
            data={recentData.map((d) => ({
              fecha: d.fecha,
              ventas_dia: d.ventas_dia,
            }))}
            title="Ventas ultimos 30 dias"
          />
        </div>
        <div>
          <RevenueDistributionChart
            data={safeArray<GrupoEntry>(latestDay?.ventas_por_grupo)}
            title="Distribucion por categoria"
          />
        </div>
      </div>

      {/* Top meseros + Payment methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Top meseros del dia
          </h3>
          <p className="text-xs text-text-muted mb-4">Ranking por ventas</p>
          {topMeseros.length === 0 ? (
            <p className="text-text-muted text-sm">Sin datos de meseros</p>
          ) : (
            <div className="space-y-4">
              {topMeseros.map((m, i) => {
                const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                const colors = [
                  { bg: 'bg-accent/10', text: 'text-accent', bar: '#3b82f6' },
                  { bg: 'bg-success/10', text: 'text-success', bar: '#10b981' },
                  { bg: 'bg-warning/10', text: 'text-warning', bar: '#f59e0b' },
                  { bg: 'bg-danger/10', text: 'text-danger', bar: '#ef4444' },
                  { bg: 'bg-text-muted/10', text: 'text-text-soft', bar: '#94a3b8' },
                ]
                const color = colors[i] || colors[4]
                return (
                  <div key={m.nombre}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${color.bg} ${color.text}`}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text truncate">
                          {m.nombre}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-text tabular-nums">
                        {formatCurrency(m.total)}
                      </p>
                    </div>
                    <div className="ml-10 w-auto bg-surface rounded-full h-2">
                      <div
                        className="h-2 rounded-full animate-progress"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: color.bar,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Metodos de pago
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {latestDay ? formatCurrency(latestDay.ventas_dia) : '-'} total
          </p>
          {paymentMethods.length > 0 ? (
            <div className="space-y-4">
              {paymentMethods.map((p, i) => {
                const total = latestDay?.ventas_dia || 1
                const pct = ((p.total / total) * 100).toFixed(0)
                const barWidth = paymentMax > 0 ? ((p.total / paymentMax) * 100) : 0
                const barColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4']
                return (
                  <div key={p.nombre}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: barColors[i % barColors.length] }}
                        />
                        <span className="text-sm font-medium text-text">
                          {p.nombre}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-text tabular-nums">
                        {formatCurrency(p.total)}{' '}
                        <span className="text-text-muted text-xs font-normal">
                          ({pct}%)
                        </span>
                      </span>
                    </div>
                    <div className="w-full bg-surface rounded-full h-2">
                      <div
                        className="h-2 rounded-full animate-progress"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: barColors[i % barColors.length],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <p className="text-text-muted text-sm">Sin datos de pagos para este dia</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
