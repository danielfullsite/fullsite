'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Receipt, RefreshCw, Clock, DollarSign, Users, CreditCard, Banknote, Ban, Percent, ChefHat, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { formatMXN, getAuditLog, reopenOrder, logAudit, getClientId, verifyManagerPin, type AuditLogEntry } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface OrderFromDB {
  id: string
  mesa: number
  mesero: string
  personas: number
  status: string
  subtotal: number
  iva: number
  total: number
  descuento: number
  propina: number | null
  metodo_pago: string | null
  items: string
  created_at: string
  closed_at: string | null
}

async function getCardCommissionPct(): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_payment_methods?client_id=eq.${getClientId()}&active=eq.true&type=eq.card&select=commission_pct`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return 0
    const rows: { commission_pct: number | string }[] = await res.json()
    return rows.reduce((max, r) => Math.max(max, Number(r.commission_pct) || 0), 0)
  } catch { return 0 }
}

async function getOrders(dateStr: string): Promise<OrderFromDB[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${getClientId()}&created_at=gte.${dateStr}T00:00:00&created_at=lte.${dateStr}T23:59:59&order=created_at.desc&limit=200`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export default function CortePage() {
  const [orders, setOrders] = useState<OrderFromDB[]>([])
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => {
    // Use Mexico timezone to get correct local date
    const now = new Date()
    const mxDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
    return mxDate.toISOString().split('T')[0]
  })

  const [cardPct, setCardPct] = useState(0)

  const fetchData = async () => {
    setLoading(true)
    const [o, a, pct] = await Promise.all([
      getOrders(selectedDate),
      getAuditLog(200),
      getCardCommissionPct(),
    ])
    setOrders(o)
    setAuditLog(a)
    setCardPct(pct)
    setLoading(false)
  }

  // Reabrir cuenta
  const [reopenTarget, setReopenTarget] = useState<OrderFromDB | null>(null)
  const [reopenPin, setReopenPin] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const handleReopen = async () => {
    if (!reopenTarget) return
    if (!reopenPin) { setReopenError('Ingresa PIN'); return }
    const manager = await verifyManagerPin(reopenPin)
    if (!manager) { setReopenError('PIN invalido'); return }

    const ok = await reopenOrder(reopenTarget.id)
    if (ok) {
      logAudit({
        order_id: reopenTarget.id, action: 'status_changed', actor: manager,
        mesa: reopenTarget.mesa,
        details: { type: 'order_reopened', mesero: reopenTarget.mesero, total: reopenTarget.total },
        reason: 'Cuenta reabierta por gerente',
        approved_by: manager,
      })
      setToast(`Cuenta Mesa ${reopenTarget.mesa} reabierta — aprobado por ${manager}`)
      setTimeout(() => setToast(null), 3000)
      fetchData()
    }
    setReopenTarget(null)
    setReopenPin('')
    setReopenError('')
  }

  useEffect(() => { fetchData() }, [selectedDate])

  const stats = useMemo(() => {
    const closed = orders.filter(o => o.status === 'cerrada')
    const cancelled = orders.filter(o => o.status === 'cancelada')
    const all = orders

    const totalVentas = closed.reduce((s, o) => s + o.total, 0)
    const totalSubtotal = closed.reduce((s, o) => s + o.subtotal, 0)
    const totalIva = closed.reduce((s, o) => s + o.iva, 0)
    const totalDescuentos = closed.reduce((s, o) => s + o.descuento, 0)
    const totalPropinas = closed.reduce((s, o) => s + (Number(o.propina) || 0), 0)
    const totalPersonas = closed.reduce((s, o) => s + o.personas, 0)
    const ticketPromedio = closed.length > 0 ? totalVentas / closed.length : 0

    // Payment methods
    // Incluye propina: lo cobrado por método debe cuadrar contra caja/terminal (la propina con tarjeta entra por la terminal)
    const byPayment: Record<string, number> = {}
    for (const o of closed) {
      const method = o.metodo_pago || 'sin metodo'
      byPayment[method] = (byPayment[method] || 0) + o.total + (Number(o.propina) || 0)
    }

    // By mesero
    const byMesero: Record<string, { ventas: number; ordenes: number; personas: number; propinas: number }> = {}
    for (const o of closed) {
      if (!byMesero[o.mesero]) byMesero[o.mesero] = { ventas: 0, ordenes: 0, personas: 0, propinas: 0 }
      byMesero[o.mesero].ventas += o.total
      byMesero[o.mesero].ordenes += 1
      byMesero[o.mesero].personas += o.personas
      byMesero[o.mesero].propinas += Number(o.propina) || 0
    }

    // Cancellations from audit log
    const cancellations = auditLog.filter(e =>
      e.action === 'item_cancelled' || e.action === 'order_cancelled'
    )

    // Comisión estimada sobre lo cobrado con tarjeta (incluye propina — la terminal cobra comisión sobre el monto completo)
    const totalTarjeta = Object.entries(byPayment)
      .filter(([m]) => m.toLowerCase().includes('tarjeta'))
      .reduce((s, [, v]) => s + v, 0)
    const comisionTarjeta = totalTarjeta * cardPct / 100

    return {
      totalVentas, totalSubtotal, totalIva, totalDescuentos, totalPropinas,
      totalTarjeta, comisionTarjeta,
      totalPersonas, ticketPromedio,
      ordenesCerradas: closed.length,
      ordenesAbiertas: all.filter(o => o.status === 'enviada' || o.status === 'abierta').length,
      ordenesCanceladas: cancelled.length,
      byPayment,
      byMesero: Object.entries(byMesero).sort((a, b) => b[1].ventas - a[1].ventas),
      cancellations: cancellations.length,
    }
  }, [orders, auditLog, cardPct])

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <Receipt size={24} className="text-blue-400" />
            <h1 className="text-xl font-bold">Corte de Caja</h1>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
        />
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={16} className="text-emerald-400" />
                <p className="text-emerald-400/70 text-xs">Ventas totales</p>
              </div>
              <p className="text-emerald-400 text-2xl font-bold">{formatMXN(stats.totalVentas)}</p>
            </div>
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-1">
                <Users size={16} className="text-blue-400" />
                <p className="text-blue-400/70 text-xs">Personas</p>
              </div>
              <p className="text-blue-400 text-2xl font-bold">{stats.totalPersonas}</p>
              <p className="text-blue-400/50 text-xs">{stats.ordenesCerradas} ordenes</p>
            </div>
            <div className="bg-purple-900/20 border border-purple-700/30 rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-1">
                <Receipt size={16} className="text-purple-400" />
                <p className="text-purple-400/70 text-xs">Ticket promedio</p>
              </div>
              <p className="text-purple-400 text-2xl font-bold">{formatMXN(stats.ticketPromedio)}</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-1">
                <Ban size={16} className="text-red-400" />
                <p className="text-red-400/70 text-xs">Cancelaciones</p>
              </div>
              <p className="text-red-400 text-2xl font-bold">{stats.cancellations}</p>
              <p className="text-red-400/50 text-xs">{stats.ordenesCanceladas} ordenes anuladas</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Desglose financiero */}
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <DollarSign size={18} className="text-emerald-400" />
                Desglose financiero
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Subtotal</span>
                  <span className="text-white font-medium">{formatMXN(stats.totalSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">IVA (16%)</span>
                  <span className="text-white font-medium">{formatMXN(stats.totalIva)}</span>
                </div>
                {stats.totalDescuentos > 0 && (
                  <div className="flex justify-between">
                    <span className="text-red-400">Descuentos</span>
                    <span className="text-red-400 font-medium">-{formatMXN(stats.totalDescuentos)}</span>
                  </div>
                )}
                <div className="border-t border-slate-700 pt-3 flex justify-between">
                  <span className="text-white font-bold">Total</span>
                  <span className="text-emerald-400 font-bold text-lg">{formatMXN(stats.totalVentas)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-400">Propinas (no incluidas en ventas)</span>
                  <span className="text-amber-400 font-medium">{formatMXN(stats.totalPropinas)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Total cobrado (ventas + propinas)</span>
                  <span className="text-white font-semibold">{formatMXN(stats.totalVentas + stats.totalPropinas)}</span>
                </div>
                {stats.comisionTarjeta > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-red-400">Comisión tarjeta est. ({cardPct}%)</span>
                      <span className="text-red-400 font-medium">-{formatMXN(stats.comisionTarjeta)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-3)]">Neto estimado después de comisión</span>
                      <span className="text-white font-semibold">{formatMXN(stats.totalVentas + stats.totalPropinas - stats.comisionTarjeta)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Métodos de pago */}
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <CreditCard size={18} className="text-blue-400" />
                Métodos de pago
              </h3>
              <div className="space-y-3">
                {Object.entries(stats.byPayment).map(([method, total]) => (
                  <div key={method} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {method === 'efectivo' ? <Banknote size={16} className="text-emerald-400" /> :
                       method === 'tarjeta' ? <CreditCard size={16} className="text-blue-400" /> :
                       <DollarSign size={16} className="text-[var(--text-3)]" />}
                      <span className="text-[var(--text-4)] capitalize">{method}</span>
                    </div>
                    <span className="text-white font-medium">{formatMXN(total)}</span>
                  </div>
                ))}
                {Object.keys(stats.byPayment).length === 0 && (
                  <p className="text-[var(--text-2)] text-sm">Sin pagos registrados</p>
                )}
              </div>
            </div>

            {/* Ventas por mesero */}
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5 md:col-span-2">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <ChefHat size={18} className="text-amber-400" />
                Ventas por mesero
              </h3>
              {stats.byMesero.length === 0 ? (
                <p className="text-[var(--text-2)] text-sm">Sin datos de meseros</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--text-3)] border-b border-slate-700">
                        <th className="text-left px-3 py-2">#</th>
                        <th className="text-left px-3 py-2">Mesero</th>
                        <th className="text-right px-3 py-2">Ventas</th>
                        <th className="text-right px-3 py-2">Propinas</th>
                        <th className="text-right px-3 py-2">Ordenes</th>
                        <th className="text-right px-3 py-2">Personas</th>
                        <th className="text-right px-3 py-2">Ticket prom</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byMesero.map(([mesero, data], i) => (
                        <tr key={mesero} className="border-b border-slate-700/50">
                          <td className="px-3 py-2.5 text-[var(--text-2)]">{i + 1}</td>
                          <td className="px-3 py-2.5 text-white font-medium">{mesero}</td>
                          <td className="px-3 py-2.5 text-right text-emerald-400 font-semibold">{formatMXN(data.ventas)}</td>
                          <td className="px-3 py-2.5 text-right text-amber-400">{formatMXN(data.propinas)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-4)]">{data.ordenes}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-4)]">{data.personas}</td>
                          <td className="px-3 py-2.5 text-right text-white">{formatMXN(data.personas > 0 ? data.ventas / data.personas : 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Ordenes cerradas — con opción de reabrir */}
          <div className="mt-6 bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Receipt size={18} className="text-[var(--text-3)]" />
              Ordenes cerradas ({orders.filter(o => o.status === 'cerrada').length})
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {orders.filter(o => o.status === 'cerrada').map(order => (
                <div key={order.id} className="flex items-center justify-between px-3 py-2.5 bg-[var(--line)]/40 rounded-lg">
                  <div>
                    <span className="text-white text-sm font-medium">Mesa {order.mesa}</span>
                    <span className="text-[var(--text-3)] text-xs ml-2">{order.mesero}</span>
                    <span className="text-[var(--text-2)] text-xs ml-2">{order.metodo_pago}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white font-semibold text-sm">{formatMXN(order.total)}</span>
                    <button
                      onClick={() => setReopenTarget(order)}
                      className="px-2 py-1.5 bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 rounded-lg text-xs flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw size={12} />
                      Reabrir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="mt-6 flex gap-4 text-sm text-[var(--text-2)]">
            <span>Abiertas: {stats.ordenesAbiertas}</span>
            <span>Cerradas: {stats.ordenesCerradas}</span>
            <span>Canceladas: {stats.ordenesCanceladas}</span>
          </div>
        </div>
      )}

      {/* Reabrir Modal */}
      {reopenTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReopenTarget(null)} />
          <div className="relative bg-[var(--surface-2)] border border-amber-700/40 rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5">
            <div className="flex items-center gap-3 mb-4">
              <ShieldAlert size={24} className="text-amber-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Reabrir cuenta</h3>
                <p className="text-amber-400 text-sm">Mesa {reopenTarget.mesa} · {formatMXN(reopenTarget.total)}</p>
              </div>
            </div>
            <div>
              <label className="text-sm text-[var(--text-3)] block mb-2">PIN de gerente</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={reopenPin}
                onChange={e => { setReopenPin(e.target.value.replace(/\D/g, '')); setReopenError('') }}
                placeholder="****"
                className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-amber-500"
              />
            </div>
            {reopenError && <p className="text-red-400 text-sm text-center mt-2">{reopenError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setReopenTarget(null)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-slate-600 text-[var(--text-4)] font-semibold">Cancelar</button>
              <button onClick={handleReopen} className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center justify-center gap-2">
                <RotateCcw size={18} />Reabrir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
