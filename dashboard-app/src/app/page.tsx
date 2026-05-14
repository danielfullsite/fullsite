'use client'

import { useEffect, useState } from 'react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, formatDate, percentChange } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

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
          setPrevDay(recent[recent.length - 2])
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
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-soft text-sm">Cargando datos...</p>
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
        />
        <KPICard
          label="Tickets"
          value={latestDay ? formatNumber(latestDay.tickets_count) : '-'}
          delta={latestDay ? `${formatPercent(ticketsChange)} vs dia anterior` : undefined}
          deltaType={ticketsChange >= 0 ? 'up' : 'down'}
        />
        <KPICard
          label="Personas"
          value={latestDay ? formatNumber(latestDay.personas_restaurant) : '-'}
          delta={latestDay ? `${formatPercent(personasChange)} vs dia anterior` : undefined}
          deltaType={personasChange >= 0 ? 'up' : 'down'}
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
            data={
              latestDay?.ventas_por_grupo
                ? Array.isArray(latestDay.ventas_por_grupo)
                  ? latestDay.ventas_por_grupo
                  : []
                : []
            }
            title="Distribucion por categoria"
          />
        </div>
      </div>

      {/* Top meseros + Payment methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-4">
            Top meseros del dia
          </h3>
          {topMeseros.length === 0 ? (
            <p className="text-text-muted text-sm">Sin datos de meseros</p>
          ) : (
            <div className="space-y-3">
              {topMeseros.map((m, i) => (
                <div key={m.nombre} className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                      i === 0
                        ? 'bg-accent-light text-accent'
                        : 'bg-surface text-text-soft'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {m.nombre}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-text tabular-nums">
                    {formatCurrency(m.total)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-4">
            Metodos de pago
          </h3>
          {latestDay?.pago_metodos ? (
            <div className="space-y-3">
              {(Array.isArray(latestDay.pago_metodos)
                ? latestDay.pago_metodos
                : []
              )
                .filter((p) => p.total > 0)
                .sort((a, b) => b.total - a.total)
                .map((p) => {
                  const total = latestDay.ventas_dia || 1
                  const pct = ((p.total / total) * 100).toFixed(0)
                  return (
                    <div key={p.nombre}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-text-soft">
                          {p.nombre}
                        </span>
                        <span className="text-sm font-medium text-text tabular-nums">
                          {formatCurrency(p.total)}{' '}
                          <span className="text-text-muted text-xs">
                            ({pct}%)
                          </span>
                        </span>
                      </div>
                      <div className="w-full bg-surface rounded-full h-1.5">
                        <div
                          className="bg-accent rounded-full h-1.5 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <p className="text-text-muted text-sm">Sin datos</p>
          )}
        </div>
      </div>
    </>
  )
}
