'use client'

import { useEffect, useState, useMemo } from 'react'
import { Bike, TrendingUp, DollarSign, Package } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

export default function DeliveryPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(90).then(d => { setData(d); setLoading(false) })
  }, [])

  // Extract delivery data from pago_metodos (Ubereats, Rappi appear as payment methods)
  const deliveryData = useMemo(() => {
    return data.slice(-30).map(d => {
      let uber = 0, rappi = 0, otros = 0
      if (d.pago_métodos) {
        const pagos = typeof d.pago_métodos === 'string' ? JSON.parse(d.pago_métodos) : d.pago_métodos
        if (Array.isArray(pagos)) {
          for (const p of pagos) {
            const nm = (p.nombre || '').toLowerCase()
            if (nm.includes('uber')) uber = p.total || 0
            else if (nm.includes('rappi')) rappi = p.total || 0
            else if (nm.includes('didi') || nm.includes('delivery')) otros = p.total || 0
          }
        }
      }
      return {
        fecha: new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        Uber: Math.round(uber),
        Rappi: Math.round(rappi),
        Otros: Math.round(otros),
        total: Math.round(uber + rappi + otros),
      }
    })
  }, [data])

  const totalDelivery = deliveryData.reduce((s, d) => s + d.total, 0)
  const totalVentas = data.slice(-30).reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const pctDelivery = totalVentas > 0 ? (totalDelivery / totalVentas * 100) : 0
  const totalUber = deliveryData.reduce((s, d) => s + d.Uber, 0)
  const totalRappi = deliveryData.reduce((s, d) => s + d.Rappi, 0)
  const diasActivos = deliveryData.filter(d => d.total > 0).length
  const promedioDelivery = diasActivos > 0 ? totalDelivery / diasActivos : 0

  // Monthly trend
  const monthlyData = useMemo(() => {
    const months: Record<string, { uber: number; rappi: number; otros: number }> = {}
    for (const d of data) {
      const m = d.fecha.slice(0, 7)
      if (!months[m]) months[m] = { uber: 0, rappi: 0, otros: 0 }
      if (d.pago_métodos) {
        const pagos = typeof d.pago_métodos === 'string' ? JSON.parse(d.pago_métodos) : d.pago_métodos
        if (Array.isArray(pagos)) {
          for (const p of pagos) {
            const nm = (p.nombre || '').toLowerCase()
            if (nm.includes('uber')) months[m].uber += p.total || 0
            else if (nm.includes('rappi')) months[m].rappi += p.total || 0
            else if (nm.includes('didi') || nm.includes('delivery')) months[m].otros += p.total || 0
          }
        }
      }
    }
    return Object.entries(months).sort().map(([m, v]) => ({
      mes: new Date(m + '-15').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
      Uber: Math.round(v.uber),
      Rappi: Math.round(v.rappi),
      Otros: Math.round(v.otros),
    }))
  }, [data])

  return (
    <>
      <PageHeader title="Delivery" subtitle="Ventas por plataforma — Uber Eats, Rappi, otros" />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Total delivery (30d)" value={formatCurrency(totalDelivery)} icon={Bike} accentClass="kpi-accent-amber" />
            <KPICard label="% sobre ventas" value={`${pctDelivery.toFixed(1)}%`} icon={TrendingUp} accentClass="kpi-accent-blue" />
            <KPICard label="Uber Eats" value={formatCurrency(totalUber)} subtitle={totalDelivery > 0 ? `${(totalUber/totalDelivery*100).toFixed(0)}% del delivery` : ''} icon={DollarSign} accentClass="kpi-accent-green" />
            <KPICard label="Rappi" value={formatCurrency(totalRappi)} subtitle={totalDelivery > 0 ? `${(totalRappi/totalDelivery*100).toFixed(0)}% del delivery` : ''} icon={Package} accentClass="kpi-accent-pink" />
          </div>

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Delivery diario (30 días)</h3>
            <div className="h-[200px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deliveryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="Uber" stackId="1" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Rappi" stackId="1" fill="#f97316" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Otros" stackId="1" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Tendencia mensual</h3>
            <div className="h-[200px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="Uber" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Rappi" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  )
}
