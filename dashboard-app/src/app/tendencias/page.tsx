'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getMonthlyData } from '@/lib/data'
import { formatCurrency, formatShortDate, formatPercent, percentChange } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

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
      const month = d.fecha.slice(0, 7) // YYYY-MM
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
    return [1, 2, 3, 4, 5, 6, 0].map((dow) => {
      const data = dows[dow] || { ventas: 0, personas: 0, tickets: 0, dias: 0 }
      return {
        dia: dowNames[dow],
        ventasPromedio: data.dias > 0 ? Math.round(data.ventas / data.dias) : 0,
        personasPromedio: data.dias > 0 ? Math.round(data.personas / data.dias) : 0,
        ticketPromedio: data.tickets > 0 ? Math.round(data.ventas / data.tickets) : 0,
      }
    })
  }, [allData])

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

  const currentMonth = monthlyAgg[monthlyAgg.length - 1]
  const prevMonth = monthlyAgg.length >= 2 ? monthlyAgg[monthlyAgg.length - 2] : null

  const ventasMoM = currentMonth && prevMonth
    ? percentChange(currentMonth.ventas, prevMonth.ventas)
    : 0
  const ticketMoM = currentMonth && prevMonth
    ? percentChange(currentMonth.ticketPromedio, prevMonth.ticketPromedio)
    : 0

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Tendencias"
        subtitle="Comparativos mensuales y por dia de la semana"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Ventas mes actual"
          value={currentMonth ? formatCurrency(currentMonth.ventas) : '-'}
          delta={currentMonth ? `${formatPercent(ventasMoM)} vs mes anterior` : undefined}
          deltaType={ventasMoM >= 0 ? 'up' : 'down'}
        />
        <KPICard
          label="Ticket promedio mes"
          value={currentMonth ? formatCurrency(currentMonth.ticketPromedio) : '-'}
          delta={currentMonth ? `${formatPercent(ticketMoM)} vs mes anterior` : undefined}
          deltaType={ticketMoM >= 0 ? 'up' : 'down'}
        />
        <KPICard
          label="Dias con datos"
          value={currentMonth ? String(currentMonth.dias) : '-'}
          subtitle="mes actual"
        />
        <KPICard
          label="Total meses"
          value={String(monthlyAgg.length)}
          subtitle="con datos historicos"
        />
      </div>

      {/* Monthly revenue trend */}
      <div className="bg-card rounded-xl border border-border p-5 mb-8">
        <h3 className="text-sm font-semibold text-text mb-4">
          Ventas mensuales
        </h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyAgg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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
                formatter={(value: any) => [formatCurrency(Number(value)), 'Ventas']}
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Line
                type="monotone"
                dataKey="ventas"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly ticket promedio */}
      <div className="bg-card rounded-xl border border-border p-5 mb-8">
        <h3 className="text-sm font-semibold text-text mb-4">
          Ticket promedio mensual
        </h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyAgg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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
                formatter={(value: any) => [formatCurrency(Number(value)), 'Ticket Prom.']}
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Line
                type="monotone"
                dataKey="ticketPromedio"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: '#10b981' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Day of week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-4">
            Venta promedio por dia de la semana
          </h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
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
                  formatter={(value: any) => [formatCurrency(Number(value)), 'Venta prom.']}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="ventasPromedio" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-4">
            Ticket promedio por dia de la semana
          </h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowAgg}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
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
                  formatter={(value: any) => [formatCurrency(Number(value)), 'Ticket prom.']}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="ticketPromedio" fill="#10b981" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  )
}
