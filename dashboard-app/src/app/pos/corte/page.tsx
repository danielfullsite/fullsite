'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Receipt, RefreshCw, Clock, DollarSign, Users, CreditCard, Banknote, Ban, Percent, ChefHat, RotateCcw, ShieldAlert, AlertTriangle, X } from 'lucide-react'
import { formatMXN, getAuditLog, reopenOrder, logAudit, getClientId, verifyManagerPin, getActiveTurno, getPaymentMethodsFromDB, type AuditLogEntry, type PagoForma, type PaymentMethodDB } from '@/lib/pos-data'
import { isTiempoItem } from '@/lib/pos-constants'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface CashMovement {
  id: string
  type: 'retiro' | 'deposito'
  amount: number
  reason: string
  actor: string
  approved_by: string
  created_at: string
}

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
  pagos?: PagoForma[] | null
  turno_id?: string | null
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

// Corte por turno: las órdenes cerradas llevan turno_id estampado al cobrar.
// Esto evita que un turno que cruza medianoche se parta en dos cortes.
async function getOrdersByTurno(turnoId: string): Promise<OrderFromDB[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${getClientId()}&turno_id=eq.${encodeURIComponent(turnoId)}&order=created_at.desc&limit=500`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

async function getCashMovementsByTurno(turnoId: string): Promise<CashMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cash_movements?client_id=eq.${getClientId()}&turno_id=eq.${encodeURIComponent(turnoId)}&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

async function getCashMovementsByDate(dateStr: string): Promise<CashMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cash_movements?client_id=eq.${getClientId()}&created_at=gte.${dateStr}T00:00:00&created_at=lte.${dateStr}T23:59:59&order=created_at.desc`,
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
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodDB[]>([])
  const [declarado, setDeclarado] = useState(0)
  const [turno, setTurno] = useState<{ id: string; fondo_inicial: number; opened_by: string; opened_at: string } | null>(null)
  // 'turno' = corte del turno activo (por turno_id); 'dia' = corte histórico por fecha
  const [corteMode, setCorteMode] = useState<'turno' | 'dia'>('turno')

  const fetchData = async () => {
    setLoading(true)
    const [a, pct, t, pm] = await Promise.all([
      getAuditLog(200),
      getCardCommissionPct(),
      getActiveTurno(),
      getPaymentMethodsFromDB(),
    ])
    // Por turno si hay turno abierto; si no, fallback a fecha
    const o = corteMode === 'turno' && t
      ? await getOrdersByTurno(t.id)
      : await getOrders(selectedDate)
    const cm = corteMode === 'turno' && t
      ? await getCashMovementsByTurno(t.id)
      : await getCashMovementsByDate(selectedDate)
    setOrders(o)
    setCashMovements(cm)
    setAuditLog(a)
    setCardPct(pct)
    setTurno(t)
    setPaymentMethods(pm)
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
      const mesa = reopenTarget.mesa
      setToast(`Cuenta Mesa ${mesa} reabierta — ve a Mesa ${mesa} en el POS`)
      setTimeout(() => setToast(null), 5000)
      window.open(`/pos?mesa=${mesa}`, '_blank')
      fetchData()
    }
    setReopenTarget(null)
    setReopenPin('')
    setReopenError('')
  }

  // ── Gate de acceso: el corte expone ventas/propinas/arqueo — requiere PIN de gerente ──
  const [accessGranted, setAccessGranted] = useState(() =>
    typeof window !== 'undefined' && sessionStorage.getItem('corte_access') === '1'
  )
  const [accessPin, setAccessPin] = useState('')
  const [accessError, setAccessError] = useState('')
  const [accessChecking, setAccessChecking] = useState(false)

  const handleAccess = async () => {
    if (!accessPin || accessChecking) return
    setAccessChecking(true)
    setAccessError('')
    const manager = await verifyManagerPin(accessPin)
    setAccessChecking(false)
    if (!manager) { setAccessError('PIN inválido'); setAccessPin(''); return }
    sessionStorage.setItem('corte_access', '1')
    logAudit({ order_id: 'corte', action: 'status_changed', actor: manager, details: { type: 'corte_viewed', date: selectedDate } })
    setAccessGranted(true)
  }

  useEffect(() => { if (accessGranted) fetchData() }, [selectedDate, accessGranted, corteMode])

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
    // Si la orden tiene pagos[] (pago mixto / formas custom), desglosamos por forma real.
    const byPayment: Record<string, number> = {}
    // Formato Wansoft: venta y propina separadas por forma (propina prorrateada por pago)
    const ventasPorForma: Record<string, number> = {}
    const propinaPorForma: Record<string, number> = {}
    for (const o of closed) {
      const propina = Number(o.propina) || 0
      const cobrado = o.total + propina
      const pagos: PagoForma[] = Array.isArray(o.pagos) && o.pagos.length > 0
        ? o.pagos
        : [{ metodo: o.metodo_pago || 'sin metodo', monto: cobrado }]
      const sumPagos = pagos.reduce((s, p) => s + p.monto, 0) || 1
      for (const p of pagos) {
        const frac = p.monto / sumPagos
        byPayment[p.metodo] = (byPayment[p.metodo] || 0) + p.monto
        ventasPorForma[p.metodo] = (ventasPorForma[p.metodo] || 0) + o.total * frac
        propinaPorForma[p.metodo] = (propinaPorForma[p.metodo] || 0) + propina * frac
      }
    }

    // ── Agrupación por tipo de forma de pago (usando catálogo pos_payment_methods) ──
    // Build a name->type lookup from the DB catalog (case-insensitive)
    const methodTypeMap: Record<string, string> = {}
    for (const pm of paymentMethods) {
      methodTypeMap[pm.name.toLowerCase()] = pm.type
    }
    const getMethodType = (name: string): string => {
      return methodTypeMap[name.toLowerCase()] || 'other'
    }

    // Group labels by type
    const typeLabels: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      terminal: 'Tarjeta',  // terminal (Clip) groups with card
      transfer: 'Transferencia',
      platform: 'Plataformas',
      other: 'Otros',
    }

    const byPaymentGroup: Record<string, number> = {}
    for (const [method, amount] of Object.entries(byPayment)) {
      const type = getMethodType(method)
      const label = typeLabels[type] || 'Otros'
      byPaymentGroup[label] = (byPaymentGroup[label] || 0) + amount
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

    // Comisión estimada sobre lo cobrado con tarjeta/terminal (incluye propina — la terminal cobra comisión sobre el monto completo)
    const totalTarjeta = Object.entries(byPayment)
      .filter(([m]) => { const t = getMethodType(m); return t === 'card' || t === 'terminal' })
      .reduce((s, [, v]) => s + v, 0)
    const comisionTarjeta = totalTarjeta * cardPct / 100

    // ── Arqueo de efectivo (formato Wansoft, spec 14.2) ──
    const isEfectivo = (m: string) => getMethodType(m) === 'cash'
    const ventasEfectivo = Object.entries(ventasPorForma).filter(([m]) => isEfectivo(m)).reduce((s, [, v]) => s + v, 0)
    const propinaEfectivo = Object.entries(propinaPorForma).filter(([m]) => isEfectivo(m)).reduce((s, [, v]) => s + v, 0)
    // Propinas cobradas por formas NO efectivo (se pagan al mesero en efectivo desde caja)
    const propinasNoEfectivo = Object.entries(propinaPorForma).filter(([m]) => !isEfectivo(m)).reduce((s, [, v]) => s + v, 0)

    // ── Información operativa ──
    let totalPlatillos = 0
    let ventasEnMesa = 0
    let ventasOtros = 0
    for (const o of closed) {
      try {
        const items: { menuItemId: string; cantidad: number }[] = JSON.parse(o.items)
        totalPlatillos += items.filter(it => !isTiempoItem(it)).reduce((s, it) => s + (it.cantidad || 1), 0)
      } catch { /* items ilegibles */ }
      if (o.mesa > 0) ventasEnMesa += o.total
      else ventasOtros += o.total
    }
    const descuentosCount = closed.filter(o => o.descuento > 0).length

    // ── Movimientos de caja ──
    const depositos = cashMovements.filter(m => m.type === 'deposito').reduce((s, m) => s + Number(m.amount), 0)
    const retiros = cashMovements.filter(m => m.type === 'retiro').reduce((s, m) => s + Number(m.amount), 0)

    return {
      ventasPorForma, propinaPorForma,
      ventasEfectivo, propinaEfectivo, propinasNoEfectivo,
      totalPlatillos, ventasEnMesa, ventasOtros, descuentosCount,
      totalVentas, totalSubtotal, totalIva, totalDescuentos, totalPropinas,
      totalTarjeta, comisionTarjeta,
      totalPersonas, ticketPromedio,
      depositos, retiros,
      ordenesCerradas: closed.length,
      ordenesAbiertas: all.filter(o => o.status === 'enviada' || o.status === 'abierta').length,
      ordenesCanceladas: cancelled.length,
      byPayment,
      byPaymentGroup,
      byMesero: Object.entries(byMesero).sort((a, b) => b[1].ventas - a[1].ventas),
      cancellations: cancellations.length,
    }
  }, [orders, auditLog, cardPct, cashMovements, paymentMethods])

  if (!accessGranted) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--surface)] text-white p-4">
        <div className="bg-[var(--surface-2)] border border-slate-700 rounded-2xl p-8 w-full max-w-sm text-center">
          <ShieldAlert size={40} className="mx-auto mb-4 text-amber-400" />
          <h1 className="text-lg font-bold mb-1">Corte de turno</h1>
          <p className="text-sm text-slate-400 mb-6">Acceso solo con PIN de gerente</p>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={accessPin}
            onChange={e => { setAccessPin(e.target.value); setAccessError('') }}
            onKeyDown={e => { if (e.key === 'Enter') handleAccess() }}
            placeholder="PIN"
            className="w-full bg-[var(--surface)] border border-slate-600 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] mb-3 focus:outline-none focus:border-emerald-500"
          />
          {accessError && <p className="text-red-400 text-sm mb-3">{accessError}</p>}
          <button
            onClick={handleAccess}
            disabled={accessChecking || !accessPin}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold py-3 rounded-xl transition-colors"
          >
            {accessChecking ? 'Verificando...' : 'Entrar'}
          </button>
          <Link href="/pos" className="block mt-4 text-sm text-slate-400 hover:text-white">Volver al POS</Link>
        </div>
      </div>
    )
  }

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
          <button onClick={fetchData} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            <button
              onClick={() => setCorteMode('turno')}
              className={`px-3 py-2 text-sm font-semibold ${corteMode === 'turno' ? 'bg-blue-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:text-white'}`}
            >
              Turno actual
            </button>
            <button
              onClick={() => setCorteMode('dia')}
              className={`px-3 py-2 text-sm font-semibold ${corteMode === 'dia' ? 'bg-blue-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:text-white'}`}
            >
              Por día
            </button>
          </div>
          {corteMode === 'dia' && (
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            />
          )}
          {corteMode === 'turno' && !loading && !turno && (
            <span className="text-xs text-amber-400">Sin turno abierto — mostrando hoy por fecha</span>
          )}
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {/* Alerta turno abierto demasiado tiempo */}
          {turno && (() => {
            const hoursOpen = (Date.now() - new Date(turno.opened_at).getTime()) / (1000 * 60 * 60)
            if (hoursOpen < 18) return null
            return (
              <div className="mb-6 bg-red-900/30 border border-red-600/50 rounded-xl px-5 py-4 flex items-start gap-3">
                <AlertTriangle size={22} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-300 font-bold text-sm">
                    Este turno lleva {Math.floor(hoursOpen)} horas abierto. ¿Olvidaste cerrarlo?
                  </p>
                  <p className="text-red-400/70 text-xs mt-1">
                    Abierto por {turno.opened_by} el {new Date(turno.opened_at).toLocaleString('es-MX', { timeZone: 'America/Monterrey' })}
                  </p>
                </div>
              </div>
            )
          })()}
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
              {/* Grouped by type */}
              <div className="space-y-3 mb-4">
                {Object.entries(stats.byPaymentGroup)
                  .sort((a, b) => b[1] - a[1])
                  .map(([group, total]) => (
                  <div key={group} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {group === 'Efectivo' ? <Banknote size={16} className="text-emerald-400" /> :
                       group === 'Tarjeta' ? <CreditCard size={16} className="text-blue-400" /> :
                       <DollarSign size={16} className="text-[var(--text-3)]" />}
                      <span className="text-[var(--text-4)]">{group}</span>
                    </div>
                    <span className="text-white font-semibold">{formatMXN(total)}</span>
                  </div>
                ))}
                {Object.keys(stats.byPaymentGroup).length === 0 && (
                  <p className="text-[var(--text-2)] text-sm">Sin pagos registrados</p>
                )}
              </div>
              {/* Detail by individual method */}
              {Object.keys(stats.byPayment).length > 0 && (
                <div className="border-t border-slate-700 pt-3 space-y-2">
                  <p className="text-[var(--text-2)] text-xs font-semibold tracking-wider mb-2">DETALLE</p>
                  {Object.entries(stats.byPayment)
                    .sort((a, b) => b[1] - a[1])
                    .map(([method, total]) => (
                    <div key={method} className="flex items-center justify-between">
                      <span className="text-[var(--text-3)] text-sm capitalize">{method}</span>
                      <span className="text-[var(--text-4)] text-sm">{formatMXN(total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reporte Corte Turno — formato Wansoft (spec 14.2) */}
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5 md:col-span-2">
              <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                <Receipt size={18} className="text-emerald-400" />
                Reporte Corte Turno
              </h3>
              <p className="text-[var(--text-2)] text-xs mb-4">
                {turno
                  ? `Turno abierto por ${turno.opened_by} · ${new Date(turno.opened_at).toLocaleString('es-MX', { timeZone: 'America/Monterrey' })} · Fondo ${formatMXN(Number(turno.fondo_inicial) || 0)}`
                  : 'Sin turno abierto — fondo de caja $0.00'}
              </p>
              <div className="grid md:grid-cols-3 gap-6 font-mono text-sm">
                {/* Columna 1: Totales + ventas por forma */}
                <div>
                  <p className="text-[var(--text-3)] font-bold mb-2 tracking-wider">TOTALES GENERALES</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Ventas</span><span className="text-white">{formatMXN(stats.totalVentas)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Propinas</span><span className="text-white">{formatMXN(stats.totalPropinas)}</span></div>
                    <div className="flex justify-between border-t border-slate-700 pt-1.5"><span className="text-white font-bold">Total cobrado</span><span className="text-emerald-400 font-bold">{formatMXN(stats.totalVentas + stats.totalPropinas)}</span></div>
                  </div>
                  <p className="text-[var(--text-3)] font-bold mt-4 mb-2 tracking-wider">VENTAS POR FORMA DE PAGO</p>
                  <div className="space-y-1.5">
                    {Object.entries(stats.ventasPorForma).map(([m, v]) => (
                      <div key={m} className="flex justify-between"><span className="text-[var(--text-4)] capitalize">{m}</span><span className="text-white">{formatMXN(v)}</span></div>
                    ))}
                    {Object.keys(stats.ventasPorForma).length === 0 && <p className="text-[var(--text-2)]">—</p>}
                  </div>
                  <p className="text-[var(--text-3)] font-bold mt-4 mb-2 tracking-wider">PROPINA POR FORMA DE PAGO</p>
                  <div className="space-y-1.5">
                    {Object.entries(stats.propinaPorForma).filter(([, v]) => v > 0.005).map(([m, v]) => (
                      <div key={m} className="flex justify-between"><span className="text-[var(--text-4)] capitalize">{m}</span><span className="text-amber-400">{formatMXN(v)}</span></div>
                    ))}
                    {Object.entries(stats.propinaPorForma).filter(([, v]) => v > 0.005).length === 0 && <p className="text-[var(--text-2)]">—</p>}
                  </div>
                </div>
                {/* Columna 2: Control de efectivo (arqueo) */}
                <div>
                  <p className="text-[var(--text-3)] font-bold mb-2 tracking-wider">CONTROL POR FORMA PAGO</p>
                  {(() => {
                    const fondo = Number(turno?.fondo_inicial) || 0
                    const esperado = fondo + stats.ventasEfectivo + stats.propinaEfectivo + stats.depositos - stats.retiros - stats.propinasNoEfectivo
                    return (
                      <div className="space-y-1.5">
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">Fondo de Caja</span><span className="text-white">{formatMXN(fondo)}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">+ Ventas efectivo</span><span className="text-white">{formatMXN(stats.ventasEfectivo)}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">+ Propina efectivo</span><span className="text-white">{formatMXN(stats.propinaEfectivo)}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">+ Depósitos</span><span className={stats.depositos > 0 ? 'text-emerald-400' : 'text-[var(--text-2)]'}>{formatMXN(stats.depositos)}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">− Retiros</span><span className={stats.retiros > 0 ? 'text-red-400' : 'text-[var(--text-2)]'}>{formatMXN(stats.retiros)}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--text-4)]">− Propinas x tarjeta/otros</span><span className="text-red-400">{formatMXN(stats.propinasNoEfectivo)}</span></div>
                        <div className="flex justify-between border-t border-slate-700 pt-1.5"><span className="text-white font-bold">= Esperado en caja</span><span className="text-emerald-400 font-bold">{formatMXN(esperado)}</span></div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[var(--text-4)]">Declarado</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="$0.00"
                            value={declarado || ''}
                            onChange={e => setDeclarado(parseFloat(e.target.value) || 0)}
                            className="w-28 bg-[var(--surface)] border border-slate-600 rounded-lg px-2 py-1.5 text-right text-white text-sm focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        {declarado > 0 && (() => {
                          const diff = declarado - esperado
                          const color = Math.abs(diff) < 1 ? 'text-emerald-400' : diff > 0 ? 'text-blue-400' : 'text-red-400'
                          const label = Math.abs(diff) < 1 ? 'Cuadra' : diff > 0 ? 'Sobrante' : 'Faltante'
                          return (
                            <div className="flex justify-between border-t border-slate-700 pt-1.5">
                              <span className={`font-bold ${color}`}>{label}</span>
                              <span className={`font-bold ${color}`}>{diff >= 0 ? '+' : ''}{formatMXN(diff)}</span>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })()}
                  {cashMovements.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <p className="text-[var(--text-3)] font-bold mb-1.5 tracking-wider text-xs">MOVIMIENTOS DE CAJA</p>
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {cashMovements.map(m => (
                          <div key={m.id} className="flex justify-between text-xs">
                            <span className="text-[var(--text-4)]">{m.type === 'deposito' ? '+' : '−'} {m.reason}</span>
                            <span className={m.type === 'deposito' ? 'text-emerald-400' : 'text-red-400'}>{formatMXN(Number(m.amount))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[var(--text-2)] text-xs mt-3 leading-relaxed">Las propinas cobradas con tarjeta/otras formas se pagan al mesero en efectivo desde caja (regla Wansoft).</p>
                </div>
                {/* Columna 3: Información operativa */}
                <div>
                  <p className="text-[var(--text-3)] font-bold mb-2 tracking-wider">INFORMACIÓN OPERATIVA</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Órdenes cerradas</span><span className="text-white">{stats.ordenesCerradas}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Platillos vendidos</span><span className="text-white">{stats.totalPlatillos}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Personas</span><span className="text-white">{stats.totalPersonas}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Promedio x persona</span><span className="text-white">{formatMXN(stats.totalPersonas > 0 ? stats.totalVentas / stats.totalPersonas : 0)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Promedio x orden</span><span className="text-white">{formatMXN(stats.ticketPromedio)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Ventas en mesa</span><span className="text-white">{formatMXN(stats.ventasEnMesa)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Ventas otros (llevar/barra)</span><span className="text-white">{formatMXN(stats.ventasOtros)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Descuentos aplicados</span><span className="text-white">{stats.descuentosCount} · {formatMXN(stats.totalDescuentos)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-4)]">Cancelaciones</span><span className="text-red-400">{stats.cancellations}</span></div>
                  </div>
                </div>
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
