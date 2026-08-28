'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DollarSign, TrendingDown, TrendingUp, Award, ArrowRight, CreditCard, FileBarChart, ClipboardList, Target, Settings, Eye, EyeOff, GripVertical, Clock, Activity, ChevronLeft, ChevronRight, CalendarDays, Building2 } from 'lucide-react'
import RevenueChart from '@/components/RevenueChart'
import RevenueDistributionChart from '@/components/RevenueDistributionChart'
import { getRecentDays, getLatestDay, getDashboardFromPosOrders, aggregateMeseros, getDeteccionesAgentes, getTurnoAbierto, type TurnoAbierto } from '@/lib/data'
import { desdeEventos, type Atencion } from '@/lib/atencion'
import EstadoOperacion from '@/components/dashboard/EstadoOperacion'
import ResumenDia from '@/components/dashboard/ResumenDia'
import QuienVendio from '@/components/dashboard/QuienVendio'
import RitmoSemana from '@/components/dashboard/RitmoSemana'
import EnVista from '@/components/ui/EnVista'
import CentroAgentes from '@/components/agentes/CentroAgentes'
import { detectar } from '@/lib/agentes/detectar'
import ListaAtencion from '@/components/dashboard/ListaAtencion'
import { formatCurrency, formatPercent, formatDate, percentChange } from '@/lib/format'
import PredictionWidget from '@/components/PredictionWidget'
import type { WansoftDaily, GrupoEntry, PagoMetodoEntry } from '@/lib/types'
import { useAuth } from '@/contexts/AuthContext'

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
//
// Aquí vivía 'agent_status', que pintaba las corridas de los agentes con su
// salida cruda: "0F 1W", "18 issues: 0 critical, 12 high", "no KPI row in
// wansoft_kpis", "lab-simulator", "smoke-test". Eso es telemetría de la
// PLATAFORMA, no información del restaurante — y además `agent_runs` no se
// filtra por tenant (son ~9,586 corridas globales), así que cada restaurante
// veía la operación de todos.
//
// Su lugar es Herramientas → Agentes IA (/mission-control), que ya lee esa misma
// tabla y cuyo propio código reconoce que es "telemetría operativa global".
const WIDGET_DEFS = [
  { id: 'insight', label: 'Insight del día', defaultOn: true },
  { id: 'month_progress', label: 'Progreso del mes', defaultOn: true },
  { id: 'kpis', label: 'KPIs principales', defaultOn: true },
  { id: 'prediction', label: 'Predicción de cierre', defaultOn: true },
  { id: 'extra_kpis', label: 'Propinas / Descuentos / Brutas', defaultOn: true },
  { id: 'week_comparison', label: 'vs Semana pasada', defaultOn: true },
  { id: 'ritmo_semana', label: 'Qué esperar hoy', defaultOn: true },
  { id: 'revenue_chart', label: 'Gráfica de ventas (30d)', defaultOn: true },
  { id: 'top_meseros', label: 'Top meseros', defaultOn: true },
  { id: 'categories', label: 'Distribución por categoría', defaultOn: false },
  { id: 'hora_pico', label: 'Mejor día y eficiencia', defaultOn: true },
  { id: 'payment_methods', label: 'Métodos de pago', defaultOn: false },
  { id: 'quick_actions', label: 'Acciones rápidas', defaultOn: false },
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
  const { clientId, locations, locationId, setLocationId } = useAuth()
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
  // Dashboard «Turno» — sólo se pinta con el piloto encendido, así que los datos
  // se piden únicamente si el flag está activo: un tenant sin piloto no paga dos
  // consultas de más en cada carga.
  const [atencion, setAtencion] = useState<Atencion[]>([])
  const [turnoAbierto, setTurnoAbierto] = useState<TurnoAbierto | null>(null)
  const [cargandoTurno, setCargandoTurno] = useState(true)

  useEffect(() => {
    let vivo = true
    Promise.all([
      getDeteccionesAgentes().catch(() => []),
      getTurnoAbierto().catch(() => null),
    ]).then(([eventos, turno]) => {
      if (!vivo) return
      setAtencion(desdeEventos(eventos))
      setTurnoAbierto(turno)
      setCargandoTurno(false)
    })
    return () => { vivo = false }
  }, [])

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
        // Fetch all data in parallel instead of sequentially
        // Ya no se pide agent_runs aquí: alimentaba el widget de status de
        // agentes, que se movió a Herramientas → Agentes IA. Era una consulta a
        // telemetría GLOBAL de la plataforma en cada carga del dashboard de cada
        // restaurante, y ninguno la usaba para decidir nada.
        const [recentRaw, latestRaw] = await Promise.all([
          Promise.race([getRecentDays(1000, clientId || undefined, locationId), timeoutP]).catch(() => [] as WansoftDaily[]),
          Promise.race([getLatestDay(clientId || undefined, locationId), timeoutP]).catch(() => null as WansoftDaily | null),
        ])
        let recent = recentRaw
        let latest = latestRaw

        // Fallback: if no wansoft_daily data, build from pos_orders
        if (recent.length === 0) {
          recent = await getDashboardFromPosOrders(30, clientId || undefined, locationId)
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
  }, [clientId, locationId])

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

  // Promedio del mismo día de la semana, para la comparación de "dia".
  //
  // BUG CORREGIDO: esto decía `.slice(0, 4)`. Pero `recentData` viene ordenado
  // de MÁS VIEJO a MÁS NUEVO (getDashboardFromPosOrders agrupa órdenes pedidas
  // con `order=created_at.asc`), así que tomaba los cuatro viernes MÁS ANTIGUOS
  // de hasta 90 días de historia — exactamente lo contrario de lo que prometía
  // el comentario "last 4 weeks". Con tres meses de historia, la tarjeta
  // comparaba el viernes de hoy contra cuatro viernes de hace tres meses y lo
  // llamaba "el promedio de los viernes". Para un negocio que crece, eso pinta
  // rojo permanente.
  //
  // `n` sale hacia afuera porque el tamaño de la muestra es parte del dato: un
  // "promedio" de un solo día no es un promedio, y la pantalla tiene que poder
  // decirlo en vez de esconderlo detrás de la palabra "prom.".
  const sameDOWAvg = (() => {
    if (!viewDay) return { ventas: 0, tickets: 0, personas: 0, tp: 0, n: 0 }
    const viewDate = new Date(viewDay.fecha + 'T12:00:00')
    const dow = viewDate.getDay()
    const sameDOW = recentData.filter(d => {
      const dt = new Date(d.fecha + 'T12:00:00')
      return dt.getDay() === dow && d.fecha !== viewDay.fecha
    }).slice(-4)
    if (sameDOW.length === 0) return { ventas: 0, tickets: 0, personas: 0, tp: 0, n: 0 }
    const avg = (key: keyof WansoftDaily) => sameDOW.reduce((s, d) => s + (Number(d[key]) || 0), 0) / sameDOW.length
    return {
      ventas: avg('ventas_dia'),
      tickets: avg('tickets_count'),
      personas: avg('personas_restaurant'),
      // TP por persona para comparar igual que el dato del dia
      tp: avg('personas_restaurant') > 0 ? avg('ventas_dia') / avg('personas_restaurant') : avg('ticket_promedio_restaurant'),
      n: sameDOW.length,
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
      // TP por persona (como el POS legado "Promedio por persona")
      const tp = personas > 0 ? Math.round(ventas / personas) : (day?.ticket_promedio_restaurant || 0)
      // TP por orden/mesa (como el POS legado "Promedio por orden")
      const tpOrden = tickets > 0 ? Math.round(ventas / tickets) : (day?.ticket_promedio_restaurant || 0)
      const propinas = day?.propinas_total || 0
      const descuentos = day?.descuentos || 0
      const brutas = day?.ventas_brutas || 0
      return { ventas, tickets, personas, tp, tpOrden, propinas, descuentos, brutas, prevVentas: sameDOWAvg.ventas, prevTickets: sameDOWAvg.tickets, prevPersonas: sameDOWAvg.personas, prevTp: sameDOWAvg.tp, label: `vs prom. ${todayDOWName}` }
    }
    if (period === 'semana') {
      const now = new Date()
      const dow = now.getDay()
      const mondayOffset = dow === 0 ? 6 : dow - 1
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - mondayOffset - weekOffset * 7)
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7)
      const prevWeekEnd = new Date(prevWeekStart); prevWeekEnd.setDate(prevWeekStart.getDate() + 6)
      const fmt = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}` }
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

  // Los cuatro `*Change` que vivían aquí alimentaban los porcentajes de las
  // tarjetas KPI anteriores. Se calculaban con percentChange(), que devuelve 0
  // cuando no hay base — y formatPercent lo pintaba como "+0.0%" en verde, o sea
  // una comparación que nunca ocurrió. ResumenDia no compara sin muestra.

  const topMeseros = (period === 'dia' ? viewDay : latestDay)
    ? aggregateMeseros([period === 'dia' ? viewDay! : latestDay!]).slice(0, 5)
    : []

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
    const dayOfMonth = thisMonthData.length > 0
      ? new Date(thisMonthData[thisMonthData.length - 1].fecha + 'T12:00:00').getDate()
      : new Date().getDate()
    const daysLeft = daysInMonth - dayOfMonth
    const dailyAvg = dayOfMonth > 0 ? monthVentas / dayOfMonth : 0
    const projected = monthVentas + (dailyAvg * daysLeft)
    const monthName = targetMonth.toLocaleDateString('es-MX', { month: 'long' })
    const yearNum = targetMonth.getFullYear()
    return { monthVentas, projected, daysLeft, dayOfMonth, daysInMonth, monthName, dailyAvg, yearNum }
  })()

  // Detecciones de los agentes, calculadas del historial de ESTE restaurante.
  //
  // No se leen de agent_events ni de agent_results: esas tablas tienen filas de
  // amalay y de boruca y CERO de coffee-shop, y el bloque que las leía acabó
  // enseñando las alertas de AMALAY aquí (P0 corregido aparte). `recentData` ya
  // viene acotado al tenant activo, así que no hay forma de que se crucen.
  const detecciones = detectar(recentData, viewDay)

  // Ritmo por día de la semana. Sale de `recentData`, que la página ya tiene:
  // no hay una consulta nueva. El patrón más fuerte de una cafetería es el día
  // de la semana y ningún widget lo mostraba.
  const ritmoSemana = (() => {
    const NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
    const acumulado = new Map<number, { ventas: number[]; cuentas: number[] }>()
    for (const d of recentData) {
      const fecha = String(d.fecha).slice(0, 10)
      // Se excluye el día que se está viendo, EXACTAMENTE como hace sameDOWAvg.
      // Si no, "un viernes normal" valía dos cosas distintas en la misma
      // pantalla: el encabezado decía $6,444 (sin el día visto) y esta tarjeta
      // $5,569 (con él). Dos promedios del viernes a 30 cm de distancia.
      if (viewDay && fecha === String(viewDay.fecha).slice(0, 10)) continue
      const dt = new Date(fecha + 'T12:00:00')
      if (isNaN(dt.getTime())) continue
      const venta = Number(d.ventas_dia) || 0
      if (venta <= 0) continue
      // ISO: 1 = lunes … 7 = domingo. getDay() da 0 para domingo.
      const iso = dt.getDay() === 0 ? 7 : dt.getDay()
      if (!acumulado.has(iso)) acumulado.set(iso, { ventas: [], cuentas: [] })
      const a = acumulado.get(iso)!
      a.ventas.push(venta)
      a.cuentas.push(Number(d.tickets_count) || 0)
    }
    return [1, 2, 3, 4, 5, 6, 7].map(dow => {
      const a = acumulado.get(dow)
      // Las últimas 4 apariciones, misma ventana que sameDOWAvg. `recentData`
      // va de viejo a nuevo, así que slice(-4) son las MÁS RECIENTES.
      const ventas = (a?.ventas ?? []).slice(-4)
      const cuentas = (a?.cuentas ?? []).slice(-4)
      const n = ventas.length
      return {
        dow,
        nombre: NOMBRES[dow - 1],
        ventaProm: n > 0 ? ventas.reduce((x, y) => x + y, 0) / n : 0,
        cuentasProm: n > 0 ? cuentas.reduce((x, y) => x + y, 0) / n : 0,
        peor: n > 0 ? Math.min(...ventas) : 0,
        mejor: n > 0 ? Math.max(...ventas) : 0,
        n,
      }
    })
  })()

  // Aquí se armaba `quickInsight`, la frase del banner morado. Sus dos partes
  // siguen en pantalla, mejor puestas: la comparación subió al encabezado de
  // ResumenDia —ahora con el tamaño de la muestra escrito— y el "cargó el N%"
  // bajó a QuienVendio, donde el porcentaje va en CADA renglón y no sólo en el
  // primero.

  // Same day last week comparison
  const sameDayLastWeek = (() => {
    if (!latestDay || recentData.length < 8) return null
    const latestDate = new Date(latestDay.fecha + 'T12:00:00')
    const targetDate = new Date(latestDate); targetDate.setDate(latestDate.getDate() - 7)
    const targetStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`
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
      {locations.length > 1 && (
        <section className="mb-5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4" aria-label="Sucursales del grupo">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Building2 size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-[var(--text-1)]">Vista del grupo</p>
                <p className="truncate text-[11px] text-[var(--text-3)]">
                  {locationId ? locations.find(loc => loc.id === locationId)?.name : `${locations.length} sucursales consolidadas`}
                </p>
              </div>
            </div>
            <Link href="/sucursales" className="shrink-0 text-[12px] font-semibold text-[var(--accent)] hover:underline">
              Comparar todas →
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" role="list">
            <button
              type="button"
              onClick={() => setLocationId(null)}
              aria-pressed={!locationId}
              className={`min-h-10 shrink-0 rounded-xl border px-3 text-left transition-colors ${!locationId ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-1)]' : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--accent)]'}`}
            >
              <span className="block text-[12px] font-bold">Todo el grupo</span>
              <span className="block text-[10px] text-[var(--text-3)]">{locations.length} sucursales</span>
            </button>
            {locations.map(loc => (
              <button
                key={loc.id}
                type="button"
                role="listitem"
                onClick={() => setLocationId(loc.id)}
                aria-pressed={locationId === loc.id}
                className={`min-h-10 shrink-0 rounded-xl border px-3 text-left transition-colors ${locationId === loc.id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-1)]' : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--accent)]'}`}
              >
                <span className="block text-[12px] font-bold">{loc.name}</span>
                <span className="block text-[10px] text-[var(--text-3)]">Ver operación</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {/* ── Dashboard «Turno» ──────────────────────────────────────────────
          Lo primero de la pantalla deja de ser "cómo vamos" y pasa a ser "qué
          hago". Va arriba del encabezado a propósito: si hay algo crítico, se
          ve antes que el selector de periodo.

          Las dos piezas se autocensuran cuando no hay nada que decir —
          ListaAtencion no renderiza sin pendientes— así que en un turno limpio
          la pantalla queda igual que antes. */}
      {(
        <>
          {/* Una sola línea de estado. Antes eran tres mensajes distintos
              diciendo el mismo hecho —la barra de turno, el aviso de sync y el
              chip del selector— y ninguno decía cuántos DÍAS lleva el POS sin
              mandar datos, que es el número que cambia la decisión. */}
          <EstadoOperacion
            turno={turnoAbierto ? {
              numero: turnoAbierto.numero ?? null,
              abiertoPor: turnoAbierto.abiertoPor ?? null,
              abiertoAt: turnoAbierto.abiertoAt ?? null,
            } : null}
            ultimaFecha={recentData.length > 0 ? String(recentData[recentData.length - 1].fecha).slice(0, 10) : null}
            hoy={new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })}
            syncTime={
              recentData.length > 0 && recentData[recentData.length - 1].updated_at
                ? new Date(recentData[recentData.length - 1].updated_at as string).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit' })
                : null
            }
            cargando={cargandoTurno}
          />
          <ListaAtencion items={atencion} cargando={cargandoTurno} />
        </>
      )}

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
                  <button onClick={() => setSelectedDayIdx(i => Math.min(i + 1, recentData.length - 1))} disabled={selectedDayIdx >= recentData.length - 1} aria-label="Día anterior" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-[var(--text-2)] font-semibold">{formatDate(viewDay.fecha)}</span>
                    {(() => {
                      const mxToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
                      const fecha = String(viewDay.fecha).slice(0, 10)
                      if (fecha === mxToday) return <span className="inline-flex items-center text-[11px] font-semibold leading-none px-2.5 py-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">HOY</span>
                      if (selectedDayIdx === 0) return <span className="inline-flex items-center text-[11px] font-semibold leading-none px-2.5 py-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)]">ÚLTIMO CIERRE</span>
                      return null
                    })()}
                  </span>
                  <button onClick={() => setSelectedDayIdx(i => Math.max(i - 1, 0))} disabled={selectedDayIdx <= 0} aria-label="Día siguiente" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center pointer-events-none">
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
              const dow2 = now.getDay()
              const mondayOff = dow2 === 0 ? 6 : dow2 - 1
              const weekStart = new Date(now)
              weekStart.setDate(now.getDate() - mondayOff - weekOffset * 7)
              const weekEnd = new Date(weekStart)
              weekEnd.setDate(weekStart.getDate() + 6)
              const label = `${weekStart.getDate()} ${MESES[weekStart.getMonth()].slice(0,3)} - ${weekEnd.getDate()} ${MESES[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`
              return (
                <div className="flex items-center gap-2">
                  <button onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 130} aria-label="Semana anterior" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="flex items-center gap-2 text-center">
                    <span className="font-mono text-[13px] text-[var(--text-2)] font-semibold">{label}</span>
                    {weekOffset === 0 && <span className="inline-flex items-center text-[11px] font-semibold leading-none px-2.5 py-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">ACTUAL</span>}
                  </span>
                  <button onClick={() => setWeekOffset(w => Math.max(w - 1, 0))} disabled={weekOffset <= 0} aria-label="Semana siguiente" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center pointer-events-none"><CalendarDays size={16} className="text-[var(--text-2)]" /></div>
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
                  <button onClick={() => setMonthOffset(m => m + 1)} disabled={monthOffset >= 36} aria-label="Mes anterior" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="flex items-center gap-2 text-center">
                    <span className="font-mono text-[13px] text-[var(--text-2)] font-semibold">{label}</span>
                    {monthOffset === 0 && <span className="inline-flex items-center text-[11px] font-semibold leading-none px-2.5 py-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">ACTUAL</span>}
                  </span>
                  <button onClick={() => setMonthOffset(m => Math.max(m - 1, 0))} disabled={monthOffset <= 0} aria-label="Mes siguiente" className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)] flex items-center justify-center transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
                  <div className="relative w-9 h-9">
                    <div className="w-9 h-9 rounded-[10px] bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center pointer-events-none"><CalendarDays size={16} className="text-[var(--text-2)]" /></div>
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
              className={`w-9 h-9 rounded-[10px] border flex items-center justify-center transition-colors ${
                showSettings
                  ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)]'
              }`}
              title="Personalizar dashboard"
              aria-label="Personalizar dashboard"
            >
              <Settings size={16} />
            </button>
          </div>
          <div className="flex gap-[2px] bg-[var(--surface-2)] border border-[var(--line)] rounded-full p-[3px]" role="tablist" aria-label="Periodo">
            {(['dia', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                role="tab"
                aria-selected={period === p}
                className={`px-4 sm:px-[13px] py-1.5 rounded-full text-xs sm:text-[12.5px] font-semibold transition-all ${
                  period === p
                    ? 'bg-[var(--panel)] text-[var(--text-1)] shadow-[var(--shadow-soft)]'
                    : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
                }`}
              >
                {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumen del día — "N cosas para hoy" (detecciones de los agentes IA) */}
      {/* Fuera del piloto sigue el briefing de siempre. Dentro, el centro nuevo:
          frases con verbo, dinero a la derecha, y evidencia al hacer clic. */}
      <CentroAgentes detecciones={detecciones} cargando={loading} />

      {/* Data freshness: warn when showing a past day as the default view, show sync time for today */}

      {/* Settings panel — toggle widgets */}
      {showSettings && (
        <div className="mb-6 rounded-[14px] border border-[var(--line)] p-[18px] animate-in slide-in-from-top-2" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-[9px]">
              <span className="w-7 h-7 rounded-[9px] grid place-items-center bg-[var(--surface-2)] text-[var(--text-2)]">
                <Settings size={14} />
              </span>
              <h3 className="text-sm font-bold text-[var(--text-1)]">Personalizar dashboard</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-[11px] text-[var(--text-3)]">{WIDGET_DEFS.length} widgets · el gerente elige qué ver</span>
              <button onClick={() => setShowSettings(false)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)]">
                Cerrar
              </button>
            </div>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {WIDGET_DEFS.map(w => (
              <button
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                className={`flex items-center gap-2 px-[11px] py-[9px] rounded-[10px] text-left text-xs font-semibold transition-all border ${
                  widgets[w.id]
                    ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)]'
                    : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text-3)]'
                }`}
              >
                {widgets[w.id] ? <Eye size={13} className="shrink-0" /> : <EyeOff size={13} className="shrink-0" />}
                <span className="truncate">{w.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick insight */}
      {/* ── Resumen del día (piloto) ─────────────────────────────────────
          Sustituye tres bloques que se peleaban por la misma atención: las 4
          tarjetas KPI con su mini-gráfica y sus dos porcentajes, la fila de
          Propinas/Descuentos/Brutas, y el banner morado del insight.

          Ningún dato se pierde. La comparación del insight sube al encabezado
          —ahora con el tamaño de la muestra escrito— y el "cargó el N%" baja a
          QuienVendio, donde el porcentaje va en CADA renglón y no sólo en el
          primero. "Brutas" deja de ser un duplicado de "Ventas del día"
          (ventas_brutas = ventas + descuentos) y vuelve a ser lo que es: el
          primer renglón de un desglose que suma hasta lo que entró a la caja.

          Se respetan los interruptores del panel de personalización. */}
      {(show('kpis') || show('extra_kpis')) && (() => {
        const mxToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
        const fechaVista = viewDay ? String(viewDay.fecha).slice(0, 10) : null

        // `periodData` normaliza todo a 0 con `|| 0`. ResumenDia tiene una guarda
        // —"un dato ausente es un guion, nunca un cero"— que NUNCA se ejecutaba,
        // porque el cero le llegaba antes. Resultado en un restaurante nuevo:
        // "$0" en 46 px en vez de "—", que es exactamente el defecto que ese
        // componente vino a quitar.
        //
        // Sin día no hay datos que enseñar. Con día, el cero SÍ es legítimo: un
        // día real con cero ventas es información.
        const hayDia = period !== 'dia' ? recentData.length > 0 : !!viewDay
        const oNada = (v: number) => (hayDia ? v : null)

        return (
          <ResumenDia
            fecha={fechaVista}
            esUltimoCierre={period === 'dia' && !!fechaVista && fechaVista !== mxToday && selectedDayIdx === 0}
            periodo={period}
            ventas={oNada(periodData.ventas)}
            ordenes={oNada(periodData.tickets)}
            personas={oNada(periodData.personas)}
            ticketPersona={oNada(periodData.tp)}
            ticketOrden={oNada(periodData.tpOrden)}
            propinas={oNada(periodData.propinas)}
            descuentos={oNada(periodData.descuentos)}
            promedioMismoDia={periodData.prevVentas}
            muestraMismoDia={period === 'dia' ? sameDOWAvg.n : 1}
            tipoComparacion={period === 'dia' ? 'promedio' : 'periodo'}
            etiquetaComparacion={
              period === 'dia'
                ? (todayDOWName ? `los ${todayDOWName.toLowerCase()}` : 'días iguales')
                : period === 'semana' ? 'la semana anterior'
                : 'el mes anterior'
            }
            mostrarDinero={show('extra_kpis')}
          />
        )
      })()}

      {/* Qué esperar hoy — la pieza nueva. Contesta "¿con cuánta gente abro?",
          que es la decisión que un dueño toma antes de abrir la cortina y que
          ninguno de los 13 widgets contestaba. */}
      {show('ritmo_semana') && (
        <RitmoSemana
          filas={ritmoSemana}
          hoyDow={(() => {
            const hoyMX = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
            const d = new Date(hoyMX + 'T12:00:00')
            return d.getDay() === 0 ? 7 : d.getDay()
          })()}
        />
      )}


      {/* Month progress — premium card */}
      {show('month_progress') && monthProgress && monthProgress.monthVentas > 0 && (
        <div className="mb-4 sm:mb-6 bg-gradient-to-br from-emerald-500/10 via-[var(--panel)] to-[var(--surface-2)] rounded-[18px] border border-[var(--accent-line)] px-4 sm:px-5 py-4 sm:py-[18px]" style={{ boxShadow: 'var(--shadow-mid)' }}>
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <div className="flex items-center gap-[9px]">
              <div className="w-7 h-7 rounded-[9px] grid place-items-center bg-[var(--accent-soft)] text-[var(--accent-bright)]">
                <Target size={15} />
              </div>
              <span className="text-[15px] font-bold text-[var(--text-1)]">
                {monthProgress.monthName.charAt(0).toUpperCase() + monthProgress.monthName.slice(1)} {monthProgress.yearNum}
              </span>
            </div>
            <span className="inline-flex items-center text-[11px] leading-none px-2.5 py-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">
              Día {monthProgress.dayOfMonth}/{monthProgress.daysInMonth}
            </span>
          </div>
          <p className="text-[28px] sm:text-[34px] font-black tracking-[-0.03em] text-[var(--text-1)] tnum mb-1.5">{formatCurrency(monthProgress.monthVentas)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-3)] mb-3">
            <span>Proy. <span className="font-bold text-[var(--accent-ink)] tnum">{formatCurrency(monthProgress.projected)}</span></span>
            <span>Prom. <span className="font-semibold text-[var(--text-2)] tnum">{formatCurrency(monthProgress.dailyAvg)}</span>/día</span>
            <span className="hidden sm:inline">{monthProgress.daysLeft} días restantes</span>
          </div>
          <div className="w-full bg-[var(--line-soft)] rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent-deep)] to-[var(--accent-bright)] transition-all"
              style={{ width: `${Math.min((monthProgress.dayOfMonth / monthProgress.daysInMonth) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Summary Cards — 4 across like Toast */}

      {/* Prediction Widget */}
      {show('prediction') && period === 'dia' && (() => {
        const today = latestDay?.fecha || ''
        const todayDate = today ? new Date(today + 'T12:00:00') : new Date()
        const todayDow = todayDate.getDay()
        const yesterdayDate = new Date(todayDate); yesterdayDate.setDate(todayDate.getDate() - 1)
        const fmtLocal = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
        const yesterdayStr = fmtLocal(yesterdayDate)
        const lastWeekDate = new Date(todayDate); lastWeekDate.setDate(todayDate.getDate() - 7)
        const lastWeekStr = fmtLocal(lastWeekDate)

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

      {/* Agent Status Widget — real data from agent_runs */}

      {/* Week comparison banner — like el POS legado */}
      {show('week_comparison') && vsLastWeek !== null && vsLastWeekAmount !== null && sameDayLastWeek && (
        <div className={`mb-4 sm:mb-6 rounded-[14px] border px-4 py-3.5 sm:px-[18px] ${vsLastWeek >= 0 ? 'bg-[var(--accent-soft)] border-[var(--accent-line)]' : 'bg-[var(--crit-soft)] border-[color-mix(in_srgb,var(--crit)_40%,transparent)]'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-[11px]">
              {vsLastWeek >= 0
                ? <TrendingUp size={20} className="text-[var(--accent-bright)] shrink-0" strokeWidth={2.2} />
                : <TrendingDown size={20} className="text-[var(--crit-ink)] shrink-0" strokeWidth={2.2} />}
              <div>
                <p className={`font-extrabold text-sm sm:text-base ${vsLastWeek >= 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--crit-ink)]'}`}>
                  {formatPercent(vsLastWeek)} vs semana pasada
                </p>
                <p className="text-[12.5px] text-[var(--text-2)]">
                  {vsLastWeekAmount >= 0 ? '+' : ''}{formatCurrency(vsLastWeekAmount)}
                  <span className="hidden sm:inline"> · {(() => {
                    const d = new Date(sameDayLastWeek.fecha + 'T12:00:00')
                    return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                  })()}</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] sm:text-[11px] text-[var(--text-3)]">7d atrás</p>
              <p className="text-sm sm:text-[15px] font-bold text-[var(--text-1)] tnum">{formatCurrency(sameDayLastWeek.ventas_dia)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main chart — last 30 days, highlights selected day */}
      {/* Se monta cuando entra en pantalla, no al cargar la página. Recharts
          anima AL MONTAR, así que montándola junto con todo lo demás la
          animación terminaba antes de que bajaras a verla. */}
      {show('revenue_chart') && (
        <EnVista minAlto={300} className="mb-4 sm:mb-6">
          <RevenueChart
            data={recentData.slice(-30).map((d) => ({
              fecha: d.fecha,
              ventas_dia: d.ventas_dia,
            }))}
            title="Ventas últimos 30 días"
            highlightDate={viewDay?.fecha}
          />
        </EnVista>
      )}

      {/* Two columns: Top meseros + Categories */}
      {(show('top_meseros') || show('categories')) && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Top meseros — R365 style with progress bars */}

        {/* Quién vendió (piloto). La barra pasa a medirse contra el TOTAL y no
            contra el primer lugar: con `m.total / topMeseroMax` el primero
            llenaba SIEMPRE la barra completa, así que un reparto 51/49 se veía
            igual que uno 95/5. Y el porcentaje va en cada renglón, que es donde
            se comprueba, en vez de sólo en el banner morado de arriba. */}
        {show('top_meseros') && (
          <QuienVendio filas={topMeseros} totalPeriodo={periodData.ventas} />
        )}

        {/* Categories — horizontal bars */}
        {show('categories') && (
          <EnVista minAlto={320}>
            <RevenueDistributionChart
              data={gruposData}
              title="Distribución por categoría"
            />
          </EnVista>
        )}
      </div>}

      {/* Payment methods */}
      {show('payment_methods') && <div className="mb-6">
        <div className="rounded-[14px] border border-[var(--line)] p-[18px]" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
          <div className="flex items-center gap-[9px] mb-0.5">
            <div className="w-7 h-7 rounded-[9px] grid place-items-center bg-violet-500/12 text-violet-300">
              <CreditCard size={14} />
            </div>
            <h3 className="text-sm font-bold text-[var(--text-1)]">
              Métodos de pago
            </h3>
          </div>
          <p className="text-[11px] text-[var(--text-3)] mb-4 ml-[37px]">
            {latestDay ? formatCurrency(latestDay.ventas_dia) : '-'} total
          </p>
          {paymentMethods.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {paymentMethods.map((p, i) => {
                const ventasDia = latestDay?.ventas_dia || 0
                // p.total is an MXN amount
                const pct = ventasDia > 0 ? (p.total / ventasDia) * 100 : 0
                const mxnAmount = p.total
                const barWidth = paymentMax > 0 ? ((p.total / paymentMax) * 100) : 0
                const barColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4']
                return (
                  <div key={p.nombre} className="bg-[var(--surface-2)] border border-[var(--line)] rounded-xl p-[13px]">
                    <div className="flex items-center justify-between mb-[7px]">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: barColors[i % barColors.length] }}
                        />
                        <span className="text-[12.5px] font-semibold text-[var(--text-1)]">
                          {p.nombre}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--text-3)] font-mono">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-[17px] font-extrabold tracking-[-0.02em] text-[var(--text-1)] tabular-nums mb-2">
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
          <div className="rounded-[14px] border border-[var(--line)] p-[18px]" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
            <div className="flex items-center gap-[9px] mb-3">
              <div className="w-7 h-7 rounded-[9px] grid place-items-center bg-[var(--warn-soft)] text-[var(--warn-ink)]">
                <Clock size={15} />
              </div>
              <h3 className="text-sm font-bold text-[var(--text-1)]">Mejor día de la semana</h3>
            </div>
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[30px] font-extrabold tracking-[-0.02em] text-[var(--text-1)] capitalize leading-none">
                {(() => {
                  const peak = recentData.slice(-7).reduce((best, d) => {
                    const m = d.meseros as unknown as Array<{ nombre: string; total: number }>
                    const total = Array.isArray(m) ? m.reduce((s, x) => s + (x.total || 0), 0) : 0
                    return total > best.total ? { total, fecha: d.fecha } : best
                  }, { total: 0, fecha: '' })
                  return peak.fecha ? new Date(peak.fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long' }) : '-'
                })()}
              </span>
              <span className="text-[12.5px] text-[var(--text-3)]">últimos 7 días</span>
            </div>
            <div className="mt-3 flex items-center gap-[22px] text-[12.5px]">
              <div>
                <span className="text-[var(--text-3)]">Mesas/día:</span>
                <span className="ml-[3px] font-bold text-[var(--text-1)] tnum">{latestDay.mesas_atendidas || 0}</span>
              </div>
              <div>
                <span className="text-[var(--text-3)]">Para llevar:</span>
                <span className="ml-[3px] font-bold text-[var(--text-1)] tnum">{latestDay.ordenes_llevar || 0}</span>
              </div>
            </div>
          </div>

          {/* Efficiency metrics */}
          <div className="rounded-[14px] border border-[var(--line)] p-[18px]" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
            <div className="flex items-center gap-[9px] mb-2">
              <div className="w-7 h-7 rounded-[9px] grid place-items-center" style={{ background: 'rgba(34,211,238,.12)', color: '#67e8f9' }}>
                <Activity size={15} />
              </div>
              <h3 className="text-sm font-bold text-[var(--text-1)]">Eficiencia del día</h3>
            </div>
            <div>
              {[
                { label: 'Venta por persona', value: latestDay.personas_restaurant ? formatCurrency((latestDay.ventas_dia || 0) / latestDay.personas_restaurant) : '—' },
                // `mesas_atendidas` viene NULL en TODOS los días de AMALAY, y el
                // `|| 1` de antes lo convertía en 1: la tarjeta mostraba la venta del
                // día ENTERO como si fuera lo de una sola mesa ($39,505). Sin dato se
                // dice que no hay dato; un guion es honesto, un número inventado no.
                { label: 'Venta por mesa', value: latestDay.mesas_atendidas ? formatCurrency((latestDay.ventas_dia || 0) / latestDay.mesas_atendidas) : '—' },
                { label: 'Propina promedio', value: latestDay.mesas_atendidas ? formatCurrency((latestDay.propinas_total || 0) / latestDay.mesas_atendidas) : '—' },
                { label: 'Descuento %', value: latestDay.ventas_brutas ? `${((latestDay.descuentos || 0) / latestDay.ventas_brutas * 100).toFixed(1)}%` : '—' },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between py-[9px] border-b border-[var(--line-soft)] last:border-b-0 text-[13.5px]">
                  <span className="text-[var(--text-2)]">{m.label}</span>
                  <span className="font-bold text-[var(--text-1)] tabular-nums">{m.value}</span>
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
              className="rounded-xl border border-[var(--line)] p-3 sm:p-3.5 hover:border-[var(--accent-line)] transition-all group active:scale-[0.98]"
              style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-soft)' }}
            >
              <div className={`w-8 h-8 sm:w-[34px] sm:h-[34px] rounded-[10px] grid place-items-center mb-2 sm:mb-2.5 ${action.bg}`}>
                <ActionIcon size={17} className={action.color} />
              </div>
              <p className="text-xs sm:text-sm font-bold text-[var(--text-1)] mb-0.5">{action.label}</p>
              <div className="flex items-center justify-between">
                <p className="text-[10px] sm:text-[11px] text-[var(--text-3)]">{action.desc}</p>
                <ArrowRight size={13} className="text-[var(--text-4)] group-hover:text-[var(--text-2)] transition-colors" />
              </div>
            </Link>
          )
        })}
      </div>}
    </>
  )
}
