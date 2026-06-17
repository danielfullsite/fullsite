'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DollarSign, Ticket, Users, Receipt, TrendingDown, TrendingUp, Award, ArrowRight, CreditCard, FileBarChart, ClipboardList, Target, Settings, Eye, EyeOff, GripVertical, Bot, Clock, Zap, Activity, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import KPICard from '@/components/KPICard'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, getDashboardFromPosOrders, aggregateMeseros, getLatestAgentRuns, type AgentRun } from '@/lib/data'
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
  const [selectedDayIdx, setSelectedDayIdx] = useState(0) // 0 = latest, 1 = yesterday, etc.
  const [weekOffset, setWeekOffset] = useState(0) // 0 = current week, 1 = last week, etc.
  const [monthOffset, setMonthOffset] = useState(0) // 0 = current month, 1 = last month, etc.
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
        // Timeout: if data doesn't load in 10s, show empty state instead of infinite spinner
        const timeoutP = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
        let recent = await Promise.race([getRecentDays(1000), timeoutP]).catch(() => [] as WansoftDaily[])
        let latest = await Promise.race([getLatestDay(), timeoutP]).catch(() => null as WansoftDaily | null)

        // Fallback: if no wansoft_daily data, build from pos_orders
        if (recent.length === 0) {
          recent = await getDashboardFromPosOrders(30)
          latest = recent.length > 0 ? recent[recent.length - 1] : null
        }

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
    // Auto-refresh: every 5 min + when the tab regains focus, so the
    // dashboard never shows stale data without the user knowing.
    const interval = setInterval(load, 5 * 60 * 1000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
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

  // Selected day for navigation (0=latest day, 1=yesterday, etc.)
  // recentData is sorted ASC (oldest first), so latest = last element
  const viewDay = period === 'dia' && recentData.length > 0
    ? (recentData[recentData.length - 1 - selectedDayIdx] || latestDay)
    : latestDay

  // Same DOW average (last 4 weeks) for "dia" comparison
  const sameDOWAvg = (() => {
    if (!viewDay) return { ventas: 0, tickets: 0, personas: 0, tp: 0 }
    const viewDate = new Date(viewDay.fecha + 'T12:00:00')
    const dow = viewDate.getDay()
    const sameDOW = recentData.filter(d => {
      const dt = new Date(d.fecha + 'T12:00:00')
      return dt.getDay() === dow && d.fecha !== viewDay.fecha
    }).slice(0, 4)
    if (sameDOW.length === 0) return { ventas: 0, tickets: 0, personas: 0, tp: 0 }
    const avg = (key: keyof WansoftDaily) => sameDOW.reduce((s, d) => s + (Number(d[key]) || 0), 0) / sameDOW.length
    return {
      ventas: avg('ventas_dia'),
      tickets: avg('tickets_count'),
      personas: avg('personas_restaurant'),
      // TP por persona para comparar igual que el dato del dia
      tp: avg('personas_restaurant') > 0 ? avg('ventas_dia') / avg('personas_restaurant') : avg('ticket_promedio_restaurant'),
    }
  })()

  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const todayDOWName = viewDay ? dayNames[new Date(viewDay.fecha + 'T12:00:00').getDay()] : ''

  // Period-aware calculations
  const periodData = (() => {
    if (period === 'dia') {
      const day = viewDay
      const ventas = day?.ventas_dia || 0
      const personas = day?.personas_restaurant || 0
      const tickets = day?.tickets_count || 0
      // TP por persona (como Wansoft "Promedio por persona")
      const tp = personas > 0 ? Math.round(ventas / personas) : (day?.ticket_promedio_restaurant || 0)
      // TP por orden/mesa (como Wansoft "Promedio por orden")
      const tpOrden = tickets > 0 ? Math.round(ventas / tickets) : (day?.ticket_promedio_restaurant || 0)
      const propinas = day?.propinas_total || 0
      const descuentos = day?.descuentos || 0
      const brutas = day?.ventas_brutas || 0
      return { ventas, tickets, personas, tp, tpOrden, propinas, descuentos, brutas, prevVentas: sameDOWAvg.ventas, prevTickets: sameDOWAvg.tickets, prevPersonas: sameDOWAvg.personas, prevTp: sameDOWAvg.tp, label: `vs prom. ${todayDOWName}` }
    }
    if (period === 'semana') {
      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - now.getDay() + 1 - weekOffset * 7)
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7)
      const prevWeekEnd = new Date(prevWeekStart); prevWeekEnd.setDate(prevWeekStart.getDate() + 6)
      const fmt = (d: Date) => d.toISOString().slice(0, 10)
      const thisWeek = recentData.filter(d => d.fecha >= fmt(weekStart) && d.fecha <= fmt(weekEnd))
      const prevWeek = recentData.filter(d => d.fecha >= fmt(prevWeekStart) && d.fecha <= fmt(prevWeekEnd))
      const sum = (arr: WansoftDaily[], key: keyof WansoftDaily) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
      const ventas = sum(thisWeek, 'ventas_dia')
      const tickets = sum(thisWeek, 'tickets_count')
      const personas = sum(thisWeek, 'personas_restaurant')
      const tp = personas > 0 ? ventas / personas : 0
      const tpOrden = tickets > 0 ? ventas / tickets : 0
      const propinas = sum(thisWeek, 'propinas_total')
      const descuentos = sum(thisWeek, 'descuentos')
      const brutas = sum(thisWeek, 'ventas_brutas')
      const prevVentas = sum(prevWeek, 'ventas_dia')
      const prevTickets = sum(prevWeek, 'tickets_count')
      const prevPersonas = sum(prevWeek, 'personas_restaurant')
      const prevTp = prevPersonas > 0 ? prevVentas / prevPersonas : 0
      return { ventas, tickets, personas, tp, tpOrden, propinas, descuentos, brutas, prevVentas, prevTickets, prevPersonas, prevTp, label: 'vs semana anterior' }
    }
    // mes — use monthOffset (avoid toISOString timezone issues)
    const nowM = new Date()
    const viewMonth = new Date(nowM.getFullYear(), nowM.getMonth() - monthOffset, 1)
    const viewMonthStr = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`
    const prevMonthD = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
    const prevMonthStr = `${prevMonthD.getFullYear()}-${String(prevMonthD.getMonth() + 1).padStart(2, '0')}`
    const thisMonthData = recentData.filter(d => d.fecha.slice(0, 7) === viewMonthStr)
    const lastMonthData = recentData.filter(d => d.fecha.slice(0, 7) === prevMonthStr)
    const sum = (arr: WansoftDaily[], key: keyof WansoftDaily) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
    const ventas = sum(thisMonthData, 'ventas_dia')
    const tickets = sum(thisMonthData, 'tickets_count')
    const personas = sum(thisMonthData, 'personas_restaurant')
    const tp = personas > 0 ? ventas / personas : 0
    const tpOrden = tickets > 0 ? ventas / tickets : 0
    const propinas = sum(thisMonthData, 'propinas_total')
    const descuentos = sum(thisMonthData, 'descuentos')
    const brutas = sum(thisMonthData, 'ventas_brutas')
    const prevVentas = sum(lastMonthData, 'ventas_dia')
    const prevTickets = sum(lastMonthData, 'tickets_count')
    const prevPersonas = sum(lastMonthData, 'personas_restaurant')
    const prevTp = prevPersonas > 0 ? prevVentas / prevPersonas : 0
    return { ventas, tickets, personas, tp, tpOrden, propinas, descuentos, brutas, prevVentas, prevTickets, prevPersonas, prevTp, label: 'vs mes anterior' }
  })()

  const ventasChange = periodData.prevVentas > 0 ? percentChange(periodData.ventas, periodData.prevVentas) : 0
  const ticketsChange = periodData.prevTickets > 0 ? percentChange(periodData.tickets, periodData.prevTickets) : 0
  const personasChange = periodData.prevPersonas > 0 ? percentChange(periodData.personas, periodData.prevPersonas) : 0
  const ticketPromChange = periodData.prevTp > 0 ? percentChange(periodData.tp, periodData.prevTp) : 0

  const topMeseros = (period === 'dia' ? viewDay : latestDay)
    ? aggregateMeseros([period === 'dia' ? viewDay! : latestDay!]).slice(0, 5)
    : []
  const topMeseroMax = topMeseros[0]?.total || 1

  // Month progress
  const monthProgress = (() => {
    if (!latestDay) return null
    // Use selected month when in 'mes' period, otherwise use latest day's month
    const now = new Date()
    const targetMonth = period === 'mes'
      ? new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
      : new Date((viewDay || latestDay).fecha + 'T12:00:00')
    const targetPrefix = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, '0')}`
    const thisMonthData = recentData.filter(d => d.fecha.slice(0, 7) === targetPrefix)
    const monthVentas = thisMonthData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
    const daysInMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
    const dayOfMonth = thisMonthData.length
    const daysLeft = daysInMonth - dayOfMonth
    const dailyAvg = dayOfMonth > 0 ? monthVentas / dayOfMonth : 0
    const projected = monthVentas + (dailyAvg * daysLeft)
    const monthName = targetMonth.toLocaleDateString('es-MX', { month: 'long' })
    const yearNum = targetMonth.getFullYear()
    return { monthVentas, projected, daysLeft, dayOfMonth, daysInMonth, monthName, dailyAvg, yearNum }
  })()

  // Quick insight line
  const quickInsight = (() => {
    const day = period === 'dia' ? viewDay : latestDay
    if (!day || topMeseros.length === 0) return null
    const ventas = day.ventas_dia || 0
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
      {/* Page header with period selector + day navigation + settings */}
      <div className="mb-4 sm:mb-6 space-y-2 sm:space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-xl font-bold tracking-tight text-[var(--text-1)]">
            {period === 'dia' ? 'Resumen del día' : period === 'semana' ? 'Resumen semanal' : 'Resumen mensual'}
          </h2>
          {/* Navigation arrows + date label for all periods */}
          {(() => {
            const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
            if (period === 'dia' && viewDay) {
              return (
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedDayIdx(i => Math.min(i + 1, recentData.length - 1))} disabled={selectedDayIdx >= recentData.length - 1} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="text-sm text-[var(--text-2)] font-medium">
                    {formatDate(viewDay.fecha)}
                    {(() => {
                      const mxToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
                      const fecha = String(viewDay.fecha).slice(0, 10)
                      if (fecha === mxToday) return <span className="text-[var(--accent)] ml-1 text-xs font-bold">HOY</span>
                      if (selectedDayIdx === 0) return <span className="text-[var(--text-3)] ml-1 text-xs font-bold">ÚLTIMO CIERRE</span>
                      return null
                    })()}
                  </span>
                  <button onClick={() => setSelectedDayIdx(i => Math.max(i - 1, 0))} disabled={selectedDayIdx <= 0} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-lg bg-[var(--line-soft)] flex items-center justify-center pointer-events-none">
                      <CalendarDays size={16} className="text-[var(--text-2)]" />
                    </div>
                    <input
                      type="date"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      value={viewDay.fecha}
                      min={recentData[0]?.fecha}
                      max={recentData[recentData.length - 1]?.fecha}
                      onChange={(e) => {
                        const idx = recentData.findIndex(d => d.fecha === e.target.value)
                        if (idx >= 0) setSelectedDayIdx(recentData.length - 1 - idx)
                      }}
                    />
                  </div>
                </div>
              )
            }
            if (period === 'semana') {
              const now = new Date()
              const weekStart = new Date(now)
              weekStart.setDate(now.getDate() - now.getDay() + 1 - weekOffset * 7)
              const weekEnd = new Date(weekStart)
              weekEnd.setDate(weekStart.getDate() + 6)
              const label = `${weekStart.getDate()} ${MESES[weekStart.getMonth()].slice(0,3)} - ${weekEnd.getDate()} ${MESES[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`
              return (
                <div className="flex items-center gap-2">
                  <button onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 130} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="text-sm text-[var(--text-2)] font-medium text-center">
                    {label}
                    {weekOffset === 0 && <span className="text-[var(--accent)] ml-1 text-xs font-bold">ACTUAL</span>}
                  </span>
                  <button onClick={() => setWeekOffset(w => Math.max(w - 1, 0))} disabled={weekOffset <= 0} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-lg bg-[var(--line-soft)] flex items-center justify-center pointer-events-none"><CalendarDays size={16} className="text-[var(--text-2)]" /></div>
                    <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => {
                      const picked = new Date(e.target.value + 'T12:00:00')
                      const today = new Date()
                      const diffDays = Math.round((today.getTime() - picked.getTime()) / (1000 * 60 * 60 * 24))
                      setWeekOffset(Math.max(0, Math.round(diffDays / 7)))
                    }} />
                  </div>
                </div>
              )
            }
            if (period === 'mes') {
              const now = new Date()
              const viewMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
              const label = `${MESES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
              return (
                <div className="flex items-center gap-2">
                  <button onClick={() => setMonthOffset(m => m + 1)} disabled={monthOffset >= 36} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="text-sm text-[var(--text-2)] font-medium text-center">
                    {label}
                    {monthOffset === 0 && <span className="text-[var(--accent)] ml-1 text-xs font-bold">ACTUAL</span>}
                  </span>
                  <button onClick={() => setMonthOffset(m => Math.max(m - 1, 0))} disabled={monthOffset <= 0} className="w-8 h-8 rounded-lg bg-[var(--line-soft)] hover:bg-[var(--line)] flex items-center justify-center disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-lg bg-[var(--line-soft)] flex items-center justify-center pointer-events-none"><CalendarDays size={16} className="text-[var(--text-2)]" /></div>
                    <input type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => {
                      const picked = new Date(e.target.value + 'T12:00:00')
                      const now = new Date()
                      setMonthOffset((now.getFullYear() - picked.getFullYear()) * 12 + (now.getMonth() - picked.getMonth()))
                    }} />
                  </div>
                </div>
              )
            }
            return null
          })()}
        </div>
        {/* Row 2: settings + period tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                showSettings ? 'bg-[var(--surface)] text-white' : 'bg-[var(--line-soft)] text-[var(--text-2)] hover:bg-[var(--line)]'
              }`}
              title="Personalizar dashboard"
            >
              <Settings size={16} />
            </button>
          </div>
          <div className="flex bg-[var(--surface)] rounded-xl p-1 gap-1">
            {(['dia', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  period === p ? 'bg-emerald-500 text-white shadow-lg' : 'text-[var(--text-3)] hover:text-white hover:bg-[var(--surface-2)]'
                }`}
              >
                {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data freshness: warn when showing a past day as the default view, show sync time for today */}
      {period === 'dia' && viewDay && (() => {
        const mxToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
        const fecha = String(viewDay.fecha).slice(0, 10)
        const syncTime = viewDay.updated_at
          ? new Date(viewDay.updated_at).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit' })
          : null
        if (fecha !== mxToday && selectedDayIdx === 0) {
          return (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400">
              <span className="font-bold">⚠ Sin sincronización de hoy todavía.</span>
              <span>Mostrando el último día con datos: {formatDate(fecha)}{syncTime ? ` (actualizado ${syncTime})` : ''}.</span>
            </div>
          )
        }
        if (fecha === mxToday && syncTime) {
          return (
            <div className="mb-4 text-xs text-[var(--text-3)] font-medium">
              Datos de Wansoft actualizados a las {syncTime} — se sincronizan cada 30 min, pueden diferir de la app de Wansoft en tiempo real.
            </div>
          )
        }
        return null
      })()}

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
        <div className="mb-3 sm:mb-4 px-3 sm:px-4 py-2 sm:py-2.5 bg-purple-500/10 border border-purple-500/30 rounded-xl">
          <p className="text-xs sm:text-sm text-purple-400">
            <Zap size={12} className="inline mr-1 -mt-0.5" />
            {quickInsight}
          </p>
        </div>
      )}

      {/* Month progress — premium card */}
      {show('month_progress') && monthProgress && monthProgress.monthVentas > 0 && (
        <div className="mb-4 sm:mb-6 bg-gradient-to-br from-emerald-500/10 via-[var(--surface)] to-[var(--surface-2)] rounded-2xl border border-emerald-500/20 shadow-lg px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <Target size={14} className="text-emerald-500" />
              </div>
              <span className="text-sm sm:text-base font-bold text-[var(--text-1)]">
                {monthProgress.monthName.charAt(0).toUpperCase() + monthProgress.monthName.slice(1)} {monthProgress.yearNum}
              </span>
            </div>
            <span className="text-[10px] sm:text-xs text-emerald-400 bg-emerald-500/10 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-semibold">
              Día {monthProgress.dayOfMonth}/{monthProgress.daysInMonth}
            </span>
          </div>
          <p className="text-2xl sm:text-4xl font-black text-[var(--text-1)] mb-1">{formatCurrency(monthProgress.monthVentas)}</p>
          <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 text-[10px] sm:text-xs text-[var(--text-3)] mb-2 sm:mb-3">
            <span>Proy. <span className="font-bold text-emerald-400">{formatCurrency(monthProgress.projected)}</span></span>
            <span>Prom. <span className="font-semibold text-[var(--text-2)]">{formatCurrency(monthProgress.dailyAvg)}</span>/día</span>
            <span className="hidden sm:inline">{monthProgress.daysLeft} días restantes</span>
          </div>
          <div className="w-full bg-[var(--line-soft)] rounded-full h-2.5 sm:h-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all shadow-sm shadow-emerald-500/25"
              style={{ width: `${Math.min((monthProgress.dayOfMonth / monthProgress.daysInMonth) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Summary Cards — 4 across like Toast */}
      {show('kpis') && (() => {
        // Sparkline data: last 7 days
        const spark7 = recentData.slice(-7)
        const sparkVentas = spark7.map(d => d.ventas_dia || 0)
        const sparkTickets = spark7.map(d => d.tickets_count || 0)
        const sparkPersonas = spark7.map(d => d.personas_restaurant || 0)
        const sparkTP = spark7.map(d => d.ticket_promedio_restaurant || 0)

        // Week-over-week comparison: last 7 days total vs previous 7 days total
        const thisWeek7 = recentData.slice(-7)
        const prevWeek7 = recentData.slice(-14, -7)
        const sumField = (arr: WansoftDaily[], key: keyof WansoftDaily) =>
          arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
        const avgField = (arr: WansoftDaily[], key: keyof WansoftDaily) => {
          const vals = arr.map(d => Number(d[key]) || 0).filter(v => v > 0)
          return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
        }

        const wkVentas = prevWeek7.length >= 3
          ? percentChange(sumField(thisWeek7, 'ventas_dia'), sumField(prevWeek7, 'ventas_dia'))
          : null
        const wkTickets = prevWeek7.length >= 3
          ? percentChange(sumField(thisWeek7, 'tickets_count'), sumField(prevWeek7, 'tickets_count'))
          : null
        const wkPersonas = prevWeek7.length >= 3
          ? percentChange(sumField(thisWeek7, 'personas_restaurant'), sumField(prevWeek7, 'personas_restaurant'))
          : null
        const wkTP = prevWeek7.length >= 3
          ? percentChange(avgField(thisWeek7, 'ticket_promedio_restaurant'), avgField(prevWeek7, 'ticket_promedio_restaurant'))
          : null

        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <KPICard
              label={period === 'dia' ? 'Ventas del día' : period === 'semana' ? 'Ventas semana' : 'Ventas del mes'}
              value={formatCurrency(periodData.ventas)}
              delta={`${formatPercent(ventasChange)} ${periodData.label}`}
              deltaType={ventasChange >= 0 ? 'up' : 'down'}
              icon={DollarSign}
              accentClass="kpi-accent-blue"
              sparklineData={sparkVentas}
              weekChange={wkVentas}
            />
            <KPICard
              label="Ordenes"
              value={formatNumber(periodData.tickets)}
              delta={`${formatPercent(ticketsChange)} ${periodData.label}`}
              deltaType={ticketsChange >= 0 ? 'up' : 'down'}
              icon={Ticket}
              accentClass="kpi-accent-green"
              sparklineData={sparkTickets}
              weekChange={wkTickets}
            />
            <KPICard
              label="Personas"
              value={formatNumber(periodData.personas)}
              delta={`${formatPercent(personasChange)} ${periodData.label}`}
              deltaType={personasChange >= 0 ? 'up' : 'down'}
              icon={Users}
              accentClass="kpi-accent-amber"
              sparklineData={sparkPersonas}
              weekChange={wkPersonas}
            />
            <KPICard
              label="Prom. por persona"
              value={formatCurrency(periodData.tp)}
              delta={`${formatPercent(ticketPromChange)} ${periodData.label}`}
              deltaType={ticketPromChange >= 0 ? 'up' : 'down'}
              icon={Receipt}
              accentClass="kpi-accent-purple"
              sparklineData={sparkTP}
              weekChange={wkTP}
              subtitle={`Por orden: ${formatCurrency(periodData.tpOrden || 0)}`}
            />
          </div>
        )
      })()}

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
            dataFecha={latestDay?.fecha}
          />
        )
      })()}

      {/* Extra KPI row — Propinas + Descuentos + Brutas */}
      {show('extra_kpis') && <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-gradient-to-b from-emerald-500/10 to-[var(--surface)] sm:from-[var(--surface)] sm:to-[var(--surface)] rounded-2xl border border-emerald-500/20 sm:border-[var(--line)] shadow-sm px-3 sm:px-4 py-3 sm:py-4 text-center">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center mx-auto mb-1.5 sm:mb-2">
            <Award size={14} className="text-emerald-400" />
          </div>
          <p className="text-[9px] sm:text-xs text-[var(--text-3)] font-semibold uppercase tracking-wider mb-1">Propinas</p>
          <p className="text-base sm:text-xl font-black text-emerald-400">{formatCurrency(periodData.propinas)}</p>
        </div>
        <div className="bg-gradient-to-b from-red-500/10 to-[var(--surface)] sm:from-[var(--surface)] sm:to-[var(--surface)] rounded-2xl border border-red-500/20 sm:border-[var(--line)] shadow-sm px-3 sm:px-4 py-3 sm:py-4 text-center">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center mx-auto mb-1.5 sm:mb-2">
            <TrendingDown size={14} className="text-red-400" />
          </div>
          <p className="text-[9px] sm:text-xs text-[var(--text-3)] font-semibold uppercase tracking-wider mb-1">Descuentos</p>
          <p className="text-base sm:text-xl font-black text-red-400">{formatCurrency(periodData.descuentos)}</p>
        </div>
        <div className="bg-gradient-to-b from-blue-500/10 to-[var(--surface)] sm:from-[var(--surface)] sm:to-[var(--surface)] rounded-2xl border border-blue-500/20 sm:border-[var(--line)] shadow-sm px-3 sm:px-4 py-3 sm:py-4 text-center">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center mx-auto mb-1.5 sm:mb-2">
            <DollarSign size={14} className="text-blue-400" />
          </div>
          <p className="text-[9px] sm:text-xs text-[var(--text-3)] font-semibold uppercase tracking-wider mb-1">Brutas</p>
          <p className="text-base sm:text-xl font-black text-[var(--text-1)]">{formatCurrency(periodData.brutas)}</p>
        </div>
      </div>}

      {/* Agent Status Widget — real data from agent_runs */}
      {show('agent_status') && (
        <div className="mb-4 sm:mb-6 bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
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
            (() => {
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
              return (
                <>
                {/* Mobile: horizontal scrollable chips */}
                <div className="flex sm:hidden gap-1.5 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                  {agentRuns.slice(0, 12).map(run => {
                    const name = agentNames[run.agent_id] || run.agent_id
                    const isError = run.status === 'error'
                    return (
                      <div key={run.agent_id} className={`flex items-center gap-1.5 shrink-0 rounded-full px-2.5 py-1.5 ${isError ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isError ? 'bg-red-500' : 'bg-emerald-400'}`} />
                        <span className="text-[10px] font-semibold text-[var(--text-2)] whitespace-nowrap">{name}</span>
                      </div>
                    )
                  })}
                </div>
                {/* Desktop: vertical list */}
                <div className="hidden sm:block space-y-1.5">
                  {agentRuns.slice(0, 8).map(run => {
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
                </div>
                {agentRuns.length > 8 && (
                  <a href="/agentes" className="block text-center text-xs text-[var(--accent)] hover:text-[var(--accent-bright)] py-1 mt-2">
                    Ver los {agentRuns.length} agentes →
                  </a>
                )}
                </>
              )
            })()
          )}
        </div>
      )}

      {/* Week comparison banner — like Wansoft */}
      {show('week_comparison') && vsLastWeek !== null && vsLastWeekAmount !== null && sameDayLastWeek && (
        <div className={`mb-4 sm:mb-6 rounded-xl border p-3 sm:p-4 ${vsLastWeek >= 0 ? 'bg-[var(--accent-soft)] border-[var(--accent-line)]' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              {vsLastWeek >= 0
                ? <TrendingUp size={18} className="text-[var(--accent-bright)] shrink-0" />
                : <TrendingDown size={18} className="text-red-600 shrink-0" />}
              <div>
                <p className={`font-bold text-sm sm:text-lg ${vsLastWeek >= 0 ? 'text-[var(--accent-bright)]' : 'text-red-400'}`}>
                  {formatPercent(vsLastWeek)} vs semana pasada
                </p>
                <p className="text-xs sm:text-sm text-[var(--text-2)]">
                  {vsLastWeekAmount >= 0 ? '+' : ''}{formatCurrency(vsLastWeekAmount)}
                  <span className="hidden sm:inline"> · {(() => {
                    const d = new Date(sameDayLastWeek.fecha + 'T12:00:00')
                    return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                  })()}</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] sm:text-sm text-[var(--text-2)]">7d atrás</p>
              <p className="text-sm sm:text-base font-semibold text-[var(--text-1)]">{formatCurrency(sameDayLastWeek.ventas_dia)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main chart — last 30 days, highlights selected day */}
      {show('revenue_chart') && <div className="mb-4 sm:mb-6">
        <RevenueChart
          data={recentData.slice(-30).map((d) => ({
            fecha: d.fecha,
            ventas_dia: d.ventas_dia,
          }))}
          title="Ventas últimos 30 días"
          highlightDate={viewDay?.fecha}
        />
      </div>}

      {/* Two columns: Top meseros + Categories */}
      {(show('top_meseros') || show('categories')) && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
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
                const ventasDia = latestDay?.ventas_dia || 0
                // p.total is a PERCENTAGE (e.g. 42.0 = 42%), not MXN
                const pct = p.total < 100 ? p.total : (ventasDia > 0 ? (p.total / ventasDia) * 100 : 0)
                const mxnAmount = p.total < 100 ? (p.total / 100) * ventasDia : p.total
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
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-lg font-bold text-[var(--text-1)] tabular-nums mb-2">
                      {formatCurrency(mxnAmount)}
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
      {show('quick_actions') && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { href: '/ventas', label: 'Ventas', desc: 'Detalle diario', icon: DollarSign, color: 'text-blue-400', bg: 'bg-blue-500/10', gradient: 'from-blue-500/15' },
          { href: '/meseros', label: 'Meseros', desc: 'Rankings y KPIs', icon: Award, color: 'text-[var(--accent-bright)]', bg: 'bg-emerald-500/10', gradient: 'from-emerald-500/15' },
          { href: '/cortes', label: 'Cortes', desc: 'Cierres de caja', icon: ClipboardList, color: 'text-amber-400', bg: 'bg-amber-500/10', gradient: 'from-amber-500/15' },
          { href: '/reportes', label: 'Reportes', desc: 'Exportar datos', icon: FileBarChart, color: 'text-purple-400', bg: 'bg-purple-500/10', gradient: 'from-purple-500/15' },
        ].map(action => {
          const ActionIcon = action.icon
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`bg-gradient-to-br ${action.gradient} to-[var(--surface)] sm:from-[var(--surface)] sm:to-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-3 sm:p-4 hover:shadow-md transition-all group`}
            >
              <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center mb-2 sm:mb-3 ${action.bg}`}>
                <ActionIcon size={16} className={action.color} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-[var(--text-1)] mb-0.5">{action.label}</p>
              <div className="flex items-center justify-between">
                <p className="text-[10px] sm:text-xs text-[var(--text-3)]">{action.desc}</p>
                <ArrowRight size={12} className="text-[var(--text-4)] group-hover:text-[var(--text-2)] transition-colors" />
              </div>
            </Link>
          )
        })}
      </div>}
    </>
  )
}
