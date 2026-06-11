'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, Calendar,
  Target, RefreshCw, Users, DollarSign, Award, Utensils, CreditCard,
} from 'lucide-react'
import { getRecentDays, aggregateMeseros, aggregatePayments } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface Insight {
  type: 'daily' | 'weekly' | 'alert' | 'tip'
  icon: React.ElementType
  iconBg: string
  iconColor: string
  title: string
  body: string
  metric: string
  metricColor: string
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

function generateInsights(data: WansoftDaily[]): { insights: Insight[]; summary: { avgVentas: number; avgTicket: number; totalVentas: number; days: number } | null } {
  if (data.length < 3) return { insights: [], summary: null }

  const insights: Insight[] = []

  // Basic aggregates
  const totalVentas = data.reduce((s, d) => s + d.ventas_dia, 0)
  const avgVentas = totalVentas / data.length
  const totalTickets = data.reduce((s, d) => s + d.tickets_count, 0)
  const avgTicket = totalTickets > 0 ? totalVentas / totalTickets : 0
  const totalPropinas = data.reduce((s, d) => s + d.propinas_total, 0)

  // --- Week-over-week trend ---
  const sorted = [...data].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const lastWeek = sorted.slice(-7)
  const prevWeek = sorted.slice(-14, -7)
  if (lastWeek.length >= 5 && prevWeek.length >= 5) {
    const lastTotal = lastWeek.reduce((s, d) => s + d.ventas_dia, 0)
    const prevTotal = prevWeek.reduce((s, d) => s + d.ventas_dia, 0)
    if (prevTotal > 0) {
      const pct = ((lastTotal - prevTotal) / prevTotal) * 100
      const isUp = pct >= 0
      insights.push({
        type: isUp ? 'weekly' : 'alert',
        icon: isUp ? TrendingUp : TrendingDown,
        iconBg: isUp ? 'bg-emerald-500/15' : 'bg-red-500/15',
        iconColor: isUp ? 'text-emerald-400' : 'text-red-400',
        title: isUp
          ? `Ventas subieron ${Math.abs(pct).toFixed(1)}% vs semana pasada`
          : `Ventas bajaron ${Math.abs(pct).toFixed(1)}% vs semana pasada`,
        body: isUp
          ? `Esta semana: ${formatCurrency(lastTotal)} vs ${formatCurrency(prevTotal)} la semana anterior. Buen ritmo.`
          : `Esta semana: ${formatCurrency(lastTotal)} vs ${formatCurrency(prevTotal)} la semana anterior. Revisa que paso.`,
        metric: `${isUp ? '+' : ''}${pct.toFixed(1)}%`,
        metricColor: isUp ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400',
      })
    }
  }

  // --- Best and worst day of the week ---
  const byDow: Record<number, { total: number; count: number }> = {}
  for (const d of data) {
    const dow = new Date(d.fecha + 'T12:00:00').getDay()
    if (!byDow[dow]) byDow[dow] = { total: 0, count: 0 }
    byDow[dow].total += d.ventas_dia
    byDow[dow].count++
  }
  const dowEntries = Object.entries(byDow)
    .map(([k, v]) => ({ dow: Number(k), avg: v.total / v.count }))
    .sort((a, b) => b.avg - a.avg)

  if (dowEntries.length >= 3) {
    const best = dowEntries[0]
    const worst = dowEntries[dowEntries.length - 1]
    const bestName = DAY_NAMES[best.dow].charAt(0).toUpperCase() + DAY_NAMES[best.dow].slice(1)
    const worstName = DAY_NAMES[worst.dow].charAt(0).toUpperCase() + DAY_NAMES[worst.dow].slice(1)

    insights.push({
      type: 'tip',
      icon: Calendar,
      iconBg: 'bg-blue-500/15',
      iconColor: 'text-blue-400',
      title: `${bestName} es tu mejor dia — ${formatCurrency(best.avg)} promedio`,
      body: `${worstName} es el mas debil con ${formatCurrency(worst.avg)} promedio. Diferencia de ${formatCurrency(best.avg - worst.avg)} entre ambos.`,
      metric: formatCurrency(best.avg),
      metricColor: 'bg-blue-500/20 text-blue-400',
    })
  }

  // --- Top mesero ---
  const meseros = aggregateMeseros(data)
  if (meseros.length >= 2) {
    const top = meseros[0]
    const pctOfTotal = totalVentas > 0 ? ((top.total / totalVentas) * 100).toFixed(0) : '0'
    insights.push({
      type: 'daily',
      icon: Award,
      iconBg: 'bg-violet-500/15',
      iconColor: 'text-violet-400',
      title: `${top.nombre} genera ${pctOfTotal}% de las ventas`,
      body: `Total: ${formatCurrency(top.total)} en ${top.dias} dias. Promedio diario: ${formatCurrency(top.promedio)}. Segundo lugar: ${meseros[1].nombre} con ${formatCurrency(meseros[1].total)}.`,
      metric: `${pctOfTotal}%`,
      metricColor: 'bg-violet-500/20 text-violet-400',
    })
  }

  // --- Ticket promedio trend ---
  if (avgTicket > 0) {
    const lastWeekTickets = lastWeek.reduce((s, d) => s + d.tickets_count, 0)
    const lastWeekVentas = lastWeek.reduce((s, d) => s + d.ventas_dia, 0)
    const lastWeekTP = lastWeekTickets > 0 ? lastWeekVentas / lastWeekTickets : 0
    insights.push({
      type: 'daily',
      icon: Utensils,
      iconBg: 'bg-amber-500/15',
      iconColor: 'text-amber-400',
      title: `Ticket promedio: ${formatCurrency(avgTicket)}`,
      body: lastWeekTP > 0
        ? `Ultimos 7 dias: ${formatCurrency(lastWeekTP)}. ${lastWeekTP > avgTicket ? 'Subiendo vs el promedio de 30 dias.' : 'Bajando vs el promedio de 30 dias.'}`
        : `Basado en ${totalTickets.toLocaleString()} tickets en ${data.length} dias.`,
      metric: formatCurrency(avgTicket),
      metricColor: 'bg-amber-500/20 text-amber-400',
    })
  }

  // --- Payment methods insight ---
  const payments = aggregatePayments(data)
  if (payments.length >= 2) {
    const payTotal = payments.reduce((s, p) => s + p.total, 0)
    const topMethod = payments[0]
    const topPct = payTotal > 0 ? ((topMethod.total / payTotal) * 100).toFixed(1) : '0'
    const secondMethod = payments[1]
    const secondPct = payTotal > 0 ? ((secondMethod.total / payTotal) * 100).toFixed(1) : '0'
    insights.push({
      type: 'tip',
      icon: CreditCard,
      iconBg: 'bg-cyan-500/15',
      iconColor: 'text-cyan-400',
      title: `${topMethod.nombre} domina con ${topPct}% de cobros`,
      body: `${topMethod.nombre}: ${formatCurrency(topMethod.total)} (${topPct}%). ${secondMethod.nombre}: ${formatCurrency(secondMethod.total)} (${secondPct}%).`,
      metric: `${topPct}%`,
      metricColor: 'bg-cyan-500/20 text-cyan-400',
    })
  }

  // --- Propinas insight ---
  if (totalPropinas > 0 && totalVentas > 0) {
    const propinaPct = (totalPropinas / totalVentas) * 100
    insights.push({
      type: propinaPct < 5 ? 'alert' : 'daily',
      icon: Users,
      iconBg: propinaPct < 5 ? 'bg-orange-500/15' : 'bg-emerald-500/15',
      iconColor: propinaPct < 5 ? 'text-orange-400' : 'text-emerald-400',
      title: `Propinas: ${propinaPct.toFixed(1)}% sobre ventas`,
      body: `Total propinas: ${formatCurrency(totalPropinas)} sobre ${formatCurrency(totalVentas)} en ventas. ${propinaPct < 5 ? 'Abajo del 5% — considera incentivar al equipo.' : 'Buen nivel de propinas.'}`,
      metric: `${propinaPct.toFixed(1)}%`,
      metricColor: propinaPct < 5 ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400',
    })
  }

  return {
    insights: insights.slice(0, 6),
    summary: { avgVentas, avgTicket, totalVentas, days: data.length },
  }
}

export default function CoachPanel() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function loadData() {
    try {
      const days = await getRecentDays(30)
      setData(days)
    } catch (err) {
      console.error('Coach: error loading data', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    loadData()
  }

  const { insights, summary } = useMemo(() => generateInsights(data), [data])

  // Latest date in data
  const latestDate = data.length > 0
    ? [...data].sort((a, b) => b.fecha.localeCompare(a.fecha))[0].fecha
    : null

  if (loading) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Analizando datos...</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-3 bg-[var(--surface-2)] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[var(--surface-2)] rounded w-full mb-1" />
              <div className="h-3 bg-[var(--surface-2)] rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (insights.length === 0) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Coach</h3>
        </div>
        <p className="text-sm text-[var(--text-3)]">Se necesitan al menos 3 dias con datos de ventas para generar insights.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      {summary && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                <Sparkles size={15} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--text-1)]">Resumen de {summary.days} dias</h3>
                <p className="text-[11px] text-[var(--text-3)]">Insights basados en datos reales</p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-md hover:bg-[var(--surface-2)] transition-colors text-[var(--text-3)] hover:text-[var(--text-2)] disabled:opacity-50"
              title="Actualizar insights"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">Ventas totales</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{formatCurrency(summary.totalVentas)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">Promedio diario</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{formatCurrency(summary.avgVentas)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">Ticket promedio</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{formatCurrency(summary.avgTicket)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">Dias con datos</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{summary.days}</p>
            </div>
          </div>
        </div>
      )}

      {/* Insight cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map((insight, i) => {
          const Icon = insight.icon
          return (
            <div
              key={i}
              className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${insight.iconBg}`}>
                  <Icon size={18} className={insight.iconColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${insight.metricColor}`}>
                      {insight.metric}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[var(--text-1)] mb-1">{insight.title}</p>
                  <p className="text-xs text-[var(--text-2)] leading-relaxed">{insight.body}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {latestDate && (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)] px-1">
          <Calendar size={10} />
          <span>Datos hasta {latestDate}</span>
        </div>
      )}
    </div>
  )
}
