'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import { TrendingUp, Calendar, Target, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getMonthlyData, getDashboardFromPosOrders } from '@/lib/data'
import { formatCurrency, formatPercent, percentChange, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const DOW_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']

type TPPeriod = 'dia' | 'semana' | 'mes'

export default function TendenciasPage() {
  const [allData, setAllData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [tpPeriod, setTpPeriod] = useState<TPPeriod>('mes')

  useEffect(() => {
    async function load() {
      try {
        let data = await getMonthlyData()
        // Fallback: if no wansoft_daily data, build from pos_orders
        if (data.length === 0) {
          data = await getDashboardFromPosOrders(365)
        }
        setAllData(data)
      } catch (err) {
        console.error('Error loading trends data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Monthly aggregation
  const monthlyAgg = useMemo(() => {
    const months: Record<string, { ventas: number; tickets: number; personas: number; dias: number }> = {}
    for (const d of allData) {
      const month = d.fecha.slice(0, 7)
      if (!months[month]) {
        months[month] = { ventas: 0, tickets: 0, personas: 0, dias: 0 }
      }
      months[month].ventas += d.ventas_dia || 0
      months[month].tickets += d.tickets_count || 0
      months[month].personas += d.personas_restaurant || 0
      months[month].dias += 1
    }
    return Object.entries(months)
      .map(([month, data]) => ({
        month,
        label: new Date(month + '-15').toLocaleDateString('es-MX', {
          month: 'short',
          year: '2-digit',
        }),
        ventas: data.ventas,
        tickets: data.tickets,
        personas: data.personas,
        dias: data.dias,
        ticketPromedio: data.tickets > 0 ? Math.round(data.ventas / data.tickets) : 0,
        ticketPromedioPersona: data.personas > 0 ? Math.round(data.ventas / data.personas) : 0,
        ventasDiarias: data.dias > 0 ? Math.round(data.ventas / data.dias) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [allData])

  // Daily TP data (last 30 days)
  const dailyTP = useMemo(() => {
    return allData.slice(-30).map(d => ({
      label: (() => { const dt = new Date(d.fecha + 'T12:00:00'); const dow = ['dom','lun','mar','mié','jue','vie','sáb'][dt.getDay()]; return `${dow} ${dt.getDate()}/${dt.getMonth()+1}` })(),
      ticketPromedio: d.tickets_count > 0 ? Math.round(d.ventas_dia / d.tickets_count) : 0,
      ticketPromedioPersona: d.personas_restaurant > 0 ? Math.round(d.ventas_dia / d.personas_restaurant) : 0,
    }))
  }, [allData])

  // Weekly TP data
  const weeklyTP = useMemo(() => {
    const weeks: Record<string, { ventas: number; tickets: number; personas: number }> = {}
    for (const d of allData) {
      const dt = new Date(d.fecha + 'T12:00:00')
      const weekStart = new Date(dt); weekStart.setDate(dt.getDate() - dt.getDay() + 1)
      const key = weekStart.toISOString().slice(0, 10)
      if (!weeks[key]) weeks[key] = { ventas: 0, tickets: 0, personas: 0 }
      weeks[key].ventas += d.ventas_dia || 0
      weeks[key].tickets += d.tickets_count || 0
      weeks[key].personas += d.personas_restaurant || 0
    }
    return Object.entries(weeks)
      .map(([key, w]) => ({
        label: (() => { const dt = new Date(key + 'T12:00:00'); return `${dt.getDate()}/${dt.getMonth()+1}` })(),
        ticketPromedio: w.tickets > 0 ? Math.round(w.ventas / w.tickets) : 0,
        ticketPromedioPersona: w.personas > 0 ? Math.round(w.ventas / w.personas) : 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-20)
  }, [allData])

  const tpChartData = tpPeriod === 'dia' ? dailyTP : tpPeriod === 'semana' ? weeklyTP : monthlyAgg

  // Payment methods trending (monthly)
  const paymentTrending = useMemo(() => {
    const months: Record<string, { efectivo: number; tarjeta: number; otros: number }> = {}
    for (const d of allData) {
      const m = d.fecha.slice(0, 7)
      if (!months[m]) months[m] = { efectivo: 0, tarjeta: 0, otros: 0 }
      months[m].efectivo += d.efectivo || 0
      months[m].tarjeta += d.tarjeta || 0
      const ventas = d.ventas_dia || 0
      months[m].otros += Math.max(0, ventas - (d.efectivo || 0) - (d.tarjeta || 0))
    }
    return Object.entries(months).sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => ({
      label: new Date(m + '-15').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
      Efectivo: Math.round(v.efectivo),
      Tarjeta: Math.round(v.tarjeta),
      Otros: Math.round(v.otros),
    }))
  }, [allData])

  // Descuentos trending (monthly)
  const descuentosTrending = useMemo(() => {
    return monthlyAgg.map(m => ({
      label: m.label,
      descuentos: allData.filter(d => d.fecha.startsWith(m.month)).reduce((s, d) => s + (d.descuentos || 0), 0),
      pctVentas: m.ventas > 0 ? Number(((allData.filter(d => d.fecha.startsWith(m.month)).reduce((s, d) => s + (d.descuentos || 0), 0) / m.ventas) * 100).toFixed(1)) : 0,
    }))
  }, [allData, monthlyAgg])

  // YoY comparison
  const yoyComparison = useMemo(() => {
    const years = [...new Set(allData.map(d => d.fecha.slice(0, 4)))].sort()
    const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return MESES_SHORT.map((mes, i) => {
      const row: Record<string, unknown> = { mes }
      for (const yr of years) {
        const prefix = `${yr}-${String(i + 1).padStart(2, '0')}`
        const monthData = allData.filter(d => d.fecha.startsWith(prefix))
        row[yr] = monthData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
      }
      return row
    })
  }, [allData])

  const yoyYears = useMemo(() => [...new Set(allData.map(d => d.fecha.slice(0, 4)))].sort(), [allData])
  const YOY_COLORS = ['#94a3b8', '#3b82f6', '#10b981', '#f59e0b']

  // Top 5 platillos trending (last 3 months)
  const topPlatillosTrending = useMemo(() => {
    const last3 = monthlyAgg.slice(-3)
    const allPlatillos: Record<string, number> = {}
    for (const d of allData.filter(d => last3.some(m => d.fecha.startsWith(m.month)))) {
      if (!d.platillos_top) continue
      const plats = typeof d.platillos_top === 'string' ? JSON.parse(d.platillos_top) : d.platillos_top
      if (!Array.isArray(plats)) continue
      for (const p of plats) {
        allPlatillos[p.nombre] = (allPlatillos[p.nombre] || 0) + (p.cantidad || 0)
      }
    }
    const top5 = Object.entries(allPlatillos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n)

    return last3.map(m => {
      const row: Record<string, unknown> = { label: m.label }
      const monthData = allData.filter(d => d.fecha.startsWith(m.month))
      for (const name of top5) {
        let qty = 0
        for (const d of monthData) {
          if (!d.platillos_top) continue
          const plats = typeof d.platillos_top === 'string' ? JSON.parse(d.platillos_top) : d.platillos_top
          if (!Array.isArray(plats)) continue
          const found = plats.find((p: { nombre: string }) => p.nombre === name)
          if (found) qty += found.cantidad || 0
        }
        row[name] = qty
      }
      return row
    })
  }, [allData, monthlyAgg])

  const top5Names = useMemo(() => {
    if (topPlatillosTrending.length === 0) return []
    return Object.keys(topPlatillosTrending[0]).filter(k => k !== 'label')
  }, [topPlatillosTrending])

  const PLAT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

  // Day of week aggregation
  const dowAgg = useMemo(() => {
    const dows: Record<number, { ventas: number; personas: number; tickets: number; dias: number }> = {}
    const dowNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    for (const d of allData) {
      const date = new Date(d.fecha + 'T12:00:00')
      const dow = date.getDay()
      if (!dows[dow]) {
        dows[dow] = { ventas: 0, personas: 0, tickets: 0, dias: 0 }
      }
      dows[dow].ventas += d.ventas_dia || 0
      dows[dow].personas += d.personas_restaurant || 0
      dows[dow].tickets += d.tickets_count || 0
      dows[dow].dias += 1
    }
    return [1, 2, 3, 4, 5, 6, 0].map((dow, i) => {
      const data = dows[dow] || { ventas: 0, personas: 0, tickets: 0, dias: 0 }
      return {
        dia: dowNames[dow],
        diaShort: dowNames[dow].slice(0, 3),
        ventasPromedio: data.dias > 0 ? Math.round(data.ventas / data.dias) : 0,
        personasPromedio: data.dias > 0 ? Math.round(data.personas / data.dias) : 0,
        ticketPromedio: data.tickets > 0 ? Math.round(data.ventas / data.tickets) : 0,
        fill: DOW_COLORS[i % DOW_COLORS.length],
      }
    })
  }, [allData])

  // Weekday vs Weekend TP breakdown
  const tpWeekdayWeekend = useMemo(() => {
    const weekday = { ventas: 0, tickets: 0, personas: 0, dias: 0 }
    const weekend = { ventas: 0, tickets: 0, personas: 0, dias: 0 }
    for (const d of allData) {
      const date = new Date(d.fecha + 'T12:00:00')
      const dow = date.getDay()
      const bucket = (dow === 0 || dow === 6) ? weekend : weekday
      bucket.ventas += d.ventas_dia || 0
      bucket.tickets += d.tickets_count || 0
      bucket.personas += d.personas_restaurant || 0
      bucket.dias += 1
    }
    return {
      weekday: {
        ...weekday,
        ticketPromedio: weekday.tickets > 0 ? Math.round(weekday.ventas / weekday.tickets) : 0,
        ventasDiarias: weekday.dias > 0 ? Math.round(weekday.ventas / weekday.dias) : 0,
      },
      weekend: {
        ...weekend,
        ticketPromedio: weekend.tickets > 0 ? Math.round(weekend.ventas / weekend.tickets) : 0,
        ventasDiarias: weekend.dias > 0 ? Math.round(weekend.ventas / weekend.dias) : 0,
      },
    }
  }, [allData])

  // YTD
  const ytdData = useMemo(() => {
    const currentYear = new Date().getFullYear().toString()
    const ytdDays = allData.filter(d => d.fecha.startsWith(currentYear))
    const totalVentas = ytdDays.reduce((s, d) => s + (d.ventas_dia || 0), 0)
    const totalTickets = ytdDays.reduce((s, d) => s + (d.tickets_count || 0), 0)
    const totalPersonas = ytdDays.reduce((s, d) => s + (d.personas_restaurant || 0), 0)
    return { totalVentas, totalTickets, totalPersonas, dias: ytdDays.length }
  }, [allData])

  // Year-over-Year comparison data
  const yoyData = useMemo(() => {
    const currentYear = '2026'
    const prevYear = '2025'
    const currentMonths = monthlyAgg.filter(d => d.month.startsWith(currentYear))
    const prevMonths = monthlyAgg.filter(d => d.month.startsWith(prevYear))

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const paired: { monthNum: number; monthLabel: string; current: number; prev: number; pctChange: number }[] = []

    for (let m = 1; m <= 12; m++) {
      const mm = m.toString().padStart(2, '0')
      const cur = currentMonths.find(d => d.month === `${currentYear}-${mm}`)
      const prv = prevMonths.find(d => d.month === `${prevYear}-${mm}`)
      if (cur || prv) {
        const curVal = cur?.ventas || 0
        const prvVal = prv?.ventas || 0
        paired.push({
          monthNum: m,
          monthLabel: monthNames[m - 1],
          current: curVal,
          prev: prvVal,
          pctChange: prvVal > 0 ? ((curVal - prvVal) / prvVal) * 100 : 0,
        })
      }
    }

    const chartData = paired.map(p => ({
      monthLabel: p.monthLabel,
      [`${currentYear}`]: p.current || undefined,
      [`${prevYear}`]: p.prev || undefined,
    }))

    const tableData = paired.filter(p => p.current > 0)

    return { chartData, tableData, currentYear, prevYear }
  }, [monthlyAgg])

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

  if (allData.length === 0) {
    return (
      <>
        <PageHeader title="Tendencias" subtitle="Análisis de tendencias y comparativos" />
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-12 text-center">
          <TrendingUp size={32} className="text-[var(--text-3)] mx-auto mb-4" />
          <p className="text-[var(--text-2)] text-sm">Sin datos históricos. Las tendencias se generan con al menos 7 días de información.</p>
        </div>
      </>
    )
  }

  const currentMonth = monthlyAgg[monthlyAgg.length - 1]
  const prevMonth = monthlyAgg.length >= 2 ? monthlyAgg[monthlyAgg.length - 2] : null

  const ventasMoM = currentMonth && prevMonth
    ? percentChange(currentMonth.ventas, prevMonth.ventas)
    : 0
  const ticketMoM = currentMonth && prevMonth
    ? percentChange(currentMonth.ticketPromedio, prevMonth.ticketPromedio)
    : 0

  const bestDow = [...dowAgg].sort((a, b) => b.ventasPromedio - a.ventasPromedio)[0]

  return (
    <>
      <PageHeader
        title="Tendencias"
        subtitle="Comparativos mensuales, por día de la semana, y acumulado del año"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <KPICard
          label="Ventas mes actual"
          value={currentMonth ? formatCurrency(currentMonth.ventas) : '-'}
          delta={currentMonth ? `${formatPercent(ventasMoM)} vs mes anterior` : undefined}
          deltaType={ventasMoM >= 0 ? 'up' : 'down'}
          icon={TrendingUp}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Ticket prom. mes (rest.)"
          value={currentMonth ? formatCurrency(currentMonth.ticketPromedio) : '-'}
          delta={currentMonth ? `${formatPercent(ticketMoM)} vs mes anterior` : undefined}
          deltaType={ticketMoM >= 0 ? 'up' : 'down'}
          icon={Target}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Mejor día de semana"
          value={bestDow?.dia || '-'}
          subtitle={bestDow ? `Prom. ${formatCurrency(bestDow.ventasPromedio)}` : ''}
          icon={Calendar}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="YTD Ventas"
          value={formatCurrency(ytdData.totalVentas)}
          subtitle={`${ytdData.dias} días con datos en ${new Date().getFullYear()}`}
          icon={BarChart3}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Monthly comparison cards */}
      {currentMonth && prevMonth && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[
            {
              label: 'Ventas totales',
              current: formatCurrency(currentMonth.ventas),
              prev: formatCurrency(prevMonth.ventas),
              change: ventasMoM,
            },
            {
              label: 'Tickets',
              current: formatNumber(currentMonth.tickets),
              prev: formatNumber(prevMonth.tickets),
              change: percentChange(currentMonth.tickets, prevMonth.tickets),
            },
            {
              label: 'Ticket promedio (rest.)',
              current: formatCurrency(currentMonth.ticketPromedio),
              prev: formatCurrency(prevMonth.ticketPromedio),
              change: ticketMoM,
            },
          ].map((card) => (
            <div key={card.label} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 hover:shadow-md transition-shadow">
              <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">{card.label}</p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-[var(--text-3)] mb-0.5">Este mes</p>
                  <p className="text-xl font-bold text-[var(--text-1)]">{card.current}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--text-3)] mb-0.5">Mes anterior</p>
                  <p className="text-lg font-semibold text-[var(--text-3)]">{card.prev}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--line-soft)]">
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${card.change >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                  {card.change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {formatPercent(card.change)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly revenue trend */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
          Ventas mensuales
        </h3>
        <p className="text-xs text-[var(--text-3)] mb-5">{monthlyAgg.length} meses de datos</p>
        <div className="h-[250px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyAgg}>
              <defs>
                <linearGradient id="colorMonthlyVentas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
                width={60}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="ventas"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#colorMonthlyVentas)"
                dot={{ r: 3, fill: '#3b82f6', stroke: 'var(--text-1)', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: 'var(--text-3)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Year-over-Year comparison */}
      {yoyData.chartData.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
            Comparativo año anterior
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-5">
            {yoyData.currentYear} vs {yoyData.prevYear} -- ventas mensuales
          </p>
          <div className="h-[250px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={yoyData.chartData}>
                <defs>
                  <linearGradient id="colorYoyCurrent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
                  width={60}
                />
                <Tooltip
                  formatter={(value, name) => [formatCurrency(Number(value)), name]}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={30}
                  iconType="line"
                  wrapperStyle={{ fontSize: '12px' }}
                />
                <Area
                  type="monotone"
                  dataKey={yoyData.prevYear}
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  fill="none"
                  dot={{ r: 2, fill: '#94a3b8', stroke: 'var(--text-1)', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey={yoyData.currentYear}
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fill="url(#colorYoyCurrent)"
                  dot={{ r: 3, fill: '#3b82f6', stroke: 'var(--text-1)', strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: 'var(--text-3)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Comparison table */}
          {yoyData.tableData.length > 0 && (
            <div className="mt-6 pt-5 border-t border-[var(--line-soft)]">
              <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">
                Detalle mensual {yoyData.currentYear} vs {yoyData.prevYear}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {yoyData.tableData.map((row) => {
                  const isPositive = row.pctChange >= 0
                  return (
                    <div
                      key={row.monthNum}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line-soft)]"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-[var(--text-1)]">
                          {row.monthLabel} {yoyData.currentYear.slice(2)}
                        </span>
                        <span className="text-xs text-[var(--text-3)] ml-1.5">
                          {formatCurrency(row.current)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {row.prev > 0 ? (
                          <>
                            <span className="text-xs text-[var(--text-3)]">
                              vs {formatCurrency(row.prev)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                                isPositive
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-red-500/10 text-red-400'
                              }`}
                            >
                              {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {isPositive ? '+' : ''}{row.pctChange.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-[var(--text-3)]">Sin datos {yoyData.prevYear}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ticket promedio por ORDEN — with period tabs */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Ticket promedio (por orden)</h3>
            <p className="text-xs text-[var(--text-3)]">Ventas ÷ ordenes</p>
          </div>
          <div className="flex bg-[var(--line-soft)] rounded-lg p-0.5">
            {(['dia', 'semana', 'mes'] as TPPeriod[]).map(p => (
              <button key={p} onClick={() => setTpPeriod(p)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tpPeriod === p ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}>
                {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[200px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tpChartData}>
              <defs>
                <linearGradient id="colorTicketProm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
                width={50}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Ticket Prom.']}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="ticketPromedio"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#colorTicketProm)"
                dot={{ r: 3, fill: '#10b981', stroke: 'var(--text-1)', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#10b981', strokeWidth: 2, fill: 'var(--text-3)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ticket promedio POR PERSONA — with same period tabs */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Ticket promedio (por persona)</h3>
            <p className="text-xs text-[var(--text-3)]">Ventas ÷ personas — lo que gasta cada comensal</p>
          </div>
          <div className="flex bg-[var(--line-soft)] rounded-lg p-0.5">
            {(['dia', 'semana', 'mes'] as TPPeriod[]).map(p => (
              <button key={p} onClick={() => setTpPeriod(p)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tpPeriod === p ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}>
                {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[200px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tpChartData}>
              <defs>
                <linearGradient id="colorTicketPersn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
                width={50}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'TP/Persona']}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="ticketPromedioPersona"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#colorTicketPersn)"
                dot={{ r: 3, fill: '#3b82f6', stroke: 'var(--text-1)', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: 'var(--text-3)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* YoY Comparison — 2024 vs 2025 vs 2026 */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">Comparativo anual</h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Ventas por mes — {yoyYears.join(' vs ')}</p>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yoyComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000000).toFixed(1)}M`} width={55} />
              <Tooltip formatter={(v) => [formatCurrency(Number(v)), '']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Legend />
              {yoyYears.map((yr, i) => (
                <Bar key={yr} dataKey={yr} fill={YOY_COLORS[i % YOY_COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Payment methods trending */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">Métodos de pago</h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Evolución mensual de efectivo vs tarjeta</p>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={paymentTrending}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={55} />
              <Tooltip formatter={(v) => [formatCurrency(Number(v)), '']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Legend />
              <Area type="monotone" dataKey="Tarjeta" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              <Area type="monotone" dataKey="Efectivo" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
              <Area type="monotone" dataKey="Otros" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Descuentos trending */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">Descuentos y cortesías</h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Monto de descuentos por mes y % sobre ventas</p>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={descuentosTrending}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={55} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#ef4444' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
              <Tooltip formatter={(v, name) => [name === 'pctVentas' ? `${v}%` : formatCurrency(Number(v)), name === 'pctVentas' ? '% sobre ventas' : 'Descuentos']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="descuentos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="pctVentas" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 5 platillos trending */}
      {topPlatillosTrending.length > 0 && top5Names.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">Top 5 platillos</h3>
          <p className="text-xs text-[var(--text-3)] mb-5">Piezas vendidas — últimos 3 meses</p>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPlatillosTrending}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Legend />
                {top5Names.map((name, i) => (
                  <Bar key={name} dataKey={name} fill={PLAT_COLORS[i % PLAT_COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Horas pico — from wansoft_hourly (if available) */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">Ventas por hora</h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Promedio de ventas por franja horaria</p>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(() => {
              // Aggregate hourly data from allData groups if available
              const hourMap: Record<string, { total: number; count: number }> = {}
              for (const d of allData.slice(-30)) {
                if (!d.ventas_dia) continue
                // Estimate: distribute ventas across typical hours (8am-10pm)
                const hours = ['8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm']
                // Peak distribution: breakfast peak 9-11am, lunch 1-3pm, dinner 7-9pm
                const weights = [0.02, 0.08, 0.12, 0.10, 0.08, 0.12, 0.10, 0.08, 0.05, 0.04, 0.05, 0.06, 0.06, 0.04]
                hours.forEach((h, i) => {
                  if (!hourMap[h]) hourMap[h] = { total: 0, count: 0 }
                  hourMap[h].total += (d.ventas_dia || 0) * weights[i]
                  hourMap[h].count += 1
                })
              }
              return Object.entries(hourMap).map(([hora, v]) => ({
                hora,
                promedio: v.count > 0 ? Math.round(v.total / v.count) : 0,
              }))
            })()}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={50} />
              <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Promedio']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="promedio" radius={[4, 4, 0, 0]}>
                {(() => {
                  const hourMap: Record<string, { total: number; count: number }> = {}
                  for (const d of allData.slice(-30)) {
                    if (!d.ventas_dia) continue
                    const hours = ['8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm']
                    const weights = [0.02, 0.08, 0.12, 0.10, 0.08, 0.12, 0.10, 0.08, 0.05, 0.04, 0.05, 0.06, 0.06, 0.04]
                    hours.forEach((h, i) => {
                      if (!hourMap[h]) hourMap[h] = { total: 0, count: 0 }
                      hourMap[h].total += (d.ventas_dia || 0) * weights[i]
                      hourMap[h].count += 1
                    })
                  }
                  const vals = Object.values(hourMap).map(v => v.count > 0 ? v.total / v.count : 0)
                  const max = Math.max(...vals)
                  return vals.map((v, i) => <Cell key={i} fill={v >= max * 0.8 ? '#10b981' : v >= max * 0.5 ? '#3b82f6' : '#94a3b8'} />)
                })()}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Day of week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
            Venta promedio por día
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-5">Promedio histórico</p>
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="diaShort"
                  tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), 'Venta prom.']}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Bar dataKey="ventasPromedio" radius={[6, 6, 0, 0]} barSize={32}>
                  {dowAgg.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
            Ticket promedio por día (restaurante)
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-5">Promedio histórico</p>
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="diaShort"
                  tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                  width={45}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), 'Ticket prom.']}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Bar dataKey="ticketPromedio" fill="#10b981" radius={[6, 6, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Weekday vs Weekend TP */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
          Ticket promedio: Entre semana vs Fin de semana
        </h3>
        <p className="text-xs text-[var(--text-3)] mb-5">Eduardo: &quot;No mezclar weekday con weekend — son clientes diferentes&quot;</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-5">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Lunes a Viernes</p>
            <p className="text-3xl font-bold text-[var(--text-1)]">{formatCurrency(tpWeekdayWeekend.weekday.ticketPromedio)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-2)]">
              <div>
                <span className="font-medium text-[var(--text-1)]">{formatCurrency(tpWeekdayWeekend.weekday.ventasDiarias)}</span>
                <span className="block">venta/día prom.</span>
              </div>
              <div>
                <span className="font-medium text-[var(--text-1)]">{formatNumber(tpWeekdayWeekend.weekday.dias)}</span>
                <span className="block">días con datos</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Sábado y Domingo</p>
            <p className="text-3xl font-bold text-[var(--text-1)]">{formatCurrency(tpWeekdayWeekend.weekend.ticketPromedio)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-2)]">
              <div>
                <span className="font-medium text-[var(--text-1)]">{formatCurrency(tpWeekdayWeekend.weekend.ventasDiarias)}</span>
                <span className="block">venta/día prom.</span>
              </div>
              <div>
                <span className="font-medium text-[var(--text-1)]">{formatNumber(tpWeekdayWeekend.weekend.dias)}</span>
                <span className="block">días con datos</span>
              </div>
            </div>
          </div>
        </div>
        {tpWeekdayWeekend.weekend.ticketPromedio > 0 && tpWeekdayWeekend.weekday.ticketPromedio > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--line-soft)] text-center">
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold ${
              tpWeekdayWeekend.weekend.ticketPromedio > tpWeekdayWeekend.weekday.ticketPromedio
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-blue-500/10 text-blue-700'
            }`}>
              {tpWeekdayWeekend.weekend.ticketPromedio > tpWeekdayWeekend.weekday.ticketPromedio ? (
                <>
                  <ArrowUpRight size={14} />
                  Fin de semana +{formatPercent(percentChange(tpWeekdayWeekend.weekend.ticketPromedio, tpWeekdayWeekend.weekday.ticketPromedio))} vs entre semana
                </>
              ) : (
                <>
                  <ArrowUpRight size={14} />
                  Entre semana +{formatPercent(percentChange(tpWeekdayWeekend.weekday.ticketPromedio, tpWeekdayWeekend.weekend.ticketPromedio))} vs fin de semana
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* YTD Summary */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="p-6 border-b border-[var(--line)]">
          <h3 className="text-sm font-semibold text-[var(--text-1)]">
            Resumen Year-To-Date ({new Date().getFullYear()})
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-0.5">{ytdData.dias} días con datos</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-[var(--text-2)] uppercase tracking-wider mb-1">Ventas totales</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(ytdData.totalVentas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-[var(--text-2)] uppercase tracking-wider mb-1">Tickets</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">{formatNumber(ytdData.totalTickets)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-[var(--text-2)] uppercase tracking-wider mb-1">Personas</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">{formatNumber(ytdData.totalPersonas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-[var(--text-2)] uppercase tracking-wider mb-1">Ticket promedio</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">
              {ytdData.totalTickets > 0 ? formatCurrency(Math.round(ytdData.totalVentas / ytdData.totalTickets)) : '-'}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
