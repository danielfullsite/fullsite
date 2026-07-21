'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users, Calendar, RefreshCw, Merge, X, Clock, AlertTriangle, LayoutGrid, Map, UserPlus, Lock as LockIcon, Power } from 'lucide-react'
import { MESAS_CONFIG, formatMXN, logAudit, verifyManagerPin } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


// ─── Plano arquitectónico AMALAY ─────────────────────────────────────────────
// Réplica del "PLANO DE MESAS DE RESTAURANTE" físico (foto 2026-06-10).
// Cada mesa tiene posición (x,y en % del canvas), forma y sillas dibujadas.

type TableShape = 'round' | 'round-lg' | 'square' | 'rect-h'

interface FloorTable {
  number: number
  x: number  // % desde la izquierda (centro de la mesa)
  y: number  // % desde arriba (centro de la mesa)
  shape: TableShape
}

const TABLE_SIZE: Record<TableShape, { w: number; h: number }> = {
  round: { w: 70, h: 70 },
  'round-lg': { w: 90, h: 90 },
  square: { w: 74, h: 68 },
  'rect-h': { w: 108, h: 58 },
}

// Posiciones calcadas del plano físico
const FLOOR_TABLES: FloorTable[] = [
  // ── Fila 1: 45 | divisor | 1 2 3 (ENTRADA) · 5 6 7 (LÁMPARAS) · 50 53 (TOLDO)
  { number: 45, x: 8, y: 8, shape: 'round' },
  { number: 1, x: 21, y: 8, shape: 'round' },
  { number: 2, x: 30, y: 8, shape: 'round' },
  { number: 3, x: 39, y: 8, shape: 'round' },
  { number: 5, x: 55, y: 8, shape: 'rect-h' },
  { number: 6, x: 64, y: 8, shape: 'rect-h' },
  { number: 7, x: 73, y: 8, shape: 'rect-h' },
  { number: 50, x: 84, y: 8, shape: 'rect-h' },
  { number: 53, x: 94, y: 8, shape: 'rect-h' },
  // ── Fila 2: 4 (entrada) · 9 8 (lámparas) · 51 52 (TOLDO)
  { number: 4, x: 30, y: 26, shape: 'round' },
  { number: 9, x: 59, y: 26, shape: 'round' },
  { number: 8, x: 68, y: 26, shape: 'round' },
  { number: 51, x: 84, y: 26, shape: 'rect-h' },
  { number: 52, x: 94, y: 26, shape: 'rect-h' },
  // ── Fila 3: 44 pasillo · 21 20 terraza · 10 barra · 55 54 (TOLDO)
  { number: 44, x: 8, y: 44, shape: 'round' },
  { number: 21, x: 25, y: 44, shape: 'square' },
  { number: 20, x: 36, y: 44, shape: 'round' },
  { number: 10, x: 57, y: 44, shape: 'square' },
  { number: 55, x: 84, y: 44, shape: 'rect-h' },
  { number: 54, x: 94, y: 44, shape: 'rect-h' },
  // ── Fila 4: 32 31 30 terraza · 11 barra · 61 63 (PRIVADO)
  { number: 32, x: 25, y: 62, shape: 'round' },
  { number: 31, x: 35, y: 62, shape: 'round' },
  { number: 30, x: 43, y: 62, shape: 'round-lg' },
  { number: 11, x: 57, y: 62, shape: 'square' },
  { number: 61, x: 84, y: 66, shape: 'rect-h' },
  { number: 63, x: 94, y: 66, shape: 'rect-h' },
  // ── Fila 5: 43 pasillo · 42 41 40 terraza · 12 barra · 60 62 (PRIVADO)
  { number: 43, x: 8, y: 80, shape: 'round' },
  { number: 42, x: 24, y: 80, shape: 'rect-h' },
  { number: 41, x: 35, y: 80, shape: 'rect-h' },
  { number: 40, x: 46, y: 80, shape: 'rect-h' },
  { number: 12, x: 57, y: 80, shape: 'square' },
  { number: 60, x: 84, y: 84, shape: 'rect-h' },
  { number: 62, x: 94, y: 84, shape: 'rect-h' },
]

interface FloorLabel { text: string; x: number; y: number; vertical?: boolean }

const FLOOR_LABELS: FloorLabel[] = [
  { text: 'ENTRADA', x: 30, y: 18 },
  { text: 'LÁMPARAS', x: 64, y: 18 },
  { text: 'PASILLO', x: 2.5, y: 60, vertical: true },
  { text: 'TERRAZA', x: 35, y: 53 },
  { text: 'BARRA', x: 64, y: 53 },
  { text: 'TOLDO', x: 89, y: 1.5 },
  { text: 'PRIVADO', x: 89, y: 58 },
]

// Paredes / muros del plano (verde = muro terraza, vino = barra física)
interface FloorWall { x: number; y: number; w: number; h: number; color: 'green' | 'maroon' }

