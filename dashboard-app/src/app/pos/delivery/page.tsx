'use client'

// Delivery — Monitor de plataformas (Uber Eats / Rappi)
// AMALAY no tiene repartidores propios; las plataformas proveen el driver.
// Este módulo solo controla el status de cocina: Recibida → Preparando → Lista
// El resto (en ruta, entregada) lo maneja la plataforma.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, RefreshCw, Clock, ChefHat, PackageCheck,
  Truck, CheckCircle2, ShoppingBag, DollarSign,
} from 'lucide-react'
import { formatMXN, logAudit, getClientId } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

type PlatformFilter = 'todas' | 'ubereats' | 'rappi'

const STATUS_FLOW = ['nueva', 'preparando', 'lista', 'en_ruta', 'entregada'] as const
type OrderStatus = (typeof STATUS_FLOW)[number] | 'cancelada'

interface DeliveryItem {
  name: string
  qty: number
  price: number
}

interface DeliveryOrder {
  id: string
  client_id: string
  status: OrderStatus
  platform: string
  platform_order_id: string | null
  customer_name: string
  address: string | null
  phone: string | null
  total: number
  payment_method: string | null
  items: string | DeliveryItem[] | null
  created_at: string
  en_route_at: string | null
  delivered_at: string | null
  closed_at: string | null
}

