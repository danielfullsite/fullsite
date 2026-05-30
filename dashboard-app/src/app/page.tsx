'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DollarSign, Ticket, Users, Receipt, TrendingDown, TrendingUp, Award, ArrowRight, CreditCard, FileBarChart, ClipboardList, Target, Settings, Eye, EyeOff, GripVertical, Bot, Clock, Zap, Activity } from 'lucide-react'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, aggregateMeseros, getLatestAgentRuns, type AgentRun } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, formatDate, percentChange } from '@/lib/format'
import PredictionWidget from '@/components/PredictionWidget'
import type { WansoftDaily, GrupoEntry, PagoMetodoEntry } from '@/lib/types'

const CATEGORY_NAMES: Record<string, string> = {
  'CHILAQUILES & ENCHILADAS': 'Chilaquiles',
  'EGGS & KETO': 'Huevos & Keto',
  'COFFEE HOT/ICE': 'Café',
  'TOAST & BAGELS': 'Pan & Toast',
  'PANINIS': 'Paninis',
  'BOWLS': 'Bowls',
  'EVERYDAY SPECIALS': 'Especiales',
  'FRESH DRINKS': 'Bebidas frescas',
  'SIGNATURE': 'Signature',
  'JUGOS': 'Jugos',
  'CROISSANTS BREAKFAST': 'Croissants',
  'SMOOTHIES': 'Smoothies',
  'PANCAKES & WAFFLES': 'Pancakes',
  'FRAPPES': 'Frappes',
  'BAKERY': 'Panadería',
  'HEALTHY SNACKS & MARKET': 'Market',
  'DESSERTS': 'Postres',
  'SODAS': 'Sodas',
  'TEA & TISANAS': 'Té',
  'EXTRAS': 'Extras',
  'CEVICHE': 'Ceviche',
  'BEBIDAS OH': 'Bebidas OH',
  'PIZZAS & PASTAS': 'Pizzas & Pastas',
  'SEMILLAS Y DULCES AMALAY': 'Dulces',
  'MUNCHIES': 'Snacks',
  'LA NONNA Gorditas Keto': 'La Nonna',
  'VARIOS': 'Varios',
  'HEALTHY SNACKS': 'Snacks Healthy',
  'ICE CREAM': 'Helados',
}

function cleanCategoryName(name: string): string {
  return CATEGORY_NAMES[name] || name.charAt(0) + name.slice(1).toLowerCase()
}

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

function findRecentDataForField<T>(
  recentData: WansoftDaily[],
  fieldName: 'ventas_por_grupo' | 'pago_métodos',
): T[] {
  for (let i = recentData.length - 1; i >= 0; i--) {
    const arr = safeArray<T>(recentData[i][fieldName])
    const filtered = (arr as Array<{ total?: number }>).filter(item => (item.total || 0) > 0)
    if (filtered.length > 0) return filtered as T[]
  }
  return []
}

type Period = 'dia' | 'semana' | 'mes'

// ── Widget Configuration System ─────────────────────────────────────────
const WIDGET_DEFS = [
  { id: 'insight', label: 'Insight del día', defaultOn: true },
  { id: 'month_progress', label: 'Progreso del mes', defaultOn: true },
  { id: 'kpis', label: 'KPIs principales', defaultOn: true },
  { id: 'prediction', label: 'Predicción de cierre', defaultOn: true },
  { id: 'extra_kpis', label: 'Propinas / Descuentos / Brutas', defaultOn: true },
  { id: 'agent_status', label: 'Status de agentes', defaultOn: true },
  { id: 'week_comparison', label: 'vs Semana pasada', defaultOn: true },
  { id: 'revenue_chart', label: 'Gráfica de ventas (30d)', defaultOn: true },
  { id: 'top_meseros', label: 'Top meseros', defaultOn: true },
  { id: 'categories', label: 'Distribución por categoría', defaultOn: true },
  { id: 'hora_pico', label: 'Hora pico y tendencia', defaultOn: true },
  { id: 'payment_methods', label: 'Métodos de pago', defaultOn: false },
  { id: 'quick_actions', label: 'Acciones rápidas', defaultOn: true },
] as const