const FLOOR_WALLS: FloorWall[] = [
  // Divisor verde junto a mesa 45 (entrada)
  { x: 14.5, y: 2, w: 0.6, h: 14, color: 'green' },
  // Muro terraza: vertical izquierdo (superior), horizontal superior, bloque vino esquina, vertical derecho
  { x: 18, y: 35, w: 0.6, h: 20, color: 'green' },
  { x: 18, y: 35, w: 23, h: 1.5, color: 'green' },
  { x: 41, y: 34, w: 7.5, h: 3, color: 'maroon' },
  { x: 49, y: 37, w: 0.6, h: 53, color: 'green' },
  // Muro terraza: vertical izquierdo (inferior, junto a 42)
  { x: 18, y: 72, w: 0.6, h: 18, color: 'green' },
  // Barra física en L (vino)
  { x: 70, y: 36, w: 7, h: 5, color: 'maroon' },
  { x: 70, y: 36, w: 4, h: 52, color: 'maroon' },
]

// ─── Types ───────────────────────────────────────────────────────────────────

interface Reserva {
  codigo_reserva: string
  nombre: string
  guests: number
  horario_inicio: string
  espacio: string
  status: string
}

interface ActiveOrder {
  id: string
  mesa: number
  customer_name: string | null
  order_number: number | null
  mesero: string
  personas: number
  total: number
  status: string
  created_at: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MesasPage() {
  const router = useRouter()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>(() => {
    // Pre-populate from localStorage cache for instant render
    if (typeof window === 'undefined') return []
    try {
      const cached = localStorage.getItem('pos_mesas_orders')
      if (cached) {
        const c = JSON.parse(cached)
        if (c.ts && Date.now() - c.ts < 30000 && c.orders) return c.orders
      }
    } catch {}
    return []
  })
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [loading, setLoading] = useState(true)
  const [soloMisMesas, setSoloMisMesas] = useState(false)
  const [currentMesero, setCurrentMesero] = useState<string>('')
  const [viewMode, setViewMode] = useState<'planograma' | 'grid'>('planograma')
  const [staffName, setStaffName] = useState<string>('')
  const [turnoNum, setTurnoNum] = useState<number | null>(null)
  const [showNewCuenta, setShowNewCuenta] = useState(false)
  const [newCuentaName, setNewCuentaName] = useState('')

  // Staff + turno (estilo Wansoft: "Usuario: X · Turno: N")
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) setStaffName(JSON.parse(saved).name || '')
    } catch { /* */ }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_turnos?client_id=eq.${_cid()}&opened_at=gte.${today.toISOString()}&select=id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
      .then(r => r.ok ? r.json() : [])
      .then((rows: unknown[]) => { if (rows.length > 0) setTurnoNum(rows.length) })
      .catch(() => { /* */ })
  }, [])

  // Escala del plano: cabe en ancho Y alto sin scroll
  const PLANO_BASE_W = 1200
  const PLANO_BASE_H = 500
  const [planoScale, setPlanoScale] = useState(0.85)
  useEffect(() => {
    const compute = () => {
      const availW = window.innerWidth - 32
      const availH = window.innerHeight - 180
      const s = Math.min(availW / PLANO_BASE_W, availH / PLANO_BASE_H)
      if (s > 0.2) setPlanoScale(s)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = params.get('mesero') || localStorage.getItem('pos_mesero') || ''
    setCurrentMesero(m)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, resRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&status=in.(enviada,preparando,lista,abierta,entregada)&order=created_at.desc&limit=50`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/amalay_reservaciones?fecha=eq.${new Date().toISOString().split('T')[0]}&status=neq.cancelled&order=horario_inicio.asc&select=codigo_reserva,nombre,guests,horario_inicio,espacio,status`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        ),
      ])
      const orders = ordersRes.ok ? await ordersRes.json() : []
      setActiveOrders(orders)
      try { localStorage.setItem('pos_mesas_orders', JSON.stringify({ orders, ts: Date.now() })) } catch {}
      setReservas(resRes.ok ? await resRes.json() : [])
    } catch { /* */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    // Refresh immediately when page becomes visible (returning from order)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchData() }
    document.addEventListener('visibilitychange', onVisible)
    // Also refresh on popstate (back navigation from order page)
    const onFocus = () => fetchData()
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onFocus)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onFocus)
    }
  }, [fetchData])

  // Cuentas por nombre (sin mesa, estilo Wansoft "#SR RAUL")
  const namedOrders = activeOrders.filter(o => o.customer_name && (!o.mesa || o.mesa === 0))

  // Build mesa states
  const ordersByMesa: globalThis.Map<number, ActiveOrder> = new globalThis.Map()
  for (const order of activeOrders) {
    if (order.customer_name && (!order.mesa || order.mesa === 0)) continue
    if (!ordersByMesa.has(order.mesa)) ordersByMesa.set(order.mesa, order)
  }

  const mesaMap: globalThis.Map<number, Mesa> = new globalThis.Map()
  for (const m of MESAS_CONFIG) {
    const order = ordersByMesa.get(m.number)
    mesaMap.set(m.number, order ? {
      ...m,
      status: order.status === 'lista' ? 'cuenta' as const : 'ocupada' as const,
      mesero: order.mesero,
      personas: order.personas,
      total: order.total,
    } : m)
  }

  const mesas = Array.from(mesaMap.values())

  // Assign consistent colors to meseros
  const MESERO_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4', '#84cc16', '#f43f5e', '#a855f7', '#14b8a6', '#eab308']
  const uniqueMeseros = Array.from(new Set(mesas.filter(m => m.mesero).map(m => m.mesero as string)))
  const meseroColorMap: Record<string, string> = {}
  uniqueMeseros.forEach((m, i) => { meseroColorMap[m] = MESERO_COLORS[i % MESERO_COLORS.length] })

  const getMesaColor = (mesa: Mesa): string => {
    if (mesa.status === 'disponible') return 'bg-emerald-900/40 border-emerald-600/60 hover:bg-emerald-800/50'
    if (mesa.status === 'cuenta') return 'bg-amber-900/40 border-amber-500/60 hover:bg-amber-800/50'
    return 'bg-blue-900/40 border-blue-500/60 hover:bg-blue-800/50'
  }
  const getMeseroBorderStyle = (mesa: Mesa): React.CSSProperties => {
    if (mesa.status === 'disponible' || !mesa.mesero) return {}
    const color = meseroColorMap[mesa.mesero]
    return color ? { borderColor: color, boxShadow: `0 0 12px ${color}50`, backgroundColor: `${color}20` } : {}
  }

  const statusColor: Record<string, string> = {
    disponible: 'bg-emerald-900/40 border-emerald-600/60 hover:bg-emerald-800/50',
    ocupada: 'bg-blue-900/40 border-blue-500/60 hover:bg-blue-800/50',
    cuenta: 'bg-amber-900/40 border-amber-500/60 hover:bg-amber-800/50',
  }
  const statusLabel: Record<string, string> = { disponible: 'Disponible', ocupada: 'Ocupada', cuenta: 'Lista' }
  const statusDot: Record<string, string> = { disponible: 'bg-emerald-400', ocupada: 'bg-blue-400', cuenta: 'bg-amber-400' }

  const counts = {
    disponible: mesas.filter(m => m.status === 'disponible').length,
    ocupada: mesas.filter(m => m.status === 'ocupada').length,
    cuenta: mesas.filter(m => m.status === 'cuenta').length,
  }

  const totalPersonas = mesas.reduce((s, m) => s + (m.personas || 0), 0)
  const totalVentas = mesas.reduce((s, m) => s + (m.total || 0), 0)
  const ticketPromedio = totalPersonas > 0 ? totalVentas / totalPersonas : 0

  // Timer
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])
  const getMinutes = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  const formatHoraAbrir = (createdAt: string) =>
    new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()

  const ALERT_THRESHOLD = 90
  const WARNING_THRESHOLD = 60
  const alertMesas = activeOrders.filter(o => getMinutes(o.created_at) >= ALERT_THRESHOLD)

  // Merge mode
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
      const [srcRes, tgtRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&mesa=eq.${mergeSource}&status=in.(abierta,enviada,preparando,lista,entregada)&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&mesa=eq.${mergeTarget}&status=in.(abierta,enviada,preparando,lista,entregada)&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }),
      ])
      if (!srcRes.ok || !tgtRes.ok) { showToast('Error al cargar ordenes'); setMerging(false); return }
      const [srcOrder] = await srcRes.json()
      const [tgtOrder] = await tgtRes.json()
      if (!srcOrder || !tgtOrder) { showToast('No se encontraron ordenes'); setMerging(false); return }

      const srcItems = typeof srcOrder.items === 'string' ? JSON.parse(srcOrder.items) : (srcOrder.items || [])
      const tgtItems = typeof tgtOrder.items === 'string' ? JSON.parse(tgtOrder.items) : (tgtOrder.items || [])
      const mergedItems = [...tgtItems, ...srcItems]
      const newTotal = Number(tgtOrder.total || 0) + Number(srcOrder.total || 0)
      const newSubtotal = Number(tgtOrder.subtotal || 0) + Number(srcOrder.subtotal || 0)
      const newIva = Number(tgtOrder.iva || 0) + Number(srcOrder.iva || 0)
      const newPersonas = (tgtOrder.personas || 0) + (srcOrder.personas || 0)

      // R2D1B Phase 1: Atomic cross-order merge via revision-aware server boundary
      const mergeRes = await fetch('/api/pos/merge-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_order_id: tgtOrder.id,
          target_expected_revision: tgtOrder.order_revision ?? 0,
          source_order_id: srcOrder.id,
          source_expected_revision: srcOrder.order_revision ?? 0,
          merged_items: mergedItems,
          total: newTotal, subtotal: newSubtotal, iva: newIva,
          personas: newPersonas,
          notas: `Merge: mesa ${mergeSource} → mesa ${mergeTarget}. ${tgtOrder.notas || ''}`.trim(),
        }),
      })
      const mergeResult = mergeRes.ok ? await mergeRes.json() : { ok: false }
      if (mergeResult.conflict || mergeResult.error === 'STALE_WRITE_REJECTED') {
        showToast('Orden modificada por otra terminal — recarga'); setMerging(false); return
      }
      if (!mergeResult.ok) {
        showToast('Error al fusionar mesas'); setMerging(false); return
      }

      logAudit({
        order_id: tgtOrder.id, action: 'status_changed', actor: 'Sistema',
        details: { type: 'mesa_merge', from_mesa: mergeSource, to_mesa: mergeTarget, items_moved: srcItems.length },
      })

      showToast(`Mesa ${mergeSource} fusionada con mesa ${mergeTarget}`)
      setMergeMode(false); setMergeSource(null); setMergeTarget(null)
      fetchData()
    } catch { showToast('Error al fusionar mesas') }
    setMerging(false)
  }

  // Get staff role for permission checks
  const staffRole = (() => {
    try { const s = sessionStorage.getItem('pos_staff'); return s ? JSON.parse(s).role || 'mesero' : 'mesero' } catch { return 'mesero' }
  })()

  // PIN prompt for protected actions (cerrar app)
  const [pinPrompt, setPinPrompt] = useState<{ title: string; onSubmit: (pin: string) => void } | null>(null)
  const [pinInput, setPinInput] = useState('')

  const handleMesaClick = (mesaNum: number) => {
    if (mergeMode) {
      if (!mergeSource) setMergeSource(mesaNum)
      else if (mesaNum !== mergeSource) setMergeTarget(mesaNum)
      return
    }
    // Cajero can only open occupied tables (to charge), not empty ones
    if (staffRole === 'cajero' && !ordersByMesa.has(mesaNum)) {
      return // silently ignore — cajero can't open new restaurant tables
    }
    router.push(`/pos?mesa=${mesaNum}`)
  }

  // ─── Mesa Card (shared between views) ─────────────────────────────────────
  const MesaCard = ({ mesa, compact, shape }: { mesa: Mesa; compact?: boolean; shape?: string }) => {
    const order = ordersByMesa.get(mesa.number)
    const mins = order ? getMinutes(order.created_at) : 0
    const isAlert = mins >= ALERT_THRESHOLD
    const isWarning = mins >= WARNING_THRESHOLD && mins < ALERT_THRESHOLD

    const shapeClass = shape === 'round' ? 'rounded-full' :
                       shape === 'rect-h' ? 'rounded-2xl' :
                       shape === 'rect-v' ? 'rounded-2xl' : 'rounded-2xl'

    return (
      <button
        onClick={() => handleMesaClick(mesa.number)}
        className={`border-2 p-3 transition-all active:scale-95 flex flex-col justify-between w-full h-full ${shapeClass} ${
          mergeSource === mesa.number ? 'ring-4 ring-amber-400 border-amber-400 bg-amber-900/50' :
          mergeTarget === mesa.number ? 'ring-4 ring-emerald-400 border-emerald-400 bg-emerald-900/50' :
          getMesaColor(mesa)
        }`}
        style={mergeSource !== mesa.number && mergeTarget !== mesa.number ? getMeseroBorderStyle(mesa) : {}}
      >
        <div className="flex items-start justify-between">
          <span className={`${compact ? 'text-xl' : 'text-2xl'} font-bold`}>{mesa.number}</span>
          {!compact && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              mesa.status === 'disponible' ? 'bg-emerald-600/30 text-emerald-300' :
              mesa.status === 'ocupada' ? 'bg-blue-600/30 text-blue-300' :
              'bg-amber-600/30 text-amber-300'
            }`}>
              {statusLabel[mesa.status]}
            </span>
          )}
        </div>
        {mesa.status !== 'disponible' ? (
          <div className={compact ? 'mt-1' : 'mt-2'}>
            {order && (
              <div className={`flex items-center gap-1 mb-0.5 ${isAlert ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>
                <Clock size={10} />
                <span className={`text-[10px] font-mono font-bold ${isAlert ? 'animate-pulse' : ''}`}>
                  {mins >= 60 ? `${Math.floor(mins/60)}h${mins%60}m` : `${mins}m`}
                </span>
                {isAlert && <AlertTriangle size={9} className="text-red-400" />}
              </div>
            )}
            {!compact && <p className="text-[var(--text-4)] text-xs truncate">{mesa.mesero}</p>}
            {!compact && order && (
              <div className="flex items-center justify-between text-[10px] text-[var(--text-3)]">
                <span>Abrió {formatHoraAbrir(order.created_at)}</span>
                {order.order_number != null && <span className="font-mono">#{order.order_number}</span>}
              </div>
            )}
            <div className="flex items-center justify-between mt-0.5">
              <div className="flex items-center gap-1 text-[var(--text-3)] text-xs">
                <Users size={11} />
                <span className="font-semibold text-white">{mesa.personas}</span>
              </div>
              {mesa.total != null && (
                <span className="text-white font-semibold text-xs">{formatMXN(mesa.total)}</span>
              )}
            </div>
          </div>
        ) : (
          <p className={`text-[var(--text-3)] ${compact ? 'text-[10px]' : 'text-xs'} mt-1`}>
            {mesa.capacity} lug.
          </p>
        )}
      </button>
    )
  }

  // ─── Planograma View (plano arquitectónico) ───────────────────────────────

  // Sillas alrededor de una mesa, según forma y capacidad
  const Chairs = ({ shape, capacity, status }: { shape: TableShape; capacity: number; status: string }) => {
    const { w, h } = TABLE_SIZE[shape]
    const chairClass = `absolute w-[12px] h-[12px] rounded-full ${
      status === 'ocupada' ? 'bg-blue-500/70' :
      status === 'cuenta' ? 'bg-amber-500/70' : 'bg-slate-500/60'
    }`
    const chairs: { left: number; top: number }[] = []

    if (shape === 'rect-h') {
      const top = Math.ceil(capacity / 2)
      const bottom = capacity - top
      for (let i = 0; i < top; i++) chairs.push({ left: ((i + 0.5) / top) * w - 5, top: -12 })
      for (let i = 0; i < bottom; i++) chairs.push({ left: ((i + 0.5) / bottom) * w - 5, top: h + 2 })
    } else if (shape === 'square') {
      const sides = [
        { left: w / 2 - 5, top: -12 }, { left: w / 2 - 5, top: h + 2 },
        { left: -12, top: h / 2 - 5 }, { left: w + 2, top: h / 2 - 5 },
      ]
      for (let i = 0; i < Math.min(capacity, 4); i++) chairs.push(sides[i])
    } else {
      const r = w / 2 + 7
      const offset = capacity === 4 ? Math.PI / 4 : -Math.PI / 2
      for (let i = 0; i < capacity; i++) {
        const angle = offset + (i * 2 * Math.PI) / capacity
        chairs.push({ left: w / 2 + r * Math.cos(angle) - 5, top: h / 2 + r * Math.sin(angle) - 5 })
      }
    }

    return (
      <>
        {chairs.map((c, i) => (
          <div key={i} className={chairClass} style={{ left: c.left, top: c.top }} />
        ))}
      </>
    )
  }

  const FloorTableNode = ({ ft }: { ft: FloorTable }) => {
    const mesa = mesaMap.get(ft.number)
    if (!mesa) return null
    const order = ordersByMesa.get(mesa.number)
    const mins = order ? getMinutes(order.created_at) : 0
    const isAlert = mins >= ALERT_THRESHOLD
    const isWarning = mins >= WARNING_THRESHOLD && mins < ALERT_THRESHOLD
    const { w, h } = TABLE_SIZE[ft.shape]
    const dimmed = soloMisMesas && currentMesero && mesa.status !== 'disponible' && mesa.mesero !== currentMesero

    return (
      <div
        className={`absolute ${dimmed ? 'opacity-20 pointer-events-none' : ''}`}
        style={{ left: `${ft.x}%`, top: `${ft.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className="relative" style={{ width: w, height: h }}>
          <Chairs shape={ft.shape} capacity={mesa.capacity} status={mesa.status} />
          <button
            onClick={() => handleMesaClick(mesa.number)}
            title={`Mesa ${mesa.number} · ${statusLabel[mesa.status]} · ${mesa.capacity} lugares${mesa.mesero ? ` · ${mesa.mesero}` : ''}`}
            className={`relative z-10 w-full h-full border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${
              ft.shape === 'round' || ft.shape === 'round-lg' ? 'rounded-full' : 'rounded-lg'
            } ${
              mergeSource === mesa.number ? 'ring-4 ring-amber-400 border-amber-400 bg-amber-900/60' :
              mergeTarget === mesa.number ? 'ring-4 ring-emerald-400 border-emerald-400 bg-emerald-900/60' :
              getMesaColor(mesa)
            }`}
            style={mergeSource !== mesa.number && mergeTarget !== mesa.number ? getMeseroBorderStyle(mesa) : {}}
          >
            <span className={`font-bold leading-none ${ft.shape === 'round-lg' ? 'text-2xl' : 'text-xl'}`}>{mesa.number}</span>
            {order && mesa.mesero && (
              <span className="text-[7px] font-medium leading-tight mt-0.5 text-[var(--text-3)] truncate max-w-[90%]">
                {mesa.mesero.split(' ')[0]}
              </span>
            )}
            {order && (
              <span className={`text-[9px] font-mono font-bold leading-tight ${
                isAlert ? 'text-red-400 animate-pulse' : isWarning ? 'text-amber-400' : 'text-[var(--text-3)]'
              }`}>
                {mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}` : `${mins}m`}
              </span>
            )}
          </button>
          {/* Total debajo de la mesa ocupada */}
          {order && mesa.total != null && mesa.total > 0 && (
            <span className="absolute left-1/2 -translate-x-1/2 z-20 text-[9px] font-semibold text-white bg-black/60 px-1.5 py-px rounded-full whitespace-nowrap" style={{ top: h + 14 }}>
              {formatMXN(mesa.total)}
            </span>
          )}
        </div>
      </div>
    )
  }

  const PlanogramaView = () => {
    const floorNumbers = new Set(FLOOR_TABLES.map(t => t.number))
    const unassigned = mesas.filter(m => !floorNumbers.has(m.number))
    return (
      <div>
        {/* Scaled plano container */}
        <div className="mx-auto" style={{ width: PLANO_BASE_W * planoScale, height: PLANO_BASE_H * planoScale }}>

        <div
          className="relative bg-[var(--surface)] border-2 border-[var(--line)] rounded-2xl"
          style={{ width: PLANO_BASE_W, height: PLANO_BASE_H, transform: `scale(${planoScale})`, transformOrigin: 'top left' }}
        >
          {/* Paredes / muros */}
          {FLOOR_WALLS.map((wall, i) => (
            <div
              key={i}
              className={`absolute ${wall.color === 'green' ? 'bg-emerald-700/50' : 'bg-rose-900/70'} rounded-sm`}
              style={{ left: `${wall.x}%`, top: `${wall.y}%`, width: `${wall.w}%`, height: `${wall.h}%` }}
            />
          ))}
          {/* Texto BARRA vertical sobre la barra física */}
          <span
            className="absolute text-white/80 font-bold text-xs tracking-[0.35em] [writing-mode:vertical-rl] pointer-events-none"
            style={{ left: '71%', top: '52%' }}
          >
            BARRA
          </span>
          {/* Etiquetas de zona */}
          {FLOOR_LABELS.map(label => (
            <span
              key={label.text}
              className={`absolute font-bold uppercase text-[var(--text-3)] opacity-80 pointer-events-none tracking-[0.3em] ${
                label.vertical ? '[writing-mode:vertical-rl] text-base' : 'text-base'
              }`}
              style={{ left: `${label.x}%`, top: `${label.y}%`, transform: `translate(-50%, -50%)${label.vertical ? ' rotate(180deg)' : ''}` }}
            >
              {label.text}
            </span>
          ))}
          {/* Divisor vertical interior / exterior (toldo + privado a la derecha) */}
          <div className="absolute top-[2%] bottom-[2%] border-l-2 border-dashed border-[var(--line)]" style={{ left: '76%' }} />
          {/* Divisor horizontal entre Toldo y Privado */}
          <div className="absolute border-t-2 border-dashed border-[var(--line)]" style={{ left: '77%', right: '1%', top: '55%' }} />
          {/* Marca AMALAY */}
          <span className="absolute text-[var(--text-4)] opacity-40 font-bold tracking-[0.3em] text-sm pointer-events-none" style={{ left: '58%', top: '93%' }}>
            AMALAY
          </span>
          {/* Mesas con sillas */}
          {FLOOR_TABLES.map(ft => (
            <FloorTableNode key={ft.number} ft={ft} />
          ))}
        </div>
        </div>

        {/* Mesas fuera del plano (otros clientes / extras) */}
        {unassigned.length > 0 && (
          <div className="bg-slate-500/5 rounded-2xl border border-[var(--line)] p-5 max-w-6xl mx-auto mt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <h3 className="text-sm font-bold text-slate-400">Sin zona asignada</h3>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {unassigned.map(mesa => (
                <div key={mesa.number} className="min-h-[100px]">
                  <MesaCard mesa={mesa} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Grid View (classic) ──────────────────────────────────────────────────
  const GridView = () => (
    <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
      {mesas.filter(mesa => {
        if (!soloMisMesas || !currentMesero) return true
        return mesa.status === 'disponible' || mesa.mesero === currentMesero
      }).map(mesa => (
        <div key={mesa.number} className="min-h-[140px]">
          <MesaCard mesa={mesa} />
        </div>
      ))}
    </div>
  )

  return (
    <div className="h-screen flex flex-col text-white">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 lg:px-6 py-3 lg:py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors flex-shrink-0">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">Mesas</h1>
            <p className="text-[var(--text-3)] text-xs lg:text-sm whitespace-nowrap">
              {(staffName || currentMesero) && <span className="text-emerald-400">{staffName || currentMesero}</span>}
              {turnoNum != null && <span> · Turno {turnoNum}</span>}
              {(staffName || currentMesero || turnoNum != null) && ' · '}
              MESA(S): {counts.ocupada + counts.cuenta}{namedOrders.length > 0 && ` · CUENTAS: ${namedOrders.length}`} · {totalPersonas} personas · TP {formatMXN(ticketPromedio)}
              {activeOrders.length > 0 && (() => {
                const avgMins = Math.round(activeOrders.reduce((s, o) => s + getMinutes(o.created_at), 0) / activeOrders.length)
                return <span className={avgMins > 60 ? 'text-amber-400' : ''}> · Prom: {avgMins}m</span>
              })()}
              <span className="hidden lg:inline"> · {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} {new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
            </p>
          </div>
          <button onClick={fetchData} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>

          {/* View toggle */}
          <div className="flex items-center bg-[var(--line)] rounded-lg p-0.5 ml-2">
            <button
              onClick={() => setViewMode('planograma')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'planograma' ? 'bg-slate-600 text-white' : 'text-[var(--text-3)] hover:text-white'
              }`}
            >
              <Map size={13} /> Plano
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'grid' ? 'bg-slate-600 text-white' : 'text-[var(--text-3)] hover:text-white'
              }`}
            >
              <LayoutGrid size={13} /> Grid
            </button>
          </div>

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
          <button
            onClick={() => { setNewCuentaName(''); setShowNewCuenta(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-600/30 hover:bg-teal-600/50 text-teal-300 border border-teal-600/40 transition-colors"
          >
            <UserPlus size={14} /> Cuenta
          </button>
          <button
            onClick={async () => {
              try {
                const { getPendingQueue } = await import('@/lib/pos-offline-db')
                const pending = await getPendingQueue()
                const unsynced = pending.filter((p: { synced: boolean }) => !p.synced)
                if (unsynced.length > 0) {
                  alert(`${unsynced.length} operaciones pendientes de sincronizar`)
                  return
                }
              } catch { /* IndexedDB unavailable — proceed */ }
              try {
                sessionStorage.removeItem('pos_staff')
                sessionStorage.removeItem('pos_last_activity')
              } catch { /* */ }
              window.location.reload()
            }}
            title="Bloquear pantalla"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--line)] hover:bg-red-900/40 text-[var(--text-3)] transition-colors"
          >
            <LockIcon size={14} /> Bloquear
          </button>
          {(staffRole === 'admin' || staffRole === 'gerente') && (
            <button
              onClick={async () => {
                // Try fingerprint first if available
                let authenticated = false
                let actorName = ''
                try {
                  const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
                  const managerCreds = Object.entries(stored).filter(([, m]) => {
                    const member = m as { role?: string }
                    return member.role === 'admin' || member.role === 'gerente'
                  })
                  if (managerCreds.length > 0 && window.PublicKeyCredential) {
                    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
                    if (available) {
                      const challenge = new Uint8Array(32)
                      crypto.getRandomValues(challenge)
                      const assertion = await navigator.credentials.get({
                        publicKey: {
                          challenge,
                          rpId: window.location.hostname,
                          allowCredentials: managerCreds.map(([id]) => ({
                            id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
                            type: 'public-key' as const,
                          })),
                          userVerification: 'required',
                          timeout: 15000,
                        },
                      })
                      if (assertion) {
                        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
                        const member = stored[credId] as { name?: string }
                        if (member?.name) { authenticated = true; actorName = member.name }
                      }
                    }
                  }
                } catch { /* fingerprint failed or cancelled — fall through to PIN */ }

                if (authenticated) {
                  logAudit({ action: 'cerrar_app', actor: actorName, mesa: 0, details: { method: 'huella' } })
                  if ((window as any).fullsiteApp?.quit) {
                    ;(window as any).fullsiteApp.quit()
                  } else {
                    try { document.exitFullscreen?.() } catch {}
                    window.location.href = 'about:blank'
                  }
                  return
                }

                // Fallback to PIN
                setPinInput('')
                setPinPrompt({
                  title: 'PIN de gerente para cerrar la app:',
                  onSubmit: async (pin: string) => {
                    const managerName = await verifyManagerPin(pin)
                    if (!managerName) { alert('PIN incorrecto'); return }
                    setPinPrompt(null)
                    logAudit({ action: 'cerrar_app', actor: managerName, mesa: 0, details: { method: 'pin' } })
                    if ((window as any).fullsiteApp?.quit) {
                      ;(window as any).fullsiteApp.quit()
                    } else {
                      try { document.exitFullscreen?.() } catch {}
                      window.location.href = 'about:blank'
                    }
                  },
                })
              }}
              title="Cerrar app"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/40 transition-colors"
            >
              <Power size={14} /> Cerrar
            </button>
          )}
        </div>
        <div className="hidden md:flex items-center gap-6">
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

      {/* Alert banner */}
      {alertMesas.length > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl animate-pulse">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400 font-medium">
            {alertMesas.length} mesa{alertMesas.length > 1 ? 's' : ''} con +{ALERT_THRESHOLD} min:{' '}
            {alertMesas.map(o => `Mesa ${o.mesa} (${getMinutes(o.created_at)}m)`).join(', ')}
          </span>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto ${viewMode === 'planograma' ? 'p-2' : 'p-6'}`}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {viewMode === 'planograma' ? <PlanogramaView /> : <GridView />}

            {/* Cuentas por nombre (sin mesa, estilo Wansoft) */}
            {namedOrders.length > 0 && (
              <div className="max-w-5xl mx-auto mt-6">
                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                  <UserPlus size={18} className="text-teal-400" />
                  Cuentas por nombre ({namedOrders.length})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {namedOrders.map(o => {
                    const mins = getMinutes(o.created_at)
                    const isAlert = mins >= ALERT_THRESHOLD
                    return (
                      <button
                        key={o.id}
                        onClick={() => router.push(`/pos?cuenta=${encodeURIComponent(o.customer_name || '')}`)}
                        className="bg-teal-900/40 border-2 border-teal-600/60 hover:bg-teal-800/50 rounded-2xl p-3 text-left transition-all active:scale-95"
                      >
                        <div className="flex items-start justify-between">
                          <span className="font-bold text-teal-200 uppercase truncate">#{o.customer_name}</span>
                          {o.order_number != null && <span className="text-[10px] font-mono text-teal-400/70">#{o.order_number}</span>}
                        </div>
                        <div className={`flex items-center gap-1 mt-1 ${isAlert ? 'text-red-400' : 'text-teal-300/70'}`}>
                          <Clock size={10} />
                          <span className={`text-[10px] font-mono font-bold ${isAlert ? 'animate-pulse' : ''}`}>
                            {mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`}
                          </span>
                          {isAlert && <AlertTriangle size={9} className="text-red-400" />}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[var(--text-3)] text-xs truncate">{o.mesero}</span>
                          <span className="text-white font-semibold text-xs">{formatMXN(o.total || 0)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Reservaciones */}
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

      {/* Merge footer */}
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

      {/* Modal nueva cuenta por nombre */}
      {showNewCuenta && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-6" onClick={() => setShowNewCuenta(false)}>
          <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
              <UserPlus size={18} className="text-teal-400" /> Cuenta por nombre
            </h3>
            <p className="text-[var(--text-3)] text-sm mb-4">Sin mesa — para llevar, barra o cliente frecuente</p>
            <input
              type="text"
              value={newCuentaName}
              onChange={e => setNewCuentaName(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && newCuentaName.trim()) router.push(`/pos?cuenta=${encodeURIComponent(newCuentaName.trim())}`) }}
              placeholder="NOMBRE DEL CLIENTE"
              autoFocus
              maxLength={30}
              className="w-full bg-[var(--line)] border border-slate-600 rounded-xl px-4 py-3 text-white font-bold focus:outline-none focus:border-teal-500 mb-4 placeholder:font-normal placeholder:text-[var(--text-4)]"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowNewCuenta(false)} className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-2)] font-medium">
                Cancelar
              </button>
              <button
                onClick={() => { if (newCuentaName.trim()) router.push(`/pos?cuenta=${encodeURIComponent(newCuentaName.trim())}`) }}
                disabled={!newCuentaName.trim()}
                className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white font-bold"
              >
                Abrir cuenta
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--surface-2)] border border-[var(--line)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}

      {/* PIN Prompt Modal */}
      {pinPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70" onClick={() => setPinPrompt(null)}>
          <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-80 shadow-2xl border border-[var(--line)]" onClick={e => e.stopPropagation()}>
            <p className="text-white font-bold text-center mb-4">{pinPrompt.title}</p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinInput}
              onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter' && pinInput) { pinPrompt.onSubmit(pinInput) } }}
              maxLength={6}
              className="w-full bg-[var(--line)] border border-slate-600 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.3em] font-bold focus:outline-none focus:border-emerald-500 mb-4"
              placeholder="****"
            />
            <div className="flex gap-2">
              <button onClick={() => { setPinPrompt(null); setPinInput('') }} className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-2)] font-medium">
                Cancelar
              </button>
              <button
                onClick={() => { if (pinInput) pinPrompt.onSubmit(pinInput) }}
                disabled={!pinInput}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
