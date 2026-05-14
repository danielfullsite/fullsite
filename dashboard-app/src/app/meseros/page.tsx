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
} from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

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
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-soft text-sm">Cargando datos...</p>
        </div>
      </div>
    )
  }

  const periodData = recentData.slice(-period)
  const meseros = aggregateMeseros(periodData)

  const totalVentas = meseros.reduce((sum, m) => sum + m.total, 0)
  const avgTicket = meseros.length > 0
    ? Math.round(totalVentas / meseros.reduce((sum, m) => sum + m.dias, 0))
    : 0
  const topMesero = meseros[0]

  const chartData = meseros.slice(0, 10).map((m) => ({
    nombre: m.nombre.split(' ').slice(0, 2).join(' '),
    total: m.total,
    promedio: m.promedio,
  }))

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Meseros"
        subtitle={`Performance de meseros - ultimos ${period} dias`}
      />

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {([7, 14, 30] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === p
                ? 'bg-accent text-white'
                : 'bg-card border border-border text-text-soft hover:text-text'
            }`}
          >
            {p} dias
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Total ventas meseros"
          value={formatCurrency(totalVentas)}
          subtitle={`${period} dias`}
        />
        <KPICard
          label="Promedio diario"
          value={formatCurrency(avgTicket)}
          subtitle="por dia total"
        />
        <KPICard
          label="Meseros activos"
          value={formatNumber(meseros.length)}
          subtitle={`en ${period} dias`}
        />
        <KPICard
          label="Top mesero"
          value={topMesero?.nombre || '-'}
          subtitle={topMesero ? formatCurrency(topMesero.total) : ''}
        />
      </div>

      {/* Bar chart */}
      <div className="bg-card rounded-xl border border-border p-5 mb-8">
        <h3 className="text-sm font-semibold text-text mb-4">
          Ventas por mesero (top 10)
        </h3>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
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
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={120}
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
              <Bar
                dataKey="total"
                fill="#3b82f6"
                radius={[0, 4, 4, 0]}
                barSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed table */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-text mb-4">
          Detalle por mesero
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-text-soft py-3 px-3">
                  #
                </th>
                <th className="text-left text-xs font-medium text-text-soft py-3 px-3">
                  Mesero
                </th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">
                  Total ventas
                </th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">
                  Prom. diario
                </th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">
                  Dias activos
                </th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">
                  % del total
                </th>
              </tr>
            </thead>
            <tbody>
              {meseros.map((m, i) => {
                const pct = totalVentas > 0
                  ? ((m.total / totalVentas) * 100).toFixed(1)
                  : '0'
                return (
                  <tr
                    key={m.nombre}
                    className="border-b border-border/50 hover:bg-surface/50 transition-colors"
                  >
                    <td className="py-3 px-3 text-sm text-text-muted tabular-nums">
                      {i + 1}
                    </td>
                    <td className="py-3 px-3 text-sm font-medium text-text">
                      {m.nombre}
                    </td>
                    <td className="py-3 px-3 text-sm text-right tabular-nums font-medium text-text">
                      {formatCurrency(m.total)}
                    </td>
                    <td className="py-3 px-3 text-sm text-right tabular-nums text-text-soft">
                      {formatCurrency(m.promedio)}
                    </td>
                    <td className="py-3 px-3 text-sm text-right tabular-nums text-text-soft">
                      {m.dias}
                    </td>
                    <td className="py-3 px-3 text-sm text-right tabular-nums text-text-soft">
                      {pct}%
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
