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
} from 'recharts'
import { TrendingUp, Calendar, Target, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getMonthlyData } from '@/lib/data'
import { formatCurrency, formatPercent, percentChange, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const DOW_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']

export default function TendenciasPage() {
  const [allData, setAllData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await getMonthlyData()
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
        ventasDiarias: data.dias > 0 ? Math.round(data.ventas / data.dias) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [allData])

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
          <p className="text-slate-500 text-sm font-medium">Cargando datos...</p>
        </div>
      </div>
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
        eyebrow="AMALAY Coffee & Market"
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
            <div key={card.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{card.label}</p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Este mes</p>
                  <p className="text-xl font-bold text-slate-900">{card.current}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-0.5">Mes anterior</p>
                  <p className="text-lg font-semibold text-slate-400">{card.prev}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100">
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${card.change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  {card.change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {formatPercent(card.change)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly revenue trend */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Ventas mensuales
        </h3>
        <p className="text-xs text-slate-400 mb-5">{monthlyAgg.length} meses de datos</p>
        <div className="h-[250px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyAgg}>
              <defs>
                <linearGradient id="colorMonthlyVentas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
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
                  background: '#fff',
                  border: 'none',
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
                dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Year-over-Year comparison */}
      {yoyData.chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            Comparativo año anterior
          </h3>
          <p className="text-xs text-slate-400 mb-5">
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
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
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
                    background: '#fff',
                    border: 'none',
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
                  dot={{ r: 2, fill: '#94a3b8', stroke: '#fff', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey={yoyData.currentYear}
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fill="url(#colorYoyCurrent)"
                  dot={{ r: 3, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Comparison table */}
          {yoyData.tableData.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Detalle mensual {yoyData.currentYear} vs {yoyData.prevYear}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {yoyData.tableData.map((row) => {
                  const isPositive = row.pctChange >= 0
                  return (
                    <div
                      key={row.monthNum}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-900">
                          {row.monthLabel} {yoyData.currentYear.slice(2)}
                        </span>
                        <span className="text-xs text-slate-400 ml-1.5">
                          {formatCurrency(row.current)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {row.prev > 0 ? (
                          <>
                            <span className="text-xs text-slate-400">
                              vs {formatCurrency(row.prev)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                                isPositive
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : 'bg-red-50 text-red-600'
                              }`}
                            >
                              {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {isPositive ? '+' : ''}{row.pctChange.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Sin datos {yoyData.prevYear}</span>
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

      {/* Monthly ticket promedio */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Ticket promedio mensual (restaurante)
        </h3>
        <p className="text-xs text-slate-400 mb-5">Evolución del ticket promedio</p>
        <div className="h-[200px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyAgg}>
              <defs>
                <linearGradient id="colorTicketProm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
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
                  background: '#fff',
                  border: 'none',
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
                dot={{ r: 3, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Day of week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            Venta promedio por día
          </h3>
          <p className="text-xs text-slate-400 mb-5">Promedio histórico</p>
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
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
                    background: '#fff',
                    border: 'none',
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

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            Ticket promedio por día (restaurante)
          </h3>
          <p className="text-xs text-slate-400 mb-5">Promedio histórico</p>
          <div className="h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
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
                    background: '#fff',
                    border: 'none',
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Ticket promedio: Entre semana vs Fin de semana
        </h3>
        <p className="text-xs text-slate-400 mb-5">Eduardo: &quot;No mezclar weekday con weekend — son clientes diferentes&quot;</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">Lunes a Viernes</p>
            <p className="text-3xl font-bold text-slate-900">{formatCurrency(tpWeekdayWeekend.weekday.ticketPromedio)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>
                <span className="font-medium text-slate-700">{formatCurrency(tpWeekdayWeekend.weekday.ventasDiarias)}</span>
                <span className="block">venta/día prom.</span>
              </div>
              <div>
                <span className="font-medium text-slate-700">{formatNumber(tpWeekdayWeekend.weekday.dias)}</span>
                <span className="block">días con datos</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-5">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">Sábado y Domingo</p>
            <p className="text-3xl font-bold text-slate-900">{formatCurrency(tpWeekdayWeekend.weekend.ticketPromedio)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>
                <span className="font-medium text-slate-700">{formatCurrency(tpWeekdayWeekend.weekend.ventasDiarias)}</span>
                <span className="block">venta/día prom.</span>
              </div>
              <div>
                <span className="font-medium text-slate-700">{formatNumber(tpWeekdayWeekend.weekend.dias)}</span>
                <span className="block">días con datos</span>
              </div>
            </div>
          </div>
        </div>
        {tpWeekdayWeekend.weekend.ticketPromedio > 0 && tpWeekdayWeekend.weekday.ticketPromedio > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold ${
              tpWeekdayWeekend.weekend.ticketPromedio > tpWeekdayWeekend.weekday.ticketPromedio
                ? 'bg-amber-50 text-amber-700'
                : 'bg-blue-50 text-blue-700'
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Resumen Year-To-Date ({new Date().getFullYear()})
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{ytdData.dias} días con datos</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Ventas totales</p>
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(ytdData.totalVentas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Tickets</p>
            <p className="text-2xl font-bold text-slate-900">{formatNumber(ytdData.totalTickets)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Personas</p>
            <p className="text-2xl font-bold text-slate-900">{formatNumber(ytdData.totalPersonas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Ticket promedio</p>
            <p className="text-2xl font-bold text-slate-900">
              {ytdData.totalTickets > 0 ? formatCurrency(Math.round(ytdData.totalVentas / ytdData.totalTickets)) : '-'}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
