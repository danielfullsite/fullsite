'use client'

// Módulo Delivery / Domicilio — estilo Wansoft (spec docs/pos-logica-operativa.md §17-18)
// Flujo: captura → asignar repartidor → en ruta → entregada → cierre por repartidor

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Plus, X, Bike, Banknote, CheckCircle2 } from 'lucide-react'
import { formatMXN, logAudit, getClientId } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

const PLATFORMS = [
  { id: 'propio', label: 'Propio' },
  { id: 'ubereats', label: 'Uber Eats' },
  { id: 'rappi', label: 'Rappi' },
  { id: 'didi', label: 'Didi Food' },
]

const PAYMENT_OPTIONS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Plataforma']

interface DeliveryOrder {
  id: string
  client_id: string
  status: string // nueva | asignada | en_ruta | entregada
  platform: string
  customer_name: string
  address: string | null
  phone: string | null
  total: number
  payment_method: string | null
  cash_received: number | null
  change_due: number | null
  driver_id: string | null
  driver_name: string | null
  created_at: string
  en_route_at: string | null
  delivered_at: string | null
  closed_at: string | null
}

interface StaffMember { id: string; name: string; role: string }

function fmtTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function elapsedMin(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

export default function DeliveryPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showClosed, setShowClosed] = useState(false)
  const [showCapture, setShowCapture] = useState(false)
  const [assigning, setAssigning] = useState<DeliveryOrder | null>(null)
  const [changingBill, setChangingBill] = useState<DeliveryOrder | null>(null)
  const [liquidating, setLiquidating] = useState<string | null>(null) // driver_name
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [actorName, setActorName] = useState('Caja')

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) setActorName(JSON.parse(saved).name || 'Caja')
    } catch { /* */ }
  }, [])

  const fetchOrders = useCallback(async () => {
    try {
      const filter = showClosed
        ? `closed_at=not.is.null&order=closed_at.desc&limit=50`
        : `closed_at=is.null&order=created_at.asc`
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/delivery_orders?client_id=eq.${getClientId()}&${filter}`,
        { headers: SB_HEADERS, cache: 'no-store' }
      )
      if (res.ok) setOrders(await res.json())
    } catch { /* sin red */ } finally {
      setLoading(false)
    }
  }, [showClosed])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 15000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  // Lista de empleados (repartidores se eligen de la lista general, como Wansoft)
  useEffect(() => {
    fetch(`/api/pos/staff?client_id=${getClientId()}`)
      .then(r => r.json())
      .then(d => setStaff(d.staff || []))
      .catch(() => {})
  }, [])

  const patchOrder = async (id: string, body: Record<string, unknown>) => {
    await fetch(`${SUPABASE_URL}/rest/v1/delivery_orders?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify(body),
    })
    fetchOrders()
  }

  const handleAssign = async (order: DeliveryOrder, member: StaffMember) => {
    await patchOrder(order.id, { driver_id: member.id, driver_name: member.name, status: 'asignada' })
    logAudit({ action: 'delivery_assigned', actor: actorName, details: { delivery_id: order.id, cliente: order.customer_name, repartidor: member.name } })
    setAssigning(null)
  }

  const handleEnRuta = async (order: DeliveryOrder) => {
    await patchOrder(order.id, { status: 'en_ruta', en_route_at: new Date().toISOString() })
    logAudit({ action: 'delivery_status_changed', actor: actorName, details: { delivery_id: order.id, to: 'en_ruta', repartidor: order.driver_name } })
  }

  const handleEntregada = async (order: DeliveryOrder) => {
    await patchOrder(order.id, { status: 'entregada', delivered_at: new Date().toISOString() })
    logAudit({ action: 'delivery_status_changed', actor: actorName, details: { delivery_id: order.id, to: 'entregada', repartidor: order.driver_name } })
  }

  // Cierre por repartidor: liquida todas sus entregadas (control Billete/Cambio/Total estilo Wansoft)
  const handleCloseDriver = async (driverName: string) => {
    const toClose = orders.filter(o => o.driver_name === driverName && o.status === 'entregada' && !o.closed_at)
    const now = new Date().toISOString()
    for (const o of toClose) {
      await fetch(`${SUPABASE_URL}/rest/v1/delivery_orders?id=eq.${o.id}`, {
        method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify({ closed_at: now }),
      })
    }
    const efectivo = toClose.filter(o => (o.payment_method || '') === 'Efectivo').reduce((s, o) => s + Number(o.total), 0)
    logAudit({ action: 'delivery_closed', actor: actorName, details: { repartidor: driverName, ordenes: toClose.length, efectivo_esperado: efectivo } })
    setLiquidating(null)
    fetchOrders()
  }

  const unassigned = orders.filter(o => !o.closed_at && (o.status === 'nueva' || !o.driver_name))
  const assigned = orders.filter(o => !o.closed_at && o.driver_name && o.status !== 'nueva')

  // Repartidores con órdenes entregadas pendientes de liquidar
  const driversToSettle = [...new Set(assigned.filter(o => o.status === 'entregada').map(o => o.driver_name as string))]

  const statusBadge: Record<string, { label: string; cls: string }> = {
    nueva: { label: 'NUEVA', cls: 'bg-[var(--surface)] text-[var(--text-1)] border border-white/20' },
    asignada: { label: 'ASIGNADA', cls: 'bg-blue-600 text-white' },
    en_ruta: { label: 'EN RUTA', cls: 'bg-purple-600 text-white' },
    entregada: { label: 'ENTREGADA', cls: 'bg-emerald-600 text-white' },
  }

  const OrderRow = ({ order }: { order: DeliveryOrder }) => {
    const badge = statusBadge[order.status] || statusBadge.nueva
    const platform = PLATFORMS.find(p => p.id === order.platform)?.label || order.platform
    return (
      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--line)]/60 text-[var(--text-3)]">{platform}</span>
              {!order.closed_at && order.status !== 'entregada' && (
                <span className="text-[11px] text-[var(--text-3)]">{elapsedMin(order.created_at)} min</span>
              )}
            </div>
            <p className="text-white font-bold mt-1.5">{order.customer_name}</p>
            {order.address && <p className="text-sm text-[var(--text-3)]">{order.address}</p>}
            {order.phone && <p className="text-sm text-[var(--text-3)]">{order.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xl font-black text-white tabular-nums">{formatMXN(Number(order.total))}</p>
            <p className="text-xs text-[var(--text-3)]">{order.payment_method || 'Sin forma de pago'}</p>
            {order.payment_method === 'Efectivo' && order.cash_received != null && (
              <p className="text-xs text-amber-400">
                Billete {formatMXN(Number(order.cash_received))} · Cambio {formatMXN(Number(order.change_due || 0))}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--text-3)] flex-wrap">
          <span>Captura {fmtTime(order.created_at)}</span>
          <span>· En ruta {fmtTime(order.en_route_at)}</span>
          <span>· Entregada {fmtTime(order.delivered_at)}</span>
          {order.driver_name && <span className="text-blue-300 font-semibold">· {order.driver_name}</span>}
        </div>

        {!order.closed_at && (
          <div className="flex gap-2 flex-wrap">
            {(!order.driver_name || order.status === 'nueva') && (
              <button onClick={() => setAssigning(order)}
                className="flex-1 min-w-[140px] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm min-h-[48px] flex items-center justify-center gap-2">
                <Bike size={16} /> Asignar repartidor
              </button>
            )}
            {order.driver_name && order.status === 'asignada' && (
              <button onClick={() => handleEnRuta(order)}
                className="flex-1 min-w-[120px] py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm min-h-[48px]">
                En ruta
              </button>
            )}
            {order.status === 'en_ruta' && (
              <button onClick={() => handleEntregada(order)}
                className="flex-1 min-w-[120px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm min-h-[48px]">
                Entregada
              </button>
            )}
            {order.payment_method === 'Efectivo' && order.status !== 'entregada' && (
              <button onClick={() => setChangingBill(order)}
                className="py-3 px-4 rounded-xl bg-[var(--line)] hover:bg-[var(--line-soft)] text-amber-300 font-bold text-sm min-h-[48px] flex items-center gap-2">
                <Banknote size={16} /> Billete
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-dvh" style={{ background: '#0a0a0f' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--line)] px-4 py-3 flex items-center gap-3">
        <Link href="/pos" className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-black text-white tracking-wide flex-1">DOMICILIO</h1>
        <button onClick={() => setShowClosed(v => !v)}
          className={`px-4 min-h-[44px] rounded-lg text-sm font-bold ${showClosed ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}>
          {showClosed ? 'Ver abiertas' : 'Ver cerradas'}
        </button>
        <button onClick={fetchOrders} className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center text-white">
          <RefreshCw size={18} />
        </button>
        <button onClick={() => setShowCapture(true)}
          className="px-4 min-h-[44px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center gap-2">
          <Plus size={16} /> Nueva orden
        </button>
      </div>

      <div className="p-4 max-w-3xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center pt-20">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : showClosed ? (
          <section>
            <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wide mb-3">Cerradas (últimas 50)</h2>
            <div className="space-y-3">
              {orders.length === 0 && <p className="text-[var(--text-3)] text-sm">No hay órdenes cerradas.</p>}
              {orders.map(o => <OrderRow key={o.id} order={o} />)}
            </div>
          </section>
        ) : (
          <>
            {/* Liquidación por repartidor */}
            {driversToSettle.length > 0 && (
              <section className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-4">
                <h2 className="text-sm font-bold text-emerald-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <CheckCircle2 size={16} /> Cerrar por repartidor
                </h2>
                <div className="space-y-2">
                  {driversToSettle.map(name => {
                    const theirs = assigned.filter(o => o.driver_name === name && o.status === 'entregada')
                    const efectivo = theirs.filter(o => o.payment_method === 'Efectivo').reduce((s, o) => s + Number(o.total), 0)
                    return (
                      <div key={name} className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-[160px]">
                          <p className="text-white font-bold">{name}</p>
                          <p className="text-xs text-[var(--text-3)]">
                            {theirs.length} {theirs.length === 1 ? 'orden entregada' : 'órdenes entregadas'} · Efectivo esperado: <span className="text-emerald-300 font-semibold">{formatMXN(efectivo)}</span>
                          </p>
                        </div>
                        {liquidating === name ? (
                          <div className="flex gap-2">
                            <button onClick={() => setLiquidating(null)} className="py-2.5 px-4 rounded-lg bg-[var(--line)] text-[var(--text-3)] text-sm font-bold min-h-[44px]">Cancelar</button>
                            <button onClick={() => handleCloseDriver(name)} className="py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold min-h-[44px]">Confirmar cierre</button>
                          </div>
                        ) : (
                          <button onClick={() => setLiquidating(name)} className="py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold min-h-[44px]">Liquidar</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wide mb-3">
                Sin asignar ({unassigned.length})
              </h2>
              <div className="space-y-3">
                {unassigned.length === 0 && <p className="text-[var(--text-3)] text-sm">No hay órdenes sin asignar.</p>}
                {unassigned.map(o => <OrderRow key={o.id} order={o} />)}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wide mb-3">
                Asignadas ({assigned.length})
              </h2>
              <div className="space-y-3">
                {assigned.length === 0 && <p className="text-[var(--text-3)] text-sm">No hay órdenes asignadas.</p>}
                {assigned.map(o => <OrderRow key={o.id} order={o} />)}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Modal: asignar repartidor */}
      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setAssigning(null)} />
          <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Asignar repartidor</h3>
              <button onClick={() => setAssigning(null)} className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]"><X size={20} /></button>
            </div>
            <p className="text-sm text-[var(--text-3)] mb-3">{assigning.customer_name} · {formatMXN(Number(assigning.total))}</p>
            <div className="space-y-2">
              {staff.length === 0 && <p className="text-[var(--text-3)] text-sm">Sin empleados disponibles.</p>}
              {staff.map(m => (
                <button key={m.id} onClick={() => handleAssign(assigning, m)}
                  className="w-full py-3.5 px-4 rounded-xl bg-[var(--line)]/60 hover:bg-blue-600/40 border border-slate-600/50 text-left text-white font-semibold min-h-[52px] flex items-center justify-between">
                  <span>{m.name}</span>
                  <span className="text-xs text-[var(--text-3)] uppercase">{m.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: cambiar billete */}
      {changingBill && (
        <BilleteModal
          order={changingBill}
          onSave={async (billete) => {
            await patchOrder(changingBill.id, { cash_received: billete, change_due: Math.max(0, billete - Number(changingBill.total)) })
            setChangingBill(null)
          }}
          onCancel={() => setChangingBill(null)}
        />
      )}

      {/* Modal: nueva orden */}
      {showCapture && (
        <CaptureModal
          actorName={actorName}
          onCreated={() => { setShowCapture(false); fetchOrders() }}
          onCancel={() => setShowCapture(false)}
        />
      )}
    </div>
  )
}

// ─── Modal billete/cambio ────────────────────────────────────────────────────

function BilleteModal({ order, onSave, onCancel }: {
  order: DeliveryOrder
  onSave: (billete: number) => void
  onCancel: () => void
}) {
  const [billete, setBillete] = useState(order.cash_received ? String(order.cash_received) : '')
  const billeteNum = Number(billete) || 0
  const cambio = Math.max(0, billeteNum - Number(order.total))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5">
        <h3 className="text-lg font-bold text-white mb-1">Billete del cliente</h3>
        <p className="text-sm text-[var(--text-3)] mb-4">{order.customer_name} · Total {formatMXN(Number(order.total))}</p>
        <div className="flex gap-2 mb-3">
          {[200, 500, 1000].map(v => (
            <button key={v} onClick={() => setBillete(String(v))}
              className={`flex-1 py-3 rounded-lg font-bold text-sm min-h-[48px] ${billete === String(v) ? 'bg-amber-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}>
              ${v}
            </button>
          ))}
        </div>
        <input
          type="number" inputMode="decimal" value={billete}
          onChange={e => setBillete(e.target.value)}
          placeholder="Otro monto"
          className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-amber-500 min-h-[48px] mb-3"
        />
        {billeteNum >= Number(order.total) && billeteNum > 0 && (
          <p className="text-center text-amber-400 font-semibold mb-3">Cambio a llevar: {formatMXN(cambio)}</p>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]">Cancelar</button>
          <button
            onClick={() => onSave(billeteNum)}
            disabled={billeteNum < Number(order.total)}
            className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold min-h-[48px]">
            Guardar billete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal captura nueva orden ───────────────────────────────────────────────

function CaptureModal({ actorName, onCreated, onCancel }: {
  actorName: string
  onCreated: () => void
  onCancel: () => void
}) {
  const [customer, setCustomer] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [platform, setPlatform] = useState('propio')
  const [total, setTotal] = useState('')
  const [payment, setPayment] = useState('Efectivo')
  const [saving, setSaving] = useState(false)

  const valid = customer.trim().length > 0 && Number(total) > 0 && (platform !== 'propio' || address.trim().length > 0)

  const handleCreate = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/delivery_orders`, {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: getClientId(),
          status: 'nueva',
          platform,
          customer_name: customer.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          total: Number(total),
          payment_method: payment,
        }),
      })
      if (res.ok) {
        logAudit({ action: 'delivery_created', actor: actorName, details: { cliente: customer.trim(), plataforma: platform, total: Number(total) } })
        onCreated()
        return
      }
    } catch { /* */ }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Nueva orden a domicilio</h3>
          <button onClick={onCancel} className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]"><X size={20} /></button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => setPlatform(p.id)}
                className={`flex-1 py-3 rounded-lg font-bold text-xs min-h-[48px] ${platform === p.id ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="text" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Nombre del cliente *"
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 min-h-[48px]" autoFocus />
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Teléfono"
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 min-h-[48px]" />
          <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder={platform === 'propio' ? 'Dirección *' : 'Dirección (opcional, la trae la plataforma)'}
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 min-h-[48px]" />
          <input type="number" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} placeholder="Total $ *"
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-lg text-center focus:outline-none focus:border-emerald-500 min-h-[48px]" />
          <div className="flex gap-2 flex-wrap">
            {PAYMENT_OPTIONS.map(p => (
              <button key={p} onClick={() => setPayment(p)}
                className={`flex-1 min-w-[100px] py-3 rounded-lg font-bold text-xs min-h-[48px] ${payment === p ? 'bg-blue-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-xl bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]">Cancelar</button>
          <button onClick={handleCreate} disabled={!valid || saving}
            className="flex-[2] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold min-h-[48px]">
            {saving ? 'Guardando...' : `Capturar ${Number(total) > 0 ? formatMXN(Number(total)) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
