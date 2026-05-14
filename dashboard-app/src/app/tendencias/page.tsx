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
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import { TrendingUp, Calendar, Target, BarChart3 } from 'lucide-react'
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
    const dowNames = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
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

  // YTD
  const ytdData = useMemo(() => {
    const currentYear = new Date().getFullYear().toString()
    const ytdDays = allData.filter(d => d.fecha.startsWith(currentYear))
    const totalVentas = ytdDays.reduce((s, d) => s + (d.ventas_dia || 0), 0)
    const totalTickets = ytdDays.reduce((s, d) => s + (d.tickets_count || 0), 0)
    const totalPersonas = ytdDays.reduce((s, d) => s + (d.personas_restaurant || 0), 0)
    return { totalVentas, totalTickets, totalPersonas, dias: ytdDays.length }
  }, [allData])

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
        subtitle="Comparativos mensuales, por dia de la semana, y acumulado del ano"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Ventas mes actual"
          value={currentMonth ? formatCurrency(currentMonth.ventas) : '-'}
          delta={currentMonth ? `${formatPercent(ventasMoM)} vs mes anterior` : undefined}
          deltaType={ventasMoM >= 0 ? 'up' : 'down'}
          icon={TrendingUp}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Ticket promedio mes"
          value={currentMonth ? formatCurrency(currentMonth.ticketPromedio) : '-'}
          delta={currentMonth ? `${formatPercent(ticketMoM)} vs mes anterior` : undefined}
          deltaType={ticketMoM >= 0 ? 'up' : 'down'}
          icon={Target}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Mejor dia de semana"
          value={bestDow?.dia || '-'}
          subtitle={bestDow ? `Prom. ${formatCurrency(bestDow.ventasPromedio)}` : ''}
          icon={Calendar}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="YTD Ventas"
          value={formatCurrency(ytdData.totalVentas)}
          subtitle={`${ytdData.dias} dias con datos en ${new Date().getFullYear()}`}
          icon={BarChart3}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Monthly comparison cards */}
      {currentMonth && prevMonth && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-card rounded-xl border border-border p-5 card-shadow">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Ventas totales</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-text-soft mb-0.5">Este mes</p>
                <p className="text-xl font-bold text-text">{formatCurrency(currentMonth.ventas)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-soft mb-0.5">Mes anterior</p>
                <p className="text-lg font-semibold text-text-soft">{formatCurrency(prevMonth.ventas)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ventasMoM >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
                {formatPercent(ventasMoM)}
              </span>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 card-shadow">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Tickets</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-text-soft mb-0.5">Este mes</p>
                <p className="text-xl font-bold text-text">{formatNumber(currentMonth.tickets)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-soft mb-0.5">Mes anterior</p>
                <p className="text-lg font-semibold text-text-soft">{formatNumber(prevMonth.tickets)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${percentChange(currentMonth.tickets, prevMonth.tickets) >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
                {formatPercent(percentChange(currentMonth.tickets, prevMonth.tickets))}
              </span>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 card-shadow">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Ticket promedio</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-text-soft mb-0.5">Este mes</p>
                <p className="text-xl font-bold text-text">{formatCurrency(currentMonth.ticketPromedio)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-soft mb-0.5">Mes anterior</p>
                <p className="text-lg font-semibold text-text-soft">{formatCurrency(prevMonth.ticketPromedio)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ticketMoM >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
                {formatPercent(ticketMoM)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Monthly revenue trend */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <h3 className="text-sm font-semibold text-text mb-1">
          Ventas mensuales
        </h3>
        <p className="text-xs text-text-muted mb-4">{monthlyAgg.length} meses de datos</p>
        <div className="h-[300px]">
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
                  borderRadius: '10px',
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

      {/* Monthly ticket promedio */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <h3 className="text-sm font-semibold text-text mb-1">
          Ticket promedio mensual
        </h3>
        <p className="text-xs text-text-muted mb-4">Evolucion del ticket promedio</p>
        <div className="h-[250px]">
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
                  borderRadius: '10px',
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Venta promedio por dia
          </h3>
          <p className="text-xs text-text-muted mb-4">Promedio historico</p>
          <div className="h-[260px]">
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
                    borderRadius: '10px',
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

        <div className="bg-card rounded-xl border border-border p-5 card-shadow">
          <h3 className="text-sm font-semibold text-text mb-1">
            Ticket promedio por dia
          </h3>
          <p className="text-xs text-text-muted mb-4">Promedio historico</p>
          <div className="h-[260px]">
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
                    borderRadius: '10px',
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

      {/* YTD Summary */}
      <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="text-sm font-semibold text-text">
            Resumen Year-To-Date ({new Date().getFullYear()})
          </h3>
          <p className="text-xs text-text-muted mt-0.5">{ytdData.dias} dias con datos</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Ventas totales</p>
            <p className="text-2xl font-bold text-text">{formatCurrency(ytdData.totalVentas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Tickets</p>
            <p className="text-2xl font-bold text-text">{formatNumber(ytdData.totalTickets)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Personas</p>
            <p className="text-2xl font-bold text-text">{formatNumber(ytdData.totalPersonas)}</p>
          </div>
          <div className="p-5 text-center">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Ticket promedio</p>
            <p className="text-2xl font-bold text-text">
              {ytdData.totalTickets > 0 ? formatCurrency(Math.round(ytdData.totalVentas / ytdData.totalTickets)) : '-'}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
