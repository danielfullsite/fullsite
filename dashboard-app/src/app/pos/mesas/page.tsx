'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users, Calendar, RefreshCw, Merge, X, Clock, AlertTriangle } from 'lucide-react'
import { MESAS_CONFIG, formatMXN, logAudit } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Reserva {
  codigo_reserva: string
  nombre: string
  guests: number
  horario_inicio: string
  espacio: string
  status: string
}

interface ActiveOrder {
  mesa: number
  mesero: string
  personas: number
  total: number
  status: string
  created_at: string
}

export default function MesasPage() {
  const router = useRouter()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [loading, setLoading] = useState(true)
  const [soloMisMesas, setSoloMisMesas] = useState(false)
  const [currentMesero, setCurrentMesero] = useState<string>('')

  // Get current mesero from URL or localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = params.get('mesero') || localStorage.getItem('pos_mesero') || ''
    setCurrentMesero(m)
  }, [])

  const fetchData = async () => {
    try {
      // Fetch active orders (not closed/cancelled)
      const ordersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?status=in.(enviada,preparando,lista,abierta)&order=created_at.desc&limit=50`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
      )
      const orders: ActiveOrder[] = ordersRes.ok ? await ordersRes.json() : []
      setActiveOrders(orders)

      // Fetch today's reservations
      const today = new Date().toISOString().split('T')[0]
      const resRes = await fetch(
        `${SUPABASE_URL}/rest/v1/amalay_reservaciones?fecha=eq.${today}&status=neq.cancelled&order=horario_inicio.asc&select=codigo_reserva,nombre,guests,horario_inicio,espacio,status`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const res: Reserva[] = resRes.ok ? await resRes.json() : []
      setReservas(res)
    } catch { /* */ }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  // Build mesa states from active orders
  const ordersByMesa = new Map<number, ActiveOrder>()
  for (const order of activeOrders) {
    // Keep the most recent order per mesa
    if (!ordersByMesa.has(order.mesa)) {
      ordersByMesa.set(order.mesa, order)
    }
  }

  const mesas: Mesa[] = MESAS_CONFIG.map(m => {
    const order = ordersByMesa.get(m.number)
    if (order) {
      return {
        ...m,
        status: order.status === 'lista' ? 'cuenta' as const : 'ocupada' as const,
        mesero: order.mesero,
        personas: order.personas,
        total: order.total,
      }
    }
    return m
  })

  const statusColor: Record<string, string> = {
    disponible: 'bg-emerald-900/50 border-emerald-600 hover:bg-emerald-800/60',
    ocupada: 'bg-blue-900/50 border-blue-600 hover:bg-blue-800/60',
    cuenta: 'bg-amber-900/50 border-amber-600 hover:bg-amber-800/60',
  }

  const statusLabel: Record<string, string> = {
    disponible: 'Disponible',
    ocupada: 'Ocupada',
    cuenta: 'Lista',
  }

  const statusDot: Record<string, string> = {
    disponible: 'bg-emerald-400',
    ocupada: 'bg-blue-400',
    cuenta: 'bg-amber-400',
  }

  const counts = {
    disponible: mesas.filter(m => m.status === 'disponible').length,
    ocupada: mesas.filter(m => m.status === 'ocupada').length,
    cuenta: mesas.filter(m => m.status === 'cuenta').length,
  }

  const totalPersonas = mesas.reduce((s, m) => s + (m.personas || 0), 0)
  const totalVentas = mesas.reduce((s, m) => s + (m.total || 0), 0)
  const ticketPromedio = totalPersonas > 0 ? totalVentas / totalPersonas : 0

  // Timer: minutes since order created per mesa
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000) // refresh every 30s
    return () => clearInterval(timer)
  }, [])

  const getMinutes = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)

  const ALERT_THRESHOLD = 90 // minutes
  const WARNING_THRESHOLD = 60
  const alertMesas = activeOrders.filter(o => getMinutes(o.created_at) >= ALERT_THRESHOLD)

  // ─── Merge Mesas ──────────────────────────────────────────────────────
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSource, setMergeSource] = useState<number | null>(null)
  const [mergeTarget, setMergeTarget] = useState<number | null>(null)
  const [merging, setMerging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget || merging) return
    const sourceOrder = activeOrders.find(o => o.mesa === mergeSource)
    const targetOrder = activeOrders.find(o => o.mesa === mergeTarget)
    if (!sourceOrder || !targetOrder) { showToast('Ambas mesas deben tener ordenes activas'); return }

    setMerging(true)
    try {
      // Get full source order with items
      const srcRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?mesa=eq.${mergeSource}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const tgtRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?mesa=eq.${mergeTarget}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!srcRes.ok || !tgtRes.ok) { showToast('Error al cargar ordenes'); setMerging(false); return }
      const [srcOrder] = await srcRes.json()
      const [tgtOrder] = await tgtRes.json()
      if (!srcOrder || !tgtOrder) { showToast('No se encontraron ordenes'); setMerging(false); return }

      // Merge items
      const srcItems = typeof srcOrder.items === 'string' ? JSON.parse(srcOrder.items) : (srcOrder.items || [])
      const tgtItems = typeof tgtOrder.items === 'string' ? JSON.parse(tgtOrder.items) : (tgtOrder.items || [])
      const mergedItems = [...tgtItems, ...srcItems]
      const newTotal = Number(tgtOrder.total || 0) + Number(srcOrder.total || 0)
      const newSubtotal = Number(tgtOrder.subtotal || 0) + Number(srcOrder.subtotal || 0)
      const newIva = Number(tgtOrder.iva || 0) + Number(srcOrder.iva || 0)
      const newPersonas = (tgtOrder.personas || 0) + (srcOrder.personas || 0)

      // Update target order with merged items
      await fetch(`${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${tgtOrder.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          items: JSON.stringify(mergedItems),
          total: newTotal, subtotal: newSubtotal, iva: newIva,
          personas: newPersonas,
          notas: `Merge: mesa ${mergeSource} → mesa ${mergeTarget}. ${tgtOrder.notas || ''}`.trim(),
        }),
      })

      // Cancel source order
      await fetch(`${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${srcOrder.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'cancelada', notas: `Merged a mesa ${mergeTarget}` }),
      })

      logAudit({
        order_id: tgtOrder.id, action: 'status_changed', actor: 'Sistema',
        details: { type: 'mesa_merge', from_mesa: mergeSource, to_mesa: mergeTarget, items_moved: srcItems.length },
      })

      showToast(`Mesa ${mergeSource} fusionada con mesa ${mergeTarget}`)
      setMergeMode(false)
      setMergeSource(null)
      setMergeTarget(null)
      fetchData()
    } catch {
      showToast('Error al fusionar mesas')
    }
    setMerging(false)
  }

  const handleMesaClick = (mesaNum: number) => {
    if (!mergeMode) {
      router.push(`/pos?mesa=${mesaNum}`)
      return
    }
    // Merge mode: select source, then target
    if (!mergeSource) {
      setMergeSource(mesaNum)
    } else if (mesaNum !== mergeSource) {
      setMergeTarget(mesaNum)
    }
  }

  return (
    <div className="h-screen flex flex-col text-white">
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Mesas</h1>
            <p className="text-[var(--text-3)] text-sm">
              {activeOrders.length} ordenes · {totalPersonas} personas · TP {formatMXN(ticketPromedio)}
              {activeOrders.length > 0 && (() => {
                const avgMins = Math.round(activeOrders.reduce((s, o) => s + getMinutes(o.created_at), 0) / activeOrders.length)
                return <span className={avgMins > 60 ? 'text-amber-400' : ''}> · Prom: {avgMins}m</span>
              })()}
            </p>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
          {currentMesero && (
            <button
              onClick={() => setSoloMisMesas(!soloMisMesas)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                soloMisMesas ? 'bg-emerald-500 text-black' : 'bg-[var(--line)] hover:bg-slate-600 text-[var(--text-3)]'
              }`}
            >
              <Users size={14} />
              {soloMisMesas ? 'Mis mesas' : 'Todas'}
            </button>
          )}
          <button
            onClick={() => { setMergeMode(!mergeMode); setMergeSource(null); setMergeTarget(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mergeMode ? 'bg-amber-500 text-black' : 'bg-[var(--line)] hover:bg-slate-600 text-[var(--text-3)]'
            }`}
          >
            {mergeMode ? <X size={14} /> : <Merge size={14} />}
            {mergeMode ? 'Cancelar' : 'Fusionar'}
          </button>
        </div>
        <div className="flex items-center gap-6">
          {Object.entries(counts).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${statusDot[status]}`} />
              <span className="text-sm text-[var(--text-4)]">
                {statusLabel[status]} <span className="text-[var(--text-2)]">({count})</span>
              </span>
            </div>
          ))}
        </div>
      </header>

      {/* Alert banner for slow tables */}
      {alertMesas.length > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl animate-pulse">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400 font-medium">
            {alertMesas.length} mesa{alertMesas.length > 1 ? 's' : ''} con +{ALERT_THRESHOLD} min:{' '}
            {alertMesas.map(o => `Mesa ${o.mesa} (${getMinutes(o.created_at)}m)`).join(', ')}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
              {mesas.filter(mesa => {
                if (!soloMisMesas || !currentMesero) return true
                // Show: own occupied mesas + all available mesas
                return mesa.status === 'disponible' || mesa.mesero === currentMesero
              }).map(mesa => (
                <button
                  key={mesa.number}
                  onClick={() => handleMesaClick(mesa.number)}
                  className={`rounded-2xl border-2 p-5 transition-all active:scale-95 min-h-[160px] flex flex-col justify-between ${
                    mergeSource === mesa.number ? 'ring-4 ring-amber-400 border-amber-400 bg-amber-900/50' :
                    mergeTarget === mesa.number ? 'ring-4 ring-emerald-400 border-emerald-400 bg-emerald-900/50' :
                    statusColor[mesa.status]
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-3xl font-bold">{mesa.number}</span>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      mesa.status === 'disponible' ? 'bg-emerald-600/30 text-emerald-300' :
                      mesa.status === 'ocupada' ? 'bg-blue-600/30 text-blue-300' :
                      'bg-amber-600/30 text-amber-300'
                    }`}>
                      {statusLabel[mesa.status]}
                    </span>
                  </div>
                  <div className="mt-3">
                    {mesa.status !== 'disponible' ? (() => {
                      const order = ordersByMesa.get(mesa.number)
                      const mins = order ? getMinutes(order.created_at) : 0
                      const isAlert = mins >= ALERT_THRESHOLD
                      const isWarning = mins >= WARNING_THRESHOLD && mins < ALERT_THRESHOLD
                      return (
                      <>
                        {/* Timer */}
                        <div className={`flex items-center gap-1 mb-1.5 ${isAlert ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>
                          <Clock size={12} />
                          <span className={`text-xs font-mono font-bold ${isAlert ? 'animate-pulse' : ''}`}>
                            {mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`}
                          </span>
                          {isAlert && <AlertTriangle size={10} className="text-red-400" />}
                        </div>
                        <p className="text-[var(--text-4)] text-sm truncate">{mesa.mesero}</p>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1 text-[var(--text-3)] text-sm">
                            <Users size={14} />
                            <span className="font-semibold text-white">{mesa.personas}</span>
                          </div>
                          {mesa.total != null && (
                            <span className="text-white font-semibold">{formatMXN(mesa.total)}</span>
                          )}
                        </div>
                        {mesa.personas && mesa.personas > 0 && mesa.total ? (
                          <p className="text-xs text-[var(--text-2)] mt-1">
                            TP: <span className="text-emerald-400 font-semibold">{formatMXN(mesa.total / mesa.personas)}</span>/pers
                          </p>
                        ) : null}
                      </>
                      )
                    })() : (
                      <p className="text-[var(--text-2)] text-sm">{mesa.capacity} lugares</p>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Reservaciones de hoy */}
            {reservas.length > 0 && (
              <div className="max-w-5xl mx-auto mt-6">
                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                  <Calendar size={18} className="text-amber-400" />
                  Reservaciones hoy ({reservas.length})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {reservas.map(r => (
                    <div key={r.codigo_reserva} className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-amber-400 font-bold text-sm">{r.horario_inicio?.slice(0, 5)}</span>
                        <span className="text-amber-400/60 text-xs">{r.codigo_reserva}</span>
                      </div>
                      <p className="text-white font-medium">{r.nombre}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[var(--text-3)] text-sm flex items-center gap-1"><Users size={12} /> {r.guests} personas</span>
                        <span className="text-[var(--text-2)] text-xs">{r.espacio}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Merge mode instructions + confirm */}
      {mergeMode && (
        <div className="px-6 py-3 bg-amber-900/30 border-t border-amber-700/40 flex items-center justify-between">
          <div className="text-sm">
            {!mergeSource ? (
              <span className="text-amber-400">Toca la mesa <strong>origen</strong> (la que se mueve)</span>
            ) : !mergeTarget ? (
              <span className="text-amber-400">Mesa {mergeSource} seleccionada. Ahora toca la mesa <strong>destino</strong></span>
            ) : (
              <span className="text-emerald-400">Mesa {mergeSource} → Mesa {mergeTarget}</span>
            )}
          </div>
          {mergeSource && mergeTarget && (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 disabled:opacity-50"
            >
              {merging ? 'Fusionando...' : `Fusionar mesa ${mergeSource} → ${mergeTarget}`}
            </button>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--surface-2)] border border-[var(--line)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
