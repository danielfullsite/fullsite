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
  AreaChart,
  Area,
} from 'recharts'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregateGrupos } from '@/lib/data'
import { formatCurrency, formatShortDate } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

export default function PlatillosPage() {
  const [recentData, setRecentData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRecentDays(30)
        setRecentData(data)
      } catch (err) {
        console.error('Error loading platillos data:', err)
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

  const grupos = aggregateGrupos(recentData)
  const topGrupos = grupos.slice(0, 12)

  const chartData = topGrupos.map((g) => ({
    nombre: g.nombre.length > 20 ? g.nombre.slice(0, 18) + '...' : g.nombre,
    fullName: g.nombre,
    total: g.total,
  }))

  // Time series for key categories
  const keyCats = ['CHILAQUILES & ENCHILADAS', 'COFFEE HOT/ICE', 'TOAST & BAGELS', 'FRESH DRINKS']
  const trendData = recentData.map((d) => {
    const row: Record<string, string | number> = {
      fecha: formatShortDate(d.fecha),
    }
    const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : []
    for (const cat of keyCats) {
      const found = grupos.find(
        (g) => g.nombre.toUpperCase() === cat
      )
      row[cat] = found?.total || 0
    }
    return row
  })

  // Chilaquiles & H&H trend
  const specialTrend = recentData.map((d) => ({
    fecha: formatShortDate(d.fecha),
    chilaquiles: d.chilaquiles_total || 0,
    hh: d.half_half_total || 0,
  }))

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Platillos y Categorias"
        subtitle="Desglose de ventas por grupo y platillos destacados"
      />

      {/* Top categories bar chart */}
      <div className="bg-card rounded-xl border border-border p-5 mb-8">
        <h3 className="text-sm font-semibold text-text mb-4">
          Ventas por categoria (30 dias)
        </h3>
        <div className="h-[400px]">
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
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={160}
              />
              <Tooltip
                formatter={(value: any) => [formatCurrency(Number(value)), 'Ventas']}
                labelFormatter={(label) => {
                  const item = chartData.find(d => d.nombre === label)
                  return item?.fullName || label
                }}
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chilaquiles & H&H trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-1">
            Chilaquiles (ventas $)
          </h3>
          <p className="text-xs text-text-muted mb-4">Ultimos 30 dias</p>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip
                  formatter={(value: any) => [formatCurrency(Number(value)), 'Chilaquiles']}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="chilaquiles"
                  stroke="#ef4444"
                  fill="#fecaca"
                  fillOpacity={0.3}
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-text mb-1">
            Half & Half (ventas $)
          </h3>
          <p className="text-xs text-text-muted mb-4">Ultimos 30 dias</p>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={specialTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip
                  formatter={(value: any) => [formatCurrency(Number(value)), 'H&H']}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="hh"
                  stroke="#f59e0b"
                  fill="#fef3c7"
                  fillOpacity={0.3}
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Categories table */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-text mb-4">
          Todas las categorias (30 dias)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-text-soft py-3 px-3">#</th>
                <th className="text-left text-xs font-medium text-text-soft py-3 px-3">Categoria</th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">Total ventas</th>
                <th className="text-right text-xs font-medium text-text-soft py-3 px-3">% del total</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => {
                const totalAll = grupos.reduce((s, x) => s + x.total, 0)
                const pct = totalAll > 0 ? ((g.total / totalAll) * 100).toFixed(1) : '0'
                return (
                  <tr
                    key={g.nombre}
                    className="border-b border-border/50 hover:bg-surface/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-sm text-text-muted tabular-nums">{i + 1}</td>
                    <td className="py-2.5 px-3 text-sm font-medium text-text">{g.nombre}</td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums font-medium text-text">
                      {formatCurrency(g.total)}
                    </td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums text-text-soft">
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
