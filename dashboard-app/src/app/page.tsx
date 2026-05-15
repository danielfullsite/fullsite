'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { DollarSign, Ticket, Users, Receipt, Sparkles, TrendingDown, TrendingUp, Star, ShoppingBag, ArrowRight, ArrowUpRight, CreditCard, Award, FileBarChart, ClipboardList } from 'lucide-react'
import KPICard from '@/components/KPICard'
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

/** Find the most recent day in recentData that has non-empty data for a given jsonb field */
function findRecentDataForField<T>(
  recentData: WansoftDaily[],
  fieldName: 'ventas_por_grupo' | 'pago_metodos',
): T[] {
  // Walk backwards (most recent first)
  for (let i = recentData.length - 1; i >= 0; i--) {
    const arr = safeArray<T>(recentData[i][fieldName])
    const filtered = (arr as Array<{ total?: number }>).filter(item => (item.total || 0) > 0)
    if (filtered.length > 0) return filtered as T[]
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
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">Cargando datos...</p>
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

  // Use fallback: if latestDay has no data, search recent days
  const gruposData = safeArray<GrupoEntry>(latestDay?.ventas_por_grupo).filter(g => g.total > 0).length > 0
    ? safeArray<GrupoEntry>(latestDay?.ventas_por_grupo)
    : findRecentDataForField<GrupoEntry>(recentData, 'ventas_por_grupo')

  const paymentMethods = (() => {
    const latestPayments = safeArray<PagoMetodoEntry>(latestDay?.pago_metodos)
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total)
    if (latestPayments.length > 0) return latestPayments
    return findRecentDataForField<PagoMetodoEntry>(recentData, 'pago_metodos')
      .sort((a, b) => (b as PagoMetodoEntry).total - (a as PagoMetodoEntry).total)
  })()
  const paymentMax = paymentMethods[0]?.total || 1

  return (
    <>
      {/* Hero section */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-widest mb-1.5">
          AMALAY Coffee & Market
        </p>
        <div className="flex items-baseline gap-4 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Dashboard
          </h1>
          {latestDay && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">
                {formatDate(latestDay.fecha)}
              </span>
              <span className="text-xs text-slate-300">|</span>
              <span className="text-xs text-slate-400">Excl. delivery y Market</span>
            </div>
          )}
        </div>

        {/* Large revenue hero — centerpiece */}
        {latestDay && (
          <div className="mt-5 relative">
            <div className="flex items-end gap-4">
              <span className="text-5xl sm:text-6xl font-extrabold gradient-text hero-revenue">
                {formatCurrency(latestDay.ventas_dia)}
              </span>
              <div className="flex flex-col gap-1 mb-2">
                <span className={`inline-flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full ${ventasChange >= 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                  {ventasChange >= 0 ? <ArrowUpRight size={14} /> : <TrendingDown size={14} />}
                  {formatPercent(ventasChange)}
                </span>
                <span className="text-xs text-slate-400">vs dia anterior</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
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
          subtitle="(restaurante)"
          icon={Receipt}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* AI Insights — premium gradient card */}
      {latestDay && recentData.length > 1 && (() => {
        const insights: { text: string; color: 'blue' | 'green' | 'amber'; icon: React.ReactNode }[] = []

        const latestMeseros = safeArray<{ nombre: string; total: number }>(latestDay.meseros)
          .filter(m => m.nombre !== 'MESERO EVENTO')
          .sort((a, b) => b.total - a.total)
        if (latestMeseros.length > 0) {
          const topMesero = latestMeseros[0]
          const last7 = recentData.filter(d => d.fecha !== latestDay.fecha).slice(-7)
          if (last7.length > 0) {
            const meseroTotals = last7.map(d => {
              const ms = safeArray<{ nombre: string; total: number }>(d.meseros)
              const found = ms.find(m => m.nombre === topMesero.nombre)
              return found?.total || 0
            }).filter(t => t > 0)
            if (meseroTotals.length > 0) {
              const avg = meseroTotals.reduce((s, v) => s + v, 0) / meseroTotals.length
              const pct = ((topMesero.total - avg) / avg) * 100
              const sign = pct >= 0 ? '+' : ''
              insights.push({
                text: `${topMesero.nombre.split(' ')[0]} lleva ${sign}${pct.toFixed(0)}% vs promedio 7 dias`,
                color: pct >= 0 ? 'green' : 'amber',
                icon: pct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />,
              })
            }
          }
        }

        const dowMap: Record<string, { total: number; count: number }> = {}
        const dowNames = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
        for (const d of recentData) {
          const date = new Date(d.fecha + 'T12:00:00')
          const name = dowNames[date.getDay()]
          if (!dowMap[name]) dowMap[name] = { total: 0, count: 0 }
          dowMap[name].total += d.ventas_dia || 0
          dowMap[name].count += 1
        }
        const bestDow = Object.entries(dowMap)
          .map(([name, v]) => ({ name, avg: v.count > 0 ? v.total / v.count : 0 }))
          .sort((a, b) => b.avg - a.avg)[0]
        if (bestDow) {
          insights.push({
            text: `${bestDow.name} es tu mejor dia: ${formatCurrency(Math.round(bestDow.avg))} promedio`,
            color: 'blue',
            icon: <Star size={14} />,
          })
        }

        const grupos = safeArray<GrupoEntry>(latestDay.ventas_por_grupo)
          .filter(g => g.total > 0)
          .sort((a, b) => b.total - a.total)
        if (grupos.length > 0) {
          insights.push({
            text: `${grupos[0].nombre} es la categoria #1 hoy`,
            color: 'blue',
            icon: <ShoppingBag size={14} />,
          })
        }

        const recentTickets = recentData.filter(d => d.fecha !== latestDay.fecha && d.ticket_promedio_restaurant > 0)
        if (recentTickets.length > 0) {
          const avgTicket = recentTickets.reduce((s, d) => s + d.ticket_promedio_restaurant, 0) / recentTickets.length
          const pct = ((latestDay.ticket_promedio_restaurant - avgTicket) / avgTicket) * 100
          const sign = pct >= 0 ? '+' : ''
          insights.push({
            text: `Ticket promedio ${sign}${pct.toFixed(0)}% vs promedio reciente`,
            color: pct >= 0 ? 'green' : 'amber',
            icon: pct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />,
          })
        }

        const colorClasses = {
          blue: 'bg-white/70 text-blue-700 border border-blue-200/50 shadow-sm',
          green: 'bg-white/70 text-emerald-700 border border-emerald-200/50 shadow-sm',
          amber: 'bg-white/70 text-amber-700 border border-amber-200/50 shadow-sm',
        }

        return (
          <div className="mb-8 insights-gradient rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-7 h-7 rounded-lg bg-blue-100/80 flex items-center justify-center">
                <Sparkles size={14} className="text-blue-600" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">AI Insights</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {insights.map((insight, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm ${colorClasses[insight.color]}`}
                >
                  {insight.icon}
                  {insight.text}
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Quick actions — premium cards with icons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { href: '/ventas', label: 'Ver ventas', icon: DollarSign, color: 'bg-blue-50 text-blue-700 border-blue-100', iconBg: 'bg-blue-100 text-blue-600' },
          { href: '/meseros', label: 'Ver meseros', icon: Award, color: 'bg-emerald-50 text-emerald-700 border-emerald-100', iconBg: 'bg-emerald-100 text-emerald-600' },
          { href: '/cortes', label: 'Ver cortes', icon: ClipboardList, color: 'bg-amber-50 text-amber-700 border-amber-100', iconBg: 'bg-amber-100 text-amber-600' },
          { href: '/reportes', label: 'Generar reporte', icon: FileBarChart, color: 'bg-purple-50 text-purple-700 border-purple-100', iconBg: 'bg-purple-100 text-purple-600' },
        ].map(action => {
          const ActionIcon = action.icon
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`quick-action-card flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium border transition-all ${action.color}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${action.iconBg}`}>
                <ActionIcon size={15} />
              </div>
              <span className="flex-1">{action.label}</span>
              <ArrowRight size={14} className="opacity-40" />
            </Link>
          )
        })}
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
            data={gruposData}
            title="Distribucion por categoria"
          />
        </div>
      </div>

      {/* Top meseros + Payment methods — premium cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="premium-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Award size={14} className="text-emerald-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              Top meseros del dia
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-5 ml-9">Ranking por ventas</p>
          {topMeseros.length === 0 ? (
            <p className="text-slate-400 text-sm">Sin datos de meseros</p>
          ) : (
            <div className="space-y-4">
              {topMeseros.map((m, i) => {
                const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                const colors = [
                  { bg: 'bg-blue-100/80', text: 'text-blue-600', bar: '#3b82f6' },
                  { bg: 'bg-emerald-100/80', text: 'text-emerald-600', bar: '#10b981' },
                  { bg: 'bg-amber-100/80', text: 'text-amber-600', bar: '#f59e0b' },
                  { bg: 'bg-red-100/80', text: 'text-red-500', bar: '#ef4444' },
                  { bg: 'bg-slate-100', text: 'text-slate-500', bar: '#94a3b8' },
                ]
                const color = colors[i] || colors[4]
                return (
                  <div key={m.nombre}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${color.bg} ${color.text}`}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {m.nombre}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(m.total)}
                      </p>
                    </div>
                    <div className="ml-11 w-auto bg-slate-100 rounded-full h-2 overflow-hidden">
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

        <div className="premium-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
              <CreditCard size={14} className="text-violet-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              Metodos de pago
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-5 ml-9">
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
                        <span className="text-sm font-medium text-slate-700">
                          {p.nombre}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(p.total)}{' '}
                        <span className="text-slate-400 text-xs font-normal">
                          ({pct}%)
                        </span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
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
              <p className="text-slate-400 text-sm">Sin datos de pagos para este dia</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
