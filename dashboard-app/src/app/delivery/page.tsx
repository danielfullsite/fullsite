'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  Bike,
  Calendar,
  CheckCircle,
  Clock,
  Package,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'
import { createClient } from '@/lib/supabase-browser'

interface PlatformPayment {
  id: string
  platform: string
  lot_id: string | null
  period_start: string | null
  period_end: string | null
  paid_date: string | null
  total: number | null
  status: string | null
}

interface DeliveryOrder {
  id: string
  platform: string
  platform_order_id: string | null
  status: string
  customer_name: string | null
  total: number | null
  created_at: string | null
  estimated_pickup: string | null
  items: unknown
}

interface IntegrationReadiness {
  provider: 'ubereats' | 'rappi'
  label: string
  status: 'active' | 'configured' | 'waiting_external'
  certification_state: string
  provider_account_id: string | null
  recent_webhook_count: number
  last_webhook_at: string | null
  last_error: string | null
  blockers: string[]
  mappings: Array<{
    provider_store_id: string
    store_open: boolean | null
    menu_sync_enabled: boolean | null
    oos_sync_enabled: boolean | null
    last_menu_sync: string | null
  }>
}

interface DeliveryApiResponse {
  ok: boolean
  error?: string
  client_id?: string
  readiness?: IntegrationReadiness[]
  orders?: DeliveryOrder[]
  payments?: PlatformPayment[]
}

function platformLabel(platform: string) {
  const p = platform.toLowerCase()
  if (p === 'ubereats') return 'Uber Eats'
  if (p === 'rappi') return 'Rappi'
  return platform
}

function platformBadge(platform: string) {
  const p = platform.toLowerCase()
  if (p === 'rappi') return 'bg-orange-500/15 text-orange-400 border-orange-500/25'
  if (p === 'ubereats') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
  return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25'
}

function safeItemsCount(items: unknown) {
  if (Array.isArray(items)) return items.length
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }
  return 0
}

function statusCopy(status: IntegrationReadiness['status']) {
  if (status === 'active') return 'Activo'
  if (status === 'configured') return 'Configurado'
  return 'Esperando externo'
}

