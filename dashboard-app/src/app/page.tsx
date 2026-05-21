'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DollarSign, Ticket, Users, Receipt, TrendingDown, TrendingUp, Award, ArrowRight, CreditCard, FileBarChart, ClipboardList, Target, Settings, Eye, EyeOff, GripVertical } from 'lucide-react'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber, formatPercent, formatDate, percentChange } from '@/lib/format'
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
  fieldName: 'ventas_por_grupo' | 'pago_metodos',
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
  { id: 'extra_kpis', label: 'Propinas / Descuentos / Brutas', defaultOn: true },
  { id: 'week_comparison', label: 'vs Semana pasada', defaultOn: true },
  { id: 'revenue_chart', label: 'Gráfica de ventas (30d)', defaultOn: true },
  { id: 'top_meseros', label: 'Top meseros', defaultOn: true },
  { id: 'categories', label: 'Distribución por categoría', defaultOn: true },
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

  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const todayDOWName = latestDay ? dayNames[new Date(latestDay.fecha + 'T12:00:00').getDay()] : ''

  // Period-aware calculations
  const periodData = (() => {
    if (period === 'dia') {
      const ventas = latestDay?.ventas_dia || 0
      const tickets = latestDay?.tickets_count || 0
      const personas = latestDay?.personas_restaurant || 0
      const tp = latestDay?.ticket_promedio_restaurant || 0
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
      {/* Page header with period selector + settings */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            {period === 'dia' ? 'Resumen del dia' : period === 'semana' ? 'Resumen semanal' : 'Resumen mensual'}
          </h2>
          {latestDay && (
            <span className="text-sm text-slate-400">
              {formatDate(latestDay.fecha)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              showSettings ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            title="Personalizar dashboard"
          >
            <Settings size={18} />
          </button>
          <div className="flex bg-slate-900 rounded-xl p-1 gap-1">
            {(['dia', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                  period === p ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'
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
        <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Personalizar dashboard</h3>
            <button onClick={() => setShowSettings(false)} className="text-xs text-slate-400 hover:text-slate-600">
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
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-slate-50 border border-slate-200 text-slate-400'
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
        <div className="mb-4 px-4 py-2.5 bg-violet-50 border border-violet-200 rounded-xl">
          <p className="text-sm text-violet-800">
            <span className="font-semibold">Hoy:</span> {quickInsight}
          </p>
        </div>
      )}

      {/* Month progress */}
      {show('month_progress') && monthProgress && monthProgress.monthVentas > 0 && (
        <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-emerald-600" />
              <span className="text-sm font-semibold text-slate-900">
                {monthProgress.monthName.charAt(0).toUpperCase() + monthProgress.monthName.slice(1)} {new Date(latestDay!.fecha).getFullYear()}
              </span>
            </div>
            <span className="text-xs text-slate-400">
              Día {monthProgress.dayOfMonth} de {monthProgress.daysInMonth} · {monthProgress.daysLeft} días restantes
            </span>
          </div>
          <div className="flex items-end gap-4 mb-2">
            <div>
              <span className="text-2xl font-bold text-slate-900">{formatCurrency(monthProgress.monthVentas)}</span>
            </div>
            <div className="text-xs text-slate-400 pb-1">
              Proyección: <span className="font-semibold text-slate-600">{formatCurrency(monthProgress.projected)}</span>
              {' · '}Prom. diario: <span className="font-semibold text-slate-600">{formatCurrency(monthProgress.dailyAvg)}</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
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
          label={period === 'dia' ? 'Ventas del dia' : period === 'semana' ? 'Ventas semana' : 'Ventas del mes'}
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

      {/* Extra KPI row — Propinas + Descuentos + Brutas */}
      {show('extra_kpis') && <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <p className="text-xs text-slate-500 font-medium mb-1">Propinas</p>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(periodData.propinas)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <p className="text-xs text-slate-500 font-medium mb-1">Descuentos</p>
          <p className="text-xl font-bold text-red-500">{formatCurrency(periodData.descuentos)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <p className="text-xs text-slate-500 font-medium mb-1">Ventas brutas</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(periodData.brutas)}</p>
        </div>
      </div>}

      {/* Week comparison banner — like Wansoft */}
      {show('week_comparison') && vsLastWeek !== null && vsLastWeekAmount !== null && sameDayLastWeek && (
        <div className={`mb-6 rounded-xl border p-4 ${vsLastWeek >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {vsLastWeek >= 0
                ? <TrendingUp size={20} className="text-emerald-600" />
                : <TrendingDown size={20} className="text-red-600" />}
              <div>
                <p className={`font-bold text-lg ${vsLastWeek >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatPercent(vsLastWeek)} vs mismo dia semana pasada
                </p>
                <p className="text-sm text-slate-500">
                  {vsLastWeekAmount >= 0 ? '+' : ''}{formatCurrency(vsLastWeekAmount)} · {sameDayLastWeek.fecha}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">Semana pasada</p>
              <p className="font-semibold text-slate-700">{formatCurrency(sameDayLastWeek.ventas_dia)}</p>
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
        {show('top_meseros') && <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Award size={14} className="text-emerald-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              Top meseros del día
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
                  { bg: 'bg-blue-50', text: 'text-blue-600', bar: '#3b82f6' },
                  { bg: 'bg-emerald-50', text: 'text-emerald-600', bar: '#10b981' },
                  { bg: 'bg-amber-50', text: 'text-amber-600', bar: '#f59e0b' },
                  { bg: 'bg-red-50', text: 'text-red-500', bar: '#ef4444' },
                  { bg: 'bg-slate-50', text: 'text-slate-500', bar: '#94a3b8' },
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
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {m.nombre}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(m.total)}
                      </p>
                    </div>
                    <div className="ml-10 w-auto bg-slate-100 rounded-full h-1.5 overflow-hidden">
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
              <CreditCard size={14} className="text-violet-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              Métodos de pago
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-5 ml-9">
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
                  <div key={p.nombre} className="bg-slate-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: barColors[i % barColors.length] }}
                        />
                        <span className="text-sm font-medium text-slate-700">
                          {p.nombre}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">
                        {pct}%
                      </span>
                    </div>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mb-2">
                      {formatCurrency(p.total)}
                    </p>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
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
              <p className="text-slate-400 text-sm">Sin datos de pagos para este día</p>
            </div>
          )}
        </div>
      </div>}

      {/* Quick actions row */}
      {show('quick_actions') && <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { href: '/ventas', label: 'Ver ventas', desc: 'Detalle diario', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
          { href: '/meseros', label: 'Ver meseros', desc: 'Rankings y KPIs', icon: Award, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { href: '/cortes', label: 'Ver cortes', desc: 'Cierres de caja', icon: ClipboardList, color: 'text-amber-600', bg: 'bg-amber-50' },
          { href: '/reportes', label: 'Generar reporte', desc: 'Exportar datos', icon: FileBarChart, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(action => {
          const ActionIcon = action.icon
          return (
            <Link
              key={action.href}
              href={action.href}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md hover:border-slate-300 transition-all group"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${action.bg}`}>
                <ActionIcon size={18} className={action.color} />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-0.5">{action.label}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{action.desc}</p>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
            </Link>
          )
        })}
      </div>}
    </>
  )
}
