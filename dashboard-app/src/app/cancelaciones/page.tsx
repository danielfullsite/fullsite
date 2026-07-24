'use client'

import { useEffect, useState, useMemo } from 'react'
import { AlertTriangle, TrendingDown, Ban, Shield } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

export default function CancelacionesPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(90).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const last30 = data.slice(-30)
  const prev30 = data.slice(-60, -30)

  const totalDesc = last30.reduce((s, d) => s + (d.descuentos || 0), 0)
  const totalVentas = last30.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const pctDesc = totalVentas > 0 ? (totalDesc / totalVentas) * 100 : 0
  const prevDesc = prev30.reduce((s, d) => s + (d.descuentos || 0), 0)
  const diasConDesc = last30.filter(d => (d.descuentos || 0) > 0).length
  const promedioDesc = diasConDesc > 0 ? totalDesc / diasConDesc : 0

  const chartData = last30.map(d => ({
    fecha: new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
    descuentos: d.descuentos || 0,
    pct: d.ventas_dia > 0 ? Number(((d.descuentos || 0) / d.ventas_dia * 100).toFixed(1)) : 0,
  }))

  // Monthly trend
  const monthlyData = useMemo(() => {
    const months: Record<string, { desc: number; ventas: number }> = {}
    for (const d of data) {
      const m = d.fecha.slice(0, 7)
      if (!months[m]) months[m] = { desc: 0, ventas: 0 }
      months[m].desc += d.descuentos || 0
      months[m].ventas += d.ventas_dia || 0
    }
    return Object.entries(months).sort().map(([m, v]) => ({
      mes: new Date(m + '-15').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
      descuentos: Math.round(v.desc),
      pct: v.ventas > 0 ? Number((v.desc / v.ventas * 100).toFixed(1)) : 0,
    }))
  }, [data])

  // Top days with highest discounts
  const topDays = [...last30].sort((a, b) => (b.descuentos || 0) - (a.descuentos || 0)).slice(0, 5)

  return (
    <>
      <PageHeader title="Cancelaciones y Descuentos" subtitle="Monitoreo de descuentos, cortesías y cancelaciones" />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Descuentos (30 días)" value={formatCurrency(totalDesc)} icon={Ban} accentClass="kpi-accent-pink"
              delta={prevDesc > 0 ? `${((totalDesc / prevDesc - 1) * 100).toFixed(0)}% vs mes anterior` : ''}
              deltaType={totalDesc <= prevDesc ? 'up' : 'down'} />
            <KPICard label="% sobre ventas" value={`${pctDesc.toFixed(1)}%`} icon={AlertTriangle} accentClass="kpi-accent-amber"
              subtitle="Meta: <1.5%" />
            <KPICard label="Promedio diario" value={formatCurrency(promedioDesc)} icon={TrendingDown} accentClass="kpi-accent-purple" />
            <KPICard label="Días con descuentos" value={`${diasConDesc}/30`} icon={Shield} accentClass="kpi-accent-blue" />
          </div>

          {/* Daily chart */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Descuentos diarios (últimos 30 días)</h3>
            <div className="h-[200px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip // @ts-expect-error recharts formatter type
                  formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="descuentos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly trend */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Tendencia mensual</h3>
            <div className="h-[200px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip // @ts-expect-error recharts formatter type
                  formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="descuentos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 5 days */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Top 5 días con más descuentos</h3>
            <div className="space-y-3">
              {topDays.map((d, i) => {
                const pct = d.ventas_dia > 0 ? ((d.descuentos || 0) / d.ventas_dia * 100).toFixed(1) : '0'
                return (
                  <div key={d.fecha} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)] last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-red-500/20 text-red-400' : 'bg-[var(--line-soft)] text-[var(--text-3)]'}`}>{i + 1}</span>
                      <span className="text-sm text-[var(--text-1)]">{new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-red-400">{formatCurrency(d.descuentos || 0)}</span>
                      <span className="text-xs text-[var(--text-3)] ml-2">({pct}%)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