type WidgetId = typeof WIDGET_DEFS[number]['id']
type WidgetConfig = Record<WidgetId, boolean>

function getDefaultWidgets(): WidgetConfig {
  return Object.fromEntries(WIDGET_DEFS.map(w => [w.id, w.defaultOn])) as WidgetConfig
}

function loadWidgetConfig(): WidgetConfig {
  if (typeof window === 'undefined') return getDefaultWidgets()
  try {
    const saved = localStorage.getItem('dashboard_widgets')
    if (saved) {
      const parsed = JSON.parse(saved)
      // Merge with defaults (new widgets get default value)
      const defaults = getDefaultWidgets()
      return { ...defaults, ...parsed }
    }
  } catch { /* */ }
  return getDefaultWidgets()
}

function saveWidgetConfig(config: WidgetConfig) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('dashboard_widgets', JSON.stringify(config))
  }
}

export default function DashboardPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [latestDay, setLatestDay] = useState<WansoftDaily | null>(null)
  const [prevDay, setPrevDay] = useState<WansoftDaily | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('dia')
  const [widgets, setWidgets] = useState<WidgetConfig>(getDefaultWidgets)
  const [showSettings, setShowSettings] = useState(false)
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])

  // Load widget config from localStorage
  useEffect(() => { setWidgets(loadWidgetConfig()) }, [])

  const toggleWidget = useCallback((id: WidgetId) => {
    setWidgets(prev => {
      const next = { ...prev, [id]: !prev[id] }
      saveWidgetConfig(next)
      return next
    })
  }, [])

  const show = (id: WidgetId) => widgets[id]

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
        // Load agent runs
        const runs = await getLatestAgentRuns()
        setAgentRuns(runs)
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
          <p className="text-[var(--text-2)] text-sm font-medium">Cargando datos...</p>
        </div>
      </div>
    )
  }

  // Same DOW average (last 4 weeks) for "dia" comparison
  const sameDOWAvg = (() => {
    if (!latestDay) return { ventas: 0, tickets: 0, personas: 0, tp: 0 }
    const latestDate = new Date(latestDay.fecha + 'T12:00:00')
    const dow = latestDate.getDay()
    const sameDOW = recentData.filter(d => {
      const dt = new Date(d.fecha + 'T12:00:00')
      return dt.getDay() === dow && d.fecha !== latestDay.fecha
    }).slice(0, 4)
    if (sameDOW.length === 0) return { ventas: 0, tickets: 0, personas: 0, tp: 0 }
    const avg = (key: keyof WansoftDaily) => sameDOW.reduce((s, d) => s + (Number(d[key]) || 0), 0) / sameDOW.length
    return {
      ventas: avg('ventas_dia'),
      tickets: avg('tickets_count'),
      personas: avg('personas_restaurant'),
      tp: avg('ticket_promedio_restaurant'),
    }
  })()

  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const todayDOWName = latestDay ? dayNames[new Date(latestDay.fecha + 'T12:00:00').getDay()] : ''

  // Period-aware calculations
  const periodData = (() => {
    if (period === 'dia') {
      const ventas = latestDay?.ventas_dia || 0
      const tp = latestDay?.ticket_promedio_restaurant || 0
      // Use Wansoft's TP to calculate restaurant-only tickets (matches what Wansoft shows)
      // tickets_count includes ecommerce/market/apps — tp is restaurant-only
      const tickets = tp > 0 ? Math.round(ventas / tp) : (latestDay?.tickets_count || 0)
      const personas = latestDay?.personas_restaurant || 0
      const propinas = latestDay?.propinas_total || 0
      const descuentos = latestDay?.descuentos || 0
      const brutas = latestDay?.ventas_brutas || 0
      return { ventas, tickets, personas, tp, propinas, descuentos, brutas, prevVentas: sameDOWAvg.ventas, prevTickets: sameDOWAvg.tickets, prevPersonas: sameDOWAvg.personas, prevTp: sameDOWAvg.tp, label: `vs prom. ${todayDOWName}` }
    }
    if (period === 'semana') {
      const last7 = recentData.slice(0, 7)
      const prev7 = recentData.slice(7, 14)
      const sum = (arr: WansoftDaily[], key: keyof WansoftDaily) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
      const ventas = sum(last7, 'ventas_dia')
      const tickets = sum(last7, 'tickets_count')
      const personas = sum(last7, 'personas_restaurant')
      const tp = personas > 0 ? ventas / personas : 0
      const propinas = sum(last7, 'propinas_total')
      const descuentos = sum(last7, 'descuentos')
      const brutas = sum(last7, 'ventas_brutas')
      const prevVentas = sum(prev7, 'ventas_dia')
      const prevTickets = sum(prev7, 'tickets_count')
      const prevPersonas = sum(prev7, 'personas_restaurant')
      const prevTp = prevPersonas > 0 ? prevVentas / prevPersonas : 0
      return { ventas, tickets, personas, tp, propinas, descuentos, brutas, prevVentas, prevTickets, prevPersonas, prevTp, label: 'vs semana anterior' }
    }
    // mes
    const thisMonth = recentData.filter(d => d.fecha.slice(0, 7) === (latestDay?.fecha || '').slice(0, 7))
    const lastMonthStr = (() => {
      if (!latestDay) return ''
      const d = new Date(latestDay.fecha)
      d.setMonth(d.getMonth() - 1)
      return d.toISOString().slice(0, 7)
    })()
    const lastMonth = recentData.filter(d => d.fecha.slice(0, 7) === lastMonthStr)
    const sum = (arr: WansoftDaily[], key: keyof WansoftDaily) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
    const ventas = sum(thisMonth, 'ventas_dia')
    const tickets = sum(thisMonth, 'tickets_count')
    const personas = sum(thisMonth, 'personas_restaurant')
    const tp = personas > 0 ? ventas / personas : 0
    const propinas = sum(thisMonth, 'propinas_total')
    const descuentos = sum(thisMonth, 'descuentos')
    const brutas = sum(thisMonth, 'ventas_brutas')
    const prevVentas = sum(lastMonth, 'ventas_dia')
    const prevTickets = sum(lastMonth, 'tickets_count')
    const prevPersonas = sum(lastMonth, 'personas_restaurant')
    const prevTp = prevPersonas > 0 ? prevVentas / prevPersonas : 0
    return { ventas, tickets, personas, tp, propinas, descuentos, brutas, prevVentas, prevTickets, prevPersonas, prevTp, label: 'vs mes anterior' }
  })()

  const ventasChange = periodData.prevVentas > 0 ? percentChange(periodData.ventas, periodData.prevVentas) : 0
  const ticketsChange = periodData.prevTickets > 0 ? percentChange(periodData.tickets, periodData.prevTickets) : 0
  const personasChange = periodData.prevPersonas > 0 ? percentChange(periodData.personas, periodData.prevPersonas) : 0
  const ticketPromChange = periodData.prevTp > 0 ? percentChange(periodData.tp, periodData.prevTp) : 0

  const topMeseros = latestDay
    ? aggregateMeseros([latestDay]).slice(0, 5)
    : []
  const topMeseroMax = topMeseros[0]?.total || 1

  // Month progress
  const monthProgress = (() => {
    if (!latestDay) return null
    const thisMonthData = recentData.filter(d => d.fecha.slice(0, 7) === latestDay.fecha.slice(0, 7))
    const monthVentas = thisMonthData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
    const latestDate = new Date(latestDay.fecha + 'T12:00:00')
    const daysInMonth = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0).getDate()
    const dayOfMonth = latestDate.getDate()
    const daysLeft = daysInMonth - dayOfMonth
    const dailyAvg = dayOfMonth > 0 ? monthVentas / dayOfMonth : 0
    const projected = monthVentas + (dailyAvg * daysLeft)
    const monthName = latestDate.toLocaleDateString('es-MX', { month: 'long' })
    return { monthVentas, projected, daysLeft, dayOfMonth, daysInMonth, monthName, dailyAvg }
  })()

  // Quick insight line
  const quickInsight = (() => {
    if (!latestDay || topMeseros.length === 0) return null
    const ventas = latestDay.ventas_dia || 0
    const topMesero = topMeseros[0]
    const pct = ventas > 0 ? Math.round((topMesero.total / ventas) * 100) : 0
    const vsAvg = sameDOWAvg.ventas > 0 ? ((ventas / sameDOWAvg.ventas - 1) * 100).toFixed(0) : null
    const parts: string[] = []
    if (vsAvg && Math.abs(Number(vsAvg)) > 5) {
      parts.push(`${Number(vsAvg) > 0 ? '+' : ''}${vsAvg}% vs promedio de ${todayDOWName}`)
    }
    if (pct > 20) {
      parts.push(`${topMesero.nombre.split(' ')[0]} cargó el ${pct}% de las ventas`)
    }
    return parts.length > 0 ? parts.join('. ') + '.' : null
  })()

  // Same day last week comparison
  const sameDayLastWeek = (() => {
    if (!latestDay || recentData.length < 8) return null
    const latestDate = new Date(latestDay.fecha)
    const targetDate = new Date(latestDate.getTime() - 7 * 86400000)
    const targetStr = targetDate.toISOString().split('T')[0]
    return recentData.find(d => d.fecha === targetStr) || null
  })()

  const vsLastWeek = latestDay && sameDayLastWeek
    ? percentChange(latestDay.ventas_dia, sameDayLastWeek.ventas_dia)
    : null
  const vsLastWeekAmount = latestDay && sameDayLastWeek
    ? latestDay.ventas_dia - sameDayLastWeek.ventas_dia
    : null

  const gruposRaw = safeArray<GrupoEntry>(latestDay?.ventas_por_grupo).filter(g => g.total > 0).length > 0
    ? safeArray<GrupoEntry>(latestDay?.ventas_por_grupo)
    : findRecentDataForField<GrupoEntry>(recentData, 'ventas_por_grupo')
  const gruposData = gruposRaw.map(g => ({ ...g, nombre: cleanCategoryName(g.nombre) }))

  const paymentMethods = (() => {
    const latestPayments = safeArray<PagoMetodoEntry>(latestDay?.pago_métodos)
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total)
    if (latestPayments.length > 0) return latestPayments
    return findRecentDataForField<PagoMetodoEntry>(recentData, 'pago_métodos')
      .sort((a, b) => (b as PagoMetodoEntry).total - (a as PagoMetodoEntry).total)
  })()
  const paymentMax = paymentMethods[0]?.total || 1

  return (
    <>
      {/* Page header with period selector + settings */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">
            {period === 'dia' ? 'Resumen del día' : period === 'semana' ? 'Resumen semanal' : 'Resumen mensual'}
          </h2>
          {latestDay && (
            <span className="text-sm text-[var(--text-3)]">
              {formatDate(latestDay.fecha)}
              {latestDay.updated_at && (
                <span className="ml-2 text-xs text-[var(--text-4)]">
                  · Actualizado {new Date(latestDay.updated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              showSettings ? 'bg-[var(--surface)] text-white' : 'bg-[var(--line-soft)] text-[var(--text-2)] hover:bg-[var(--line)]'
            }`}
            title="Personalizar dashboard"
          >
            <Settings size={18} />
          </button>
          <div className="flex bg-[var(--surface)] rounded-xl p-1 gap-1">
            {(['dia', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                  period === p ? 'bg-emerald-500 text-white shadow-lg' : 'text-[var(--text-3)] hover:text-white hover:bg-[var(--surface-2)]'
                }`}
              >
                {p === 'dia' ? 'Dia' : p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Settings panel — toggle widgets */}
      {showSettings && (
        <div className="mb-6 bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Personalizar dashboard</h3>
            <button onClick={() => setShowSettings(false)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)]">
              Cerrar
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {WIDGET_DEFS.map(w => (
              <button
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-all ${
                  widgets[w.id]
                    ? 'bg-[var(--accent-soft)] border border-[var(--accent-line)] text-[var(--accent-bright)]'
                    : 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-3)]'
                }`}
              >
                {widgets[w.id] ? <Eye size={14} /> : <EyeOff size={14} />}
                <span className="font-medium truncate">{w.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick insight */}
      {show('insight') && quickInsight && (
        <div className="mb-4 px-4 py-2.5 bg-purple-500/10 border border-purple-500/30 rounded-xl">
          <p className="text-sm text-purple-400">
            <span className="font-semibold">Hoy:</span> {quickInsight}
          </p>
        </div>
      )}

      {/* Month progress */}
      {show('month_progress') && monthProgress && monthProgress.monthVentas > 0 && (
        <div className="mb-6 bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-[var(--accent-bright)]" />
              <span className="text-sm font-semibold text-[var(--text-1)]">
                {monthProgress.monthName.charAt(0).toUpperCase() + monthProgress.monthName.slice(1)} {new Date(latestDay!.fecha).getFullYear()}
              </span>
            </div>
            <span className="text-xs text-[var(--text-3)]">
              Día {monthProgress.dayOfMonth} de {monthProgress.daysInMonth} · {monthProgress.daysLeft} días restantes
            </span>
          </div>
          <div className="flex items-end gap-4 mb-2">
            <div>
              <span className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(monthProgress.monthVentas)}</span>
            </div>
            <div className="text-xs text-[var(--text-3)] pb-1">
              Proyección: <span className="font-semibold text-[var(--text-2)]">{formatCurrency(monthProgress.projected)}</span>
              {' · '}Prom. diario: <span className="font-semibold text-[var(--text-2)]">{formatCurrency(monthProgress.dailyAvg)}</span>
            </div>
          </div>
          <div className="w-full bg-[var(--line-soft)] rounded-full h-2.5 overflow-hidden">
            <div
              className="h-2.5 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min((monthProgress.dayOfMonth / monthProgress.daysInMonth) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Summary Cards — 4 across like Toast */}
      {show('kpis') && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label={period === 'dia' ? 'Ventas del día' : period === 'semana' ? 'Ventas semana' : 'Ventas del mes'}
          value={formatCurrency(periodData.ventas)}
          delta={`${formatPercent(ventasChange)} ${periodData.label}`}
          deltaType={ventasChange >= 0 ? 'up' : 'down'}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Tickets"
          value={formatNumber(periodData.tickets)}
          delta={`${formatPercent(ticketsChange)} ${periodData.label}`}
          deltaType={ticketsChange >= 0 ? 'up' : 'down'}
          icon={Ticket}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Personas"
          value={formatNumber(periodData.personas)}
          delta={`${formatPercent(personasChange)} ${periodData.label}`}
          deltaType={personasChange >= 0 ? 'up' : 'down'}
          icon={Users}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Ticket promedio"
          value={formatCurrency(periodData.tp)}
          delta={`${formatPercent(ticketPromChange)} ${periodData.label}`}
          deltaType={ticketPromChange >= 0 ? 'up' : 'down'}
          icon={Receipt}
          accentClass="kpi-accent-purple"
        />
      </div>}

      {/* Prediction Widget */}
      {show('prediction') && period === 'dia' && (() => {
        const today = latestDay?.fecha || ''
        const todayDate = today ? new Date(today + 'T12:00:00') : new Date()
        const todayDow = todayDate.getDay()
        const yesterdayDate = new Date(todayDate); yesterdayDate.setDate(todayDate.getDate() - 1)
        const yesterdayStr = yesterdayDate.toISOString().slice(0, 10)
        const lastWeekDate = new Date(todayDate); lastWeekDate.setDate(todayDate.getDate() - 7)
        const lastWeekStr = lastWeekDate.toISOString().slice(0, 10)

        const yesterdayData = recentData.find(d => d.fecha === yesterdayStr)
        const lastWeekData = recentData.find(d => d.fecha === lastWeekStr)

        // DOW average from last 4 weeks
        const sameDowDays = recentData.filter(d => {
          const dt = new Date(d.fecha + 'T12:00:00')
          return dt.getDay() === todayDow && d.fecha !== today && (d.ventas_dia || 0) > 0
        })
        const dowAvg = sameDowDays.length > 0
          ? sameDowDays.reduce((sum, d) => sum + (d.ventas_dia || 0), 0) / sameDowDays.length
          : 0

        return (
          <PredictionWidget
            currentVentas={latestDay?.ventas_dia || 0}
            currentTickets={latestDay?.tickets_count || 0}
            yesterdayVentas={yesterdayData?.ventas_dia || 0}
            lastWeekVentas={lastWeekData?.ventas_dia || 0}
            dowAvgVentas={dowAvg}
          />
        )
      })()}

      {/* Extra KPI row — Propinas + Descuentos + Brutas */}
      {show('extra_kpis') && <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm px-5 py-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Propinas</p>
          <p className="text-xl font-bold text-[var(--accent-bright)]">{formatCurrency(periodData.propinas)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm px-5 py-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Descuentos</p>
          <p className="text-xl font-bold text-red-400">{formatCurrency(periodData.descuentos)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm px-5 py-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Ventas brutas</p>
          <p className="text-xl font-bold text-[var(--text-1)]">{formatCurrency(periodData.brutas)}</p>
        </div>
      </div>}

      {/* Agent Status Widget — real data from agent_runs */}
      {show('agent_status') && (
        <div className="mb-6 bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Bot size={14} className="text-purple-400" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Agentes IA</h3>
            <span className="ml-auto text-xs text-[var(--accent-bright)] font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {agentRuns.length} activos
            </span>
          </div>
          {agentRuns.length === 0 ? (
            <p className="text-[var(--text-3)] text-sm">Cargando datos de agentes...</p>
          ) : (
            <div className="space-y-1.5">
              {agentRuns.slice(0, 8).map(run => {
                const agentNames: Record<string, string> = {
                  'anomaly-detector': 'Anomalias',
                  'close-predictor': 'Predicción',
                  'upselling': 'Upselling',
                  'menu-engineering': 'Menu Eng.',
                  'staffing-optimizer': 'Staffing',
                  'antifraud-agent': 'Anti-fraude',
                  'kitchen-quality': 'Cocina',
                  'tips-analyzer': 'Propinas',
                  'supplier-monitor': 'Proveedores',
                  'waste-detector': 'Merma',
                  'daily-briefing': 'Briefing',
                  'weekly-amalay': 'Semanal',
                  'reservas-pendientes': 'Reservas',
                  'wansoft-staleness': 'Sync',
                  'config-validator': 'Config',
                  'intraday-sales': 'Intraday',
                  'speed_of_service': 'Velocidad',
                  'inventory_auto_order': 'Auto-orden',
                  'pos_daily_aggregator': 'Agregador',
                  'proactive-alerts': 'Alertas',
                  'climate-events': 'Clima',
                  'hermes': 'Hermes',
                  'table-time': 'Mesas',
                  'menu-gap': 'Menu Gap',
                }
                const name = agentNames[run.agent_id] || run.agent_id
                const isError = run.status === 'error'
                const mins = Math.floor((Date.now() - new Date(run.created_at).getTime()) / 60000)
                const timeAgo = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`
                return (
                  <div key={run.agent_id} className="flex items-center gap-2 bg-[var(--surface-2)] rounded-lg px-3 py-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isError ? 'bg-red-500' : 'bg-emerald-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-[var(--text-1)]">{name}</p>
                        <span className="text-[10px] text-[var(--text-4)]">{timeAgo}</span>
                      </div>
                      <p className="text-[10px] text-[var(--text-3)] truncate">{run.output_summary}</p>
                    </div>
                  </div>
                )
              })}
              {agentRuns.length > 8 && (
                <a href="/agentes" className="block text-center text-xs text-[var(--accent)] hover:text-[var(--accent-bright)] py-1">
                  Ver los {agentRuns.length} agentes →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Week comparison banner — like Wansoft */}
      {show('week_comparison') && vsLastWeek !== null && vsLastWeekAmount !== null && sameDayLastWeek && (
        <div className={`mb-6 rounded-xl border p-4 ${vsLastWeek >= 0 ? 'bg-[var(--accent-soft)] border-[var(--accent-line)]' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {vsLastWeek >= 0
                ? <TrendingUp size={20} className="text-[var(--accent-bright)]" />
                : <TrendingDown size={20} className="text-red-600" />}
              <div>
                <p className={`font-bold text-lg ${vsLastWeek >= 0 ? 'text-[var(--accent-bright)]' : 'text-red-400'}`}>
                  {formatPercent(vsLastWeek)} vs mismo día semana pasada
                </p>
                <p className="text-sm text-[var(--text-2)]">
                  {vsLastWeekAmount >= 0 ? '+' : ''}{formatCurrency(vsLastWeekAmount)} · {sameDayLastWeek.fecha}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-[var(--text-2)]">Semana pasada</p>
              <p className="font-semibold text-[var(--text-1)]">{formatCurrency(sameDayLastWeek.ventas_dia)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main chart — full width */}
      {show('revenue_chart') && <div className="mb-6">
        <RevenueChart
          data={recentData.map((d) => ({
            fecha: d.fecha,
            ventas_dia: d.ventas_dia,
          }))}
          title="Ventas últimos 30 días"
        />
      </div>}

      {/* Two columns: Top meseros + Categories */}
      {(show('top_meseros') || show('categories')) && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top meseros — R365 style with progress bars */}
        {show('top_meseros') && <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center">
              <Award size={14} className="text-[var(--accent-bright)]" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">
              Top meseros del día
            </h3>
          </div>
          <p className="text-xs text-[var(--text-3)] mb-5 ml-9">Ranking por ventas</p>
          {topMeseros.length === 0 ? (
            <p className="text-[var(--text-3)] text-sm">Sin datos de meseros</p>
          ) : (
            <div className="space-y-4">
              {topMeseros.map((m, i) => {
                const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                const colors = [
                  { bg: 'bg-blue-500/10', text: 'text-blue-400', bar: '#3b82f6' },
                  { bg: 'bg-emerald-500/10', text: 'text-[var(--accent-bright)]', bar: '#10b981' },
                  { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: '#f59e0b' },
                  { bg: 'bg-red-500/10', text: 'text-red-400', bar: '#ef4444' },
                  { bg: 'bg-[var(--surface-2)]', text: 'text-[var(--text-2)]', bar: '#94a3b8' },
                ]
                const color = colors[i] || colors[4]
                return (
                  <div key={m.nombre}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${color.bg} ${color.text}`}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-1)] truncate">
                          {m.nombre}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-[var(--text-1)] tabular-nums">
                        {formatCurrency(m.total)}
                      </p>
                    </div>
                    <div className="ml-10 w-auto bg-[var(--line-soft)] rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full animate-progress"
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
        </div>}

        {/* Categories — horizontal bars */}
        {show('categories') && <RevenueDistributionChart
          data={gruposData}
          title="Distribución por categoría"
        />}
      </div>}

      {/* Payment methods */}
      {show('payment_methods') && <div className="mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <CreditCard size={14} className="text-violet-600" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">
              Métodos de pago
            </h3>
          </div>
          <p className="text-xs text-[var(--text-3)] mb-5 ml-9">
            {latestDay ? formatCurrency(latestDay.ventas_dia) : '-'} total
          </p>
          {paymentMethods.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paymentMethods.map((p, i) => {
                const total = latestDay?.ventas_dia || 1
                const pct = ((p.total / total) * 100).toFixed(0)
                const barWidth = paymentMax > 0 ? ((p.total / paymentMax) * 100) : 0
                const barColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4']
                return (
                  <div key={p.nombre} className="bg-[var(--surface-2)] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: barColors[i % barColors.length] }}
                        />
                        <span className="text-sm font-medium text-[var(--text-1)]">
                          {p.nombre}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--text-3)] font-medium">
                        {pct}%
                      </span>
                    </div>
                    <p className="text-lg font-bold text-[var(--text-1)] tabular-nums mb-2">
                      {formatCurrency(p.total)}
                    </p>
                    <div className="w-full bg-[var(--line)] rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full animate-progress"
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
              <p className="text-[var(--text-3)] text-sm">Sin datos de pagos para este día</p>
            </div>
          )}
        </div>
      </div>}

      {/* Hora pico + daily trend */}
      {show('hora_pico') && latestDay && (
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Hora pico */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock size={14} className="text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Hora pico</h3>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-[var(--text-1)]">
                {(() => {
                  const peak = recentData.slice(-7).reduce((best, d) => {
                    const m = d.meseros as unknown as Array<{ nombre: string; total: number }>
                    const total = Array.isArray(m) ? m.reduce((s, x) => s + (x.total || 0), 0) : 0
                    return total > best.total ? { total, fecha: d.fecha } : best
                  }, { total: 0, fecha: '' })
                  return peak.fecha ? new Date(peak.fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long' }) : '-'
                })()}
              </span>
              <span className="text-sm text-[var(--text-3)]">mejor día (7d)</span>
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm">
              <div>
                <span className="text-[var(--text-3)]">Mesas/dia:</span>
                <span className="ml-1 font-semibold text-[var(--text-1)]">{latestDay.mesas_atendidas || 0}</span>
              </div>
              <div>
                <span className="text-[var(--text-3)]">Para llevar:</span>
                <span className="ml-1 font-semibold text-[var(--text-1)]">{latestDay.ordenes_llevar || 0}</span>
              </div>
            </div>
          </div>

          {/* Efficiency metrics */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Activity size={14} className="text-cyan-400" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Eficiencia del día</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Venta por persona', value: formatCurrency((latestDay.ventas_dia || 0) / Math.max(latestDay.personas_restaurant || 1, 1)) },
                { label: 'Venta por mesa', value: formatCurrency((latestDay.ventas_dia || 0) / Math.max(latestDay.mesas_atendidas || 1, 1)) },
                { label: 'Propina promedio', value: formatCurrency((latestDay.propinas_total || 0) / Math.max(latestDay.mesas_atendidas || 1, 1)) },
                { label: 'Descuento %', value: `${((latestDay.descuentos || 0) / Math.max(latestDay.ventas_brutas || 1, 1) * 100).toFixed(1)}%` },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-2)]">{m.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-1)] tabular-nums">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick actions row */}
      {show('quick_actions') && <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { href: '/ventas', label: 'Ver ventas', desc: 'Detalle diario', icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { href: '/meseros', label: 'Ver meseros', desc: 'Rankings y KPIs', icon: Award, color: 'text-[var(--accent-bright)]', bg: 'bg-emerald-500/10' },
          { href: '/cortes', label: 'Ver cortes', desc: 'Cierres de caja', icon: ClipboardList, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { href: '/reportes', label: 'Generar reporte', desc: 'Exportar datos', icon: FileBarChart, color: 'text-purple-400', bg: 'bg-purple-500/10' },
        ].map(action => {
          const ActionIcon = action.icon
          return (
            <Link
              key={action.href}
              href={action.href}
              className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 hover:shadow-md hover:border-[var(--line)] transition-all group"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${action.bg}`}>
                <ActionIcon size={18} className={action.color} />
              </div>
              <p className="text-sm font-semibold text-[var(--text-1)] mb-0.5">{action.label}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-3)]">{action.desc}</p>
                <ArrowRight size={14} className="text-[var(--text-4)] group-hover:text-[var(--text-2)] transition-colors" />
              </div>
            </Link>
          )
        })}
      </div>}
    </>
  )
}