export default function DeliveryPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [apiError, setApiError] = useState('')
  const [payments, setPayments] = useState<PlatformPayment[]>([])
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [readiness, setReadiness] = useState<IntegrationReadiness[]>([])

  async function fetchDeliveryStatus() {
    setRefreshing(true)
    setApiError('')
    try {
      const { data: { session } } = await createClient().auth.getSession()
      const res = await fetch('/api/pos/delivery-orders', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        cache: 'no-store',
      })
      const payload = await res.json().catch(() => ({})) as DeliveryApiResponse
      if (!res.ok || !payload.ok) {
        setApiError(payload.error || `HTTP_${res.status}`)
        setPayments([])
        setOrders([])
        setReadiness([])
        return
      }
      setPayments(payload.payments ?? [])
      setOrders(payload.orders ?? [])
      setReadiness(payload.readiness ?? [])
    } catch {
      setApiError('NETWORK_ERROR')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    getRecentDays(90).then(d => { setData(d); setLoading(false) })
    const timer = window.setTimeout(() => {
      void fetchDeliveryStatus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  // Extract delivery data from payment methods. These are historical sales by
  // platform; live incoming orders are shown separately below.
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
  const openOrders = orders.filter(o => ['nueva', 'preparando', 'lista'].includes(o.status)).length

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
      <PageHeader title="Delivery" subtitle="Integraciones y ventas por plataforma — Uber Eats, Rappi, otros" />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <KPICard label="Total delivery (30d)" value={formatCurrency(totalDelivery)} icon={Bike} accentClass="kpi-accent-amber" />
            <KPICard label="% sobre ventas" value={`${pctDelivery.toFixed(1)}%`} icon={TrendingUp} accentClass="kpi-accent-blue" />
            <KPICard label="Uber Eats" value={formatCurrency(totalUber)} icon={Bike} accentClass="kpi-accent-green" />
            <KPICard label="Rappi" value={formatCurrency(totalRappi)} icon={Package} accentClass="kpi-accent-pink" />
            <KPICard label="Órdenes abiertas" value={String(openOrders)} icon={Clock} accentClass="kpi-accent-purple" />
          </div>

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-1)] flex items-center gap-2">
                  <PlugZap size={16} className="text-emerald-400" />
                  Estado de integraciones
                </h3>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  Consola operativa. Las órdenes reales entran por webhook server-side; el navegador no recibe credenciales.
                </p>
              </div>
              <button
                onClick={() => void fetchDeliveryStatus()}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] disabled:opacity-60"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                Actualizar
              </button>
            </div>

            {apiError ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300 flex gap-3">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Estado no disponible</p>
                  <p className="text-xs mt-1 text-amber-200/80">{apiError}. Revisa configuración server-side del entorno.</p>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {readiness.map(r => (
                  <div key={r.provider} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full border ${platformBadge(r.provider)}`}>
                          {r.provider === 'rappi' ? '🟠' : '🟢'} {r.label}
                        </span>
                        <p className="text-lg font-black text-[var(--text-1)] mt-3">{statusCopy(r.status)}</p>
                        <p className="text-xs text-[var(--text-3)] mt-1">
                          Certificación: {r.certification_state} · Webhooks recientes: {r.recent_webhook_count}
                        </p>
                      </div>
                      {r.status === 'active' ? (
                        <CheckCircle size={20} className="text-emerald-400" />
                      ) : (
                        <AlertTriangle size={20} className="text-amber-400" />
                      )}
                    </div>

                    {r.mappings.length > 0 && (
                      <div className="mt-3 text-xs text-[var(--text-3)]">
                        Store mapping: {r.mappings.map(m => m.provider_store_id).join(', ')}
                      </div>
                    )}

                    {r.blockers.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {r.blockers.map(b => (
                          <li key={b} className="text-xs text-[var(--text-3)] flex gap-2">
                            <span className="text-amber-400">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Órdenes recientes</h3>
            {orders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
                <ShieldCheck size={28} className="mx-auto text-[var(--text-3)] mb-2" />
                <p className="text-sm font-semibold text-[var(--text-2)]">Sin órdenes de delivery recibidas todavía</p>
                <p className="text-xs text-[var(--text-3)] mt-1">Cuando Uber/Rappi manden una orden de prueba, aparecerá aquí.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)]">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Plataforma</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Orden</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Cliente</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Estado</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]/50">
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${platformBadge(o.platform)}`}>
                            {platformLabel(o.platform)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[var(--text-2)]">
                          <p className="font-mono">{o.platform_order_id || o.id}</p>
                          <p className="text-[var(--text-3)]">{safeItemsCount(o.items)} items</p>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-2)]">{o.customer_name || 'Cliente'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300">
                            {o.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[var(--text-1)]">
                          {formatCurrency(Number(o.total || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

          {payments.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-1)] flex items-center gap-2">
                  <Banknote size={16} className="text-orange-400" />
                  Pagos de plataformas
                </h3>
                <span className="text-xs text-[var(--text-3)]">
                  Total: {formatCurrency(payments.reduce((s, p) => s + Number(p.total || 0), 0))}
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
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${platformBadge(p.platform)}`}>
                            {platformLabel(p.platform)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-2)] text-xs flex items-center gap-1">
                          <Calendar size={12} className="text-[var(--text-3)]" />
                          {p.period_start ? new Date(p.period_start + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'}
                          {' → '}
                          {p.period_end ? new Date(p.period_end + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[var(--text-3)]">
                          {p.paid_date ? new Date(p.paid_date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[var(--text-1)]">
                          {formatCurrency(Number(p.total || 0))}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                            p.status === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>
                            {p.status === 'paid' ? <><CheckCircle size={10} /> Pagado</> : p.status || 'pendiente'}
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
