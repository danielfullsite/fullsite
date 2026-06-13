'use client'

import { useEffect, useState, useMemo } from 'react'
import { Bike, TrendingUp, DollarSign, Package, Banknote, Calendar, CheckCircle } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface PlatformPayment {
  id: string
  platform: string
  lot_id: string
  period_start: string
  period_end: string
  paid_date: string | null
  total: number
  status: string
}

export default function DeliveryPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [payments, setPayments] = useState<PlatformPayment[]>([])

  useEffect(() => {
    getRecentDays(90).then(d => { setData(d); setLoading(false) })
    // Fetch real platform payments from Supabase
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    fetch(`${sbUrl}/rest/v1/delivery_platform_payments?order=period_start.desc&limit=20`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }).then(r => r.ok ? r.json() : []).then(setPayments).catch(() => {})
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

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
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

          {/* Pagos reales de plataformas (Rappi, Uber) */}
          {payments.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-1)] flex items-center gap-2">
                  <Banknote size={16} className="text-orange-400" />
                  Pagos de plataformas
                </h3>
                <span className="text-xs text-[var(--text-3)]">
                  Total: {formatCurrency(payments.reduce((s, p) => s + Number(p.total), 0))}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)]">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Plataforma</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Período</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Fecha pago</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Depositado</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]/50">
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full ${
                            p.platform === 'rappi' ? 'bg-orange-500/15 text-orange-400' : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {p.platform === 'rappi' ? '🟠' : '🟢'} {p.platform === 'rappi' ? 'Rappi' : 'Uber Eats'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-2)] text-xs flex items-center gap-1">
                          <Calendar size={12} className="text-[var(--text-3)]" />
                          {p.period_start && new Date(p.period_start + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                          {' → '}
                          {p.period_end && new Date(p.period_end + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[var(--text-3)]">
                          {p.paid_date ? new Date(p.paid_date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[var(--text-1)]">
                          {formatCurrency(Number(p.total))}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                            p.status === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>
                            {p.status === 'paid' ? <><CheckCircle size={10} /> Pagado</> : p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
