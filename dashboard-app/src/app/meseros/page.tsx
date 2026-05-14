'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { DollarSign, Ticket, Users, Trophy } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const BAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']

export default function MeserosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<7 | 14 | 30>(7)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRecentDays(30)
        setRecentData(data)
      } catch (err) {
        console.error('Error loading meseros data:', err)
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
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-soft text-sm font-medium">Cargando datos...</p>
        </div>
      </div>
    )
  }

  const periodData = recentData.slice(-period)
  const meseros = aggregateMeseros(periodData)

  const totalVentas = meseros.reduce((sum, m) => sum + m.total, 0)
  const totalTicketDays = meseros.reduce((sum, m) => sum + m.dias, 0)
  const avgTicket = totalTicketDays > 0
    ? Math.round(totalVentas / totalTicketDays)
    : 0
  const topMesero = meseros[0]
  const topMeseroMax = topMesero?.total || 1

  const chartData = meseros.slice(0, 10).map((m, i) => ({
    nombre: m.nombre.split(' ').slice(0, 2).join(' '),
    total: m.total,
    promedio: m.promedio,
    fill: BAR_COLORS[i % BAR_COLORS.length],
  }))

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Meseros"
        subtitle={`Performance de meseros - últimos ${period} días`}
      />

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {([7, 14, 30] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-accent text-white shadow-sm'
                : 'bg-card border border-border text-text-soft hover:text-text hover:border-accent/30'
            }`}
          >
            {p} días
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Total ventas meseros"
          value={formatCurrency(totalVentas)}
          subtitle={`Últimos ${period} días`}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Promedio diario"
          value={formatCurrency(avgTicket)}
          subtitle="por día total"
          icon={Ticket}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Meseros activos"
          value={formatNumber(meseros.length)}
          subtitle={`en ${period} días`}
          icon={Users}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Top mesero"
          value={topMesero ? topMesero.nombre.split(' ').slice(0, 2).join(' ') : '-'}
          subtitle={topMesero ? formatCurrency(topMesero.total) : ''}
          icon={Trophy}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Bar chart */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <h3 className="text-sm font-semibold text-text mb-1">
          Ventas por mesero (top 10)
        </h3>
        <p className="text-xs text-text-muted mb-4">Últimos {period} días</p>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                width={130}
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
              <Bar
                dataKey="total"
                radius={[0, 6, 6, 0]}
                barSize={24}
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed table */}
      <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="text-sm font-semibold text-text">
            Detalle por mesero
          </h3>
          <p className="text-xs text-text-muted mt-0.5">Todos los meseros activos</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-striped">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  #
                </th>
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  Mesero
                </th>
                <th className="text-left text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider w-48">
                  Progreso
                </th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  Total ventas
                </th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  Prom. diario
                </th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  Dias
                </th>
                <th className="text-right text-xs font-semibold text-text-soft py-3.5 px-4 uppercase tracking-wider">
                  % total
                </th>
              </tr>
            </thead>
            <tbody>
              {meseros.map((m, i) => {
                const pct = totalVentas > 0
                  ? ((m.total / totalVentas) * 100).toFixed(1)
                  : '0'
                const barWidth = topMeseroMax > 0 ? ((m.total / topMeseroMax) * 100) : 0
                return (
                  <tr
                    key={m.nombre}
                    className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                  >
                    <td className="py-3.5 px-4 text-sm text-text-muted tabular-nums font-medium">
                      {i + 1}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                        >
                          {m.nombre.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-text">{m.nombre}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="w-full bg-surface rounded-full h-2">
                        <div
                          className="h-2 rounded-full animate-progress"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-sm text-right tabular-nums font-bold text-text">
                      {formatCurrency(m.total)}
                    </td>
                    <td className="py-3.5 px-4 text-sm text-right tabular-nums text-text-soft">
                      {formatCurrency(m.promedio)}
                    </td>
                    <td className="py-3.5 px-4 text-sm text-right tabular-nums text-text-soft">
                      {m.dias}
                    </td>
                    <td className="py-3.5 px-4 text-sm text-right tabular-nums">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/10 text-accent">
                        {pct}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