function elapsedStr(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hrs}h ${rem}m`
}

function parseItems(raw: string | DeliveryItem[] | null): DeliveryItem[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

const PLATFORM_STYLE: Record<string, { label: string; bg: string; text: string; border: string }> = {
  ubereats: { label: 'Uber Eats', bg: 'bg-green-600/20', text: 'text-green-400', border: 'border-green-500/30' },
  rappi:    { label: 'Rappi',     bg: 'bg-orange-600/20', text: 'text-orange-400', border: 'border-orange-500/30' },
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  nueva:      { label: 'Recibida',   icon: Clock,         color: 'text-amber-400' },
  preparando: { label: 'Preparando', icon: ChefHat,       color: 'text-blue-400' },
  lista:      { label: 'Lista',      icon: PackageCheck,  color: 'text-emerald-400' },
  en_ruta:    { label: 'En ruta',    icon: Truck,         color: 'text-purple-400' },
  entregada:  { label: 'Entregada',  icon: CheckCircle2,  color: 'text-emerald-400' },
  cancelada:  { label: 'Cancelada',  icon: Clock,         color: 'text-red-400' },
}

export default function DeliveryPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<PlatformFilter>('todas')
  const [actorName, setActorName] = useState('Caja')

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) setActorName(JSON.parse(saved).name || 'Caja')
    } catch { /* */ }
  }, [])

  const fetchingRef = useRef(false)
  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return // prevent piling up requests on slow network
    fetchingRef.current = true
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/delivery_orders?client_id=eq.${getClientId()}&platform=in.(ubereats,rappi)&created_at=gte.${today}T00:00:00&order=created_at.desc`,
        { headers: SB_HEADERS, cache: 'no-store' }
      )
      if (res.ok) {
        const data: DeliveryOrder[] = await res.json()
        // Filter out test/invalid orders
        setOrders(data.filter(o => o.customer_name && !o.customer_name.startsWith('TEST') && o.total > 0))
      }
    } catch { /* sin red */ } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 10000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  const filteredOrders = useMemo(() => {
    if (filter === 'todas') return orders
    return orders.filter(o => o.platform === filter)
  }, [orders, filter])

  // Split into active (not completed) and completed
  const activeOrders = useMemo(
    () => filteredOrders.filter(o => !['entregada', 'cancelada'].includes(o.status) && !o.closed_at),
    [filteredOrders]
  )
  const completedOrders = useMemo(
    () => filteredOrders.filter(o => ['entregada', 'cancelada'].includes(o.status) || o.closed_at),
    [filteredOrders]
  )

  // Stats
  const stats = useMemo(() => {
    const uber = orders.filter(o => o.platform === 'ubereats')
    const rappi = orders.filter(o => o.platform === 'rappi')
    const totalRevenue = orders
      .filter(o => o.status !== 'cancelada')
      .reduce((s, o) => s + Number(o.total || 0), 0)
    return {
      total: orders.length,
      uber: uber.length,
      rappi: rappi.length,
      revenue: totalRevenue,
    }
  }, [orders])

  const patchOrder = async (id: string, body: Record<string, unknown>) => {
    await fetch(`${SUPABASE_URL}/rest/v1/delivery_orders?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify(body),
    })
    fetchOrders()
  }

  const handleStatusChange = async (order: DeliveryOrder, newStatus: 'preparando' | 'lista') => {
    const extra: Record<string, unknown> = {}
    if (newStatus === 'lista') extra.updated_at = new Date().toISOString()
    await patchOrder(order.id, { status: newStatus, ...extra })
    logAudit({
      action: 'delivery_status_changed',
      actor: actorName,
      details: {
        delivery_id: order.id,
        platform: order.platform,
        from: order.status,
        to: newStatus,
        cliente: order.customer_name,
      },
    })
  }

  return (
    <div className="min-h-dvh" style={{ background: '#0a0a0f' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#12121a] border-b border-white/10 px-4 py-3 flex items-center gap-3">
        <Link href="/pos" className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-black text-white tracking-wide flex-1">DELIVERY — PLATAFORMAS</h1>
        <button
          onClick={fetchOrders}
          className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center text-white active:bg-white/20"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="p-4 max-w-3xl mx-auto space-y-4">
        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={ShoppingBag}
            label="Hoy"
            value={String(stats.total)}
            color="text-white"
          />
          <StatCard
            icon={DollarSign}
            label="Ingresos"
            value={formatMXN(stats.revenue)}
            color="text-emerald-400"
          />
          <StatCard
            label="Uber Eats"
            value={String(stats.uber)}
            color="text-green-400"
            platformDot="bg-green-500"
          />
          <StatCard
            label="Rappi"
            value={String(stats.rappi)}
            color="text-orange-400"
            platformDot="bg-orange-500"
          />
        </div>

        {/* Platform tabs */}
        <div className="flex gap-2">
          {([
            { key: 'todas', label: 'Todas' },
            { key: 'ubereats', label: 'Uber Eats' },
            { key: 'rappi', label: 'Rappi' },
          ] as { key: PlatformFilter; label: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 py-3 rounded-xl font-bold text-sm min-h-[48px] transition-colors ${
                filter === tab.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Orders */}
        {loading ? (
          <div className="flex justify-center pt-20">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center pt-16 space-y-3">
            <ShoppingBag size={48} className="mx-auto text-white/20" />
            <p className="text-white/40 text-lg">Sin ordenes de plataformas hoy</p>
          </div>
        ) : (
          <>
            {/* Active orders */}
            {activeOrders.length > 0 && (
              <section>
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">
                  Activas ({activeOrders.length})
                </h2>
                <div className="space-y-3">
                  {activeOrders.map(o => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed orders */}
            {completedOrders.length > 0 && (
              <section>
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3 mt-6">
                  Completadas ({completedOrders.length})
                </h2>
                <div className="space-y-3">
                  {completedOrders.map(o => (
                    <OrderCard key={o.id} order={o} onStatusChange={handleStatusChange} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  platformDot,
}: {
  icon?: typeof ShoppingBag
  label: string
  value: string
  color: string
  platformDot?: string
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-white/40" />}
        {platformDot && <span className={`w-2.5 h-2.5 rounded-full ${platformDot}`} />}
        <span className="text-[11px] text-white/40 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-black tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ─── Order Card ──────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onStatusChange,
}: {
  order: DeliveryOrder
  onStatusChange: (order: DeliveryOrder, status: 'preparando' | 'lista') => void
}) {
  const platform = PLATFORM_STYLE[order.platform] || PLATFORM_STYLE.ubereats
  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.nueva
  const StatusIcon = statusCfg.icon
  const items = parseItems(order.items)
  const isCompleted = ['entregada', 'cancelada'].includes(order.status) || !!order.closed_at

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-opacity ${
        isCompleted ? 'opacity-50 bg-white/[0.02] border-white/5' : 'bg-white/5 border-white/10'
      }`}
    >
      {/* Top row: platform + status + time */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Platform badge */}
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${platform.bg} ${platform.text} border ${platform.border}`}
          >
            {platform.label}
          </span>
          {/* Status badge */}
          <span className={`flex items-center gap-1 text-[11px] font-bold ${statusCfg.color}`}>
            <StatusIcon size={13} />
            {statusCfg.label}
          </span>
          {/* Elapsed time */}
          {!isCompleted && (
            <span className="text-[11px] text-white/30 tabular-nums">
              {elapsedStr(order.created_at)}
            </span>
          )}
        </div>
        <p className="text-xl font-black text-white tabular-nums">{formatMXN(Number(order.total || 0))}</p>
      </div>

      {/* Order ID + customer */}
      <div>
        <p className="text-white font-bold text-sm">
          {order.platform_order_id
            ? `#${order.platform_order_id.slice(-6).toUpperCase()}`
            : order.id.slice(0, 8)}
          {order.customer_name && order.customer_name !== 'Cliente Uber' && (
            <span className="text-white/50 font-normal"> — {order.customer_name}</span>
          )}
        </p>
      </div>

      {/* Items */}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-white/70">
                <span className="text-white/40 mr-1.5">{item.qty}x</span>
                {item.name}
              </span>
              {item.price > 0 && (
                <span className="text-white/30 tabular-nums text-xs">{formatMXN(item.price * item.qty)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons (kitchen status only) */}
      {!isCompleted && (
        <div className="flex gap-2 pt-1">
          {order.status === 'nueva' && (
            <button
              onClick={() => onStatusChange(order, 'preparando')}
              className="flex-1 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-sm min-h-[48px] flex items-center justify-center gap-2 transition-colors"
            >
              <ChefHat size={18} />
              Preparando
            </button>
          )}
          {order.status === 'preparando' && (
            <button
              onClick={() => onStatusChange(order, 'lista')}
              className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-sm min-h-[48px] flex items-center justify-center gap-2 transition-colors"
            >
              <PackageCheck size={18} />
              Lista para recoger
            </button>
          )}
          {order.status === 'lista' && (
            <div className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white/40 font-bold text-sm min-h-[48px] flex items-center justify-center gap-2">
              <Truck size={18} />
              Esperando repartidor de {platform.label}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
