'use client'

import { useEffect, useState } from 'react'
import { Banknote, CreditCard, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import type { WansoftDaily } from '@/lib/types'

export default function CajaPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(30).then(d => { setData(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // efectivo/tarjeta in wansoft_daily can be percentages (<100) or MXN amounts
  const totalEfectivo = data.reduce((s, d) => {
    const val = d.efectivo || 0
    return s + (val < 100 ? (val / 100) * (d.ventas_dia || 0) : val)
  }, 0)
  const totalTarjeta = data.reduce((s, d) => {
    const val = d.tarjeta || 0
    return s + (val < 100 ? (val / 100) * (d.ventas_dia || 0) : val)
  }, 0)
  const totalVentas = data.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const totalOtros = Math.max(0, totalVentas - totalEfectivo - totalTarjeta)
  const pctEfectivo = totalVentas > 0 ? (totalEfectivo / totalVentas * 100) : 0
  const pctTarjeta = totalVentas > 0 ? (totalTarjeta / totalVentas * 100) : 0

  const chartData = data.map(d => {
    const ef = d.efectivo || 0
    const ta = d.tarjeta || 0
    return {
      fecha: new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      efectivo: Math.round(ef < 100 ? (ef / 100) * (d.ventas_dia || 0) : ef),
      tarjeta: Math.round(ta < 100 ? (ta / 100) * (d.ventas_dia || 0) : ta),
    }
  })

  return (
    <>
      <PageHeader title="Caja" subtitle="Efectivo, tarjeta y métodos de pago — últimos 30 días" />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Efectivo" value={formatCurrency(totalEfectivo)} subtitle={`${pctEfectivo.toFixed(0)}% del total`} icon={Banknote} accentClass="kpi-accent-green" />
            <KPICard label="Tarjeta" value={formatCurrency(totalTarjeta)} subtitle={`${pctTarjeta.toFixed(0)}% del total`} icon={CreditCard} accentClass="kpi-accent-blue" />
            <KPICard label="Otros" value={formatCurrency(totalOtros)} subtitle="Uber, Rappi, transferencia" icon={ArrowUpRight} accentClass="kpi-accent-amber" />
            <KPICard label="Total ventas" value={formatCurrency(totalVentas)} subtitle="30 días" icon={ArrowDownRight} accentClass="kpi-accent-purple" />
          </div>

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Efectivo vs Tarjeta (30 días)</h3>
            <div className="h-[200px] sm:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip // @ts-expect-error recharts formatter type
                  formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="tarjeta" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Tarjeta" />
                  <Area type="monotone" dataKey="efectivo" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Efectivo" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily breakdown */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Desglose diario</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                  <th className="text-left px-4 py-2 font-medium">Fecha</th>
                  <th className="text-right px-4 py-2 font-medium">Efectivo</th>
                  <th className="text-right px-4 py-2 font-medium">Tarjeta</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                </tr></thead>
                <tbody>{[...data].reverse().slice(0, 14).map(d => (
                  <tr key={d.fecha} className="border-b border-[var(--line-soft)]">
                    <td className="px-4 py-2 text-[var(--text-2)]">{new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td className="px-4 py-2 text-right text-emerald-500 font-medium tabular-nums">{formatCurrency(d.efectivo || 0)}</td>
                    <td className="px-4 py-2 text-right text-blue-400 font-medium tabular-nums">{formatCurrency(d.tarjeta || 0)}</td>
                    <td className="px-4 py-2 text-right text-[var(--text-1)] font-medium tabular-nums">{formatCurrency(d.ventas_dia || 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
