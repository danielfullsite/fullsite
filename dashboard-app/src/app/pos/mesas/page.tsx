'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users, Calendar, RefreshCw, Merge, X, Clock, AlertTriangle, LayoutGrid, Map, Settings, RotateCcw, Check } from 'lucide-react'
import { MESAS_CONFIG, formatMXN, logAudit } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

// ─── Floor Plan Zones ────────────────────────────────────────────────────────
// Each zone has a name and the mesa numbers that belong to it.
// Mesas within a zone are positioned on a relative grid.
interface ZoneMesa {
  number: number
  gridRow: number
  gridCol: number
  width?: number   // span columns (default 1)
  height?: number  // span rows (default 1)
  shape?: 'square' | 'round' | 'rect-h' | 'rect-v'
}

interface FloorZone {
  id: string
  name: string
  gridCols: number
  gridRows: number
  mesas: ZoneMesa[]
  color: string     // accent color for zone header
  bgColor: string   // background tint
}

// Default AMALAY layout — configurable per client via localStorage
const DEFAULT_FLOOR_ZONES: FloorZone[] = [
  {
    id: 'salon',
    name: 'Salón Principal',
    gridCols: 4,
    gridRows: 4,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/5',
    mesas: [
      { number: 1, gridRow: 1, gridCol: 1, shape: 'round' },
      { number: 2, gridRow: 1, gridCol: 2, shape: 'round' },
      { number: 3, gridRow: 1, gridCol: 3, shape: 'round' },
      { number: 4, gridRow: 1, gridCol: 4, shape: 'round' },
      { number: 5, gridRow: 2, gridCol: 1, shape: 'square' },
      { number: 6, gridRow: 2, gridCol: 2, shape: 'square' },
      { number: 7, gridRow: 2, gridCol: 3, shape: 'square' },
      { number: 8, gridRow: 2, gridCol: 4, shape: 'square' },
      { number: 9, gridRow: 3, gridCol: 1, shape: 'square' },
      { number: 10, gridRow: 3, gridCol: 2, shape: 'square' },
      { number: 11, gridRow: 3, gridCol: 3, shape: 'square' },
      { number: 12, gridRow: 3, gridCol: 4, shape: 'square' },
    ],
  },
  {
    id: 'terraza',
    name: 'Terraza',
    gridCols: 4,
    gridRows: 2,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/5',
    mesas: [
      { number: 13, gridRow: 1, gridCol: 1, shape: 'round' },
      { number: 14, gridRow: 1, gridCol: 2, shape: 'round' },
      { number: 15, gridRow: 1, gridCol: 3, shape: 'round' },
      { number: 16, gridRow: 1, gridCol: 4, shape: 'round' },
      { number: 20, gridRow: 2, gridCol: 1, shape: 'rect-h', width: 2 },
      { number: 30, gridRow: 2, gridCol: 3, shape: 'rect-h', width: 2 },
    ],
  },
  {
    id: 'jardin',
    name: 'Jardín / Eventos',
    gridCols: 4,
    gridRows: 2,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/5',
    mesas: [
      { number: 40, gridRow: 1, gridCol: 1, shape: 'rect-h', width: 2 },
      { number: 50, gridRow: 1, gridCol: 3, shape: 'rect-h', width: 2 },
      { number: 60, gridRow: 2, gridCol: 1, shape: 'rect-h', width: 2 },
      { number: 70, gridRow: 2, gridCol: 3, shape: 'round' },
      { number: 80, gridRow: 2, gridCol: 4, shape: 'round' },
    ],
  },
]

function getFloorZones(): FloorZone[] {
  try {
    const saved = localStorage.getItem(`pos_floor_${_cid()}`)
    if (saved) return JSON.parse(saved)
  } catch { /* use default */ }
  return DEFAULT_FLOOR_ZONES
}

function saveFloorZones(zones: FloorZone[]) {
  try { localStorage.setItem(`pos_floor_${_cid()}`, JSON.stringify(zones)) } catch { /* */ }
}

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
  mesa: number
  mesero: string
  personas: number
  total: number
  status: string
  created_at: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MesasPage() {
  const router = useRouter()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [loading, setLoading] = useState(true)
  const [soloMisMesas, setSoloMisMesas] = useState(false)
  const [currentMesero, setCurrentMesero] = useState<string>('')
  const [viewMode, setViewMode] = useState<'planograma' | 'grid'>('planograma')
  const [editMode, setEditMode] = useState(false)
  const [floorZonesState, setFloorZonesState] = useState<FloorZone[]>(getFloorZones)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = params.get('mesero') || localStorage.getItem('pos_mesero') || ''
    setCurrentMesero(m)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, resRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&status=in.(enviada,preparando,lista,abierta)&order=created_at.desc&limit=50`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/amalay_reservaciones?fecha=eq.${new Date().toISOString().split('T')[0]}&status=neq.cancelled&order=horario_inicio.asc&select=codigo_reserva,nombre,guests,horario_inicio,espacio,status`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        ),
      ])
      setActiveOrders(ordersRes.ok ? await ordersRes.json() : [])
      setReservas(resRes.ok ? await resRes.json() : [])
    } catch { /* */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Build mesa states
  const ordersByMesa: globalThis.Map<number, ActiveOrder> = new globalThis.Map()
  for (const order of activeOrders) {
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
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&mesa=eq.${mergeSource}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&mesa=eq.${mergeTarget}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
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
      setMergeMode(false); setMergeSource(null); setMergeTarget(null)
      fetchData()
    } catch { showToast('Error al fusionar mesas') }
    setMerging(false)
  }

  const handleMesaClick = (mesaNum: number) => {
    if (!mergeMode) { router.push(`/pos?mesa=${mesaNum}`); return }
    if (!mergeSource) setMergeSource(mesaNum)
    else if (mesaNum !== mergeSource) setMergeTarget(mesaNum)
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
          statusColor[mesa.status]
        }`}
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

  // ─── Planograma View ──────────────────────────────────────────────────────
  const floorZones = floorZonesState

  const PlanogramaView = () => (
    <div className="space-y-6 max-w-6xl mx-auto">
      {floorZones.map(zone => {
        const zoneMesas = zone.mesas
          .map(zm => ({ ...zm, mesa: mesaMap.get(zm.number) }))
          .filter(zm => zm.mesa)
          .filter(zm => {
            if (!soloMisMesas || !currentMesero) return true
            return zm.mesa!.status === 'disponible' || zm.mesa!.mesero === currentMesero
          })

        if (zoneMesas.length === 0) return null

        return (
          <div key={zone.id} className={`${zone.bgColor} rounded-2xl border border-[var(--line)] p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${zone.color.replace('text-', 'bg-')}`} />
              {editMode ? (
                <input
                  className={`text-sm font-bold ${zone.color} bg-transparent border-b border-dashed border-current outline-none w-40`}
                  defaultValue={zone.name}
                  onBlur={(e) => {
                    const updated = floorZonesState.map(z => z.id === zone.id ? { ...z, name: e.target.value } : z)
                    setFloorZonesState(updated)
                  }}
                />
              ) : (
                <h3 className={`text-sm font-bold ${zone.color}`}>{zone.name}</h3>
              )}
              <span className="text-[var(--text-4)] text-xs ml-auto">
                {zoneMesas.filter(zm => zm.mesa!.status !== 'disponible').length}/{zoneMesas.length} ocupadas
              </span>
            </div>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${zone.gridCols}, 1fr)`,
                gridTemplateRows: `repeat(${zone.gridRows}, minmax(100px, auto))`,
              }}
            >
              {zoneMesas.map(zm => (
                <div
                  key={zm.number}
                  style={{
                    gridRow: `${zm.gridRow} / span ${zm.height || 1}`,
                    gridColumn: `${zm.gridCol} / span ${zm.width || 1}`,
                  }}
                >
                  <MesaCard mesa={zm.mesa!} shape={zm.shape} />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Unassigned mesas (in MESAS_CONFIG but not in any zone) */}
      {(() => {
        const assignedNumbers = new Set(floorZones.flatMap(z => z.mesas.map(m => m.number)))
        const unassigned = mesas.filter(m => !assignedNumbers.has(m.number))
        if (unassigned.length === 0) return null
        return (
          <div className="bg-slate-500/5 rounded-2xl border border-[var(--line)] p-5">
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
        )
      })()}
    </div>
  )

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
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-3">
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
          {viewMode === 'planograma' && (
            editMode ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setFloorZonesState(DEFAULT_FLOOR_ZONES); saveFloorZones(DEFAULT_FLOOR_ZONES); showToast('Plano restaurado a default') }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--line)] hover:bg-slate-600 text-[var(--text-3)]"
                >
                  <RotateCcw size={14} /> Reset
                </button>
                <button
                  onClick={() => { saveFloorZones(floorZonesState); setEditMode(false); showToast('Plano guardado') }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-black"
                >
                  <Check size={14} /> Guardar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--line)] hover:bg-slate-600 text-[var(--text-3)]"
              >
                <Settings size={14} /> Editar plano
              </button>
            )
          )}
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

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {viewMode === 'planograma' ? <PlanogramaView /> : <GridView />}

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

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--surface-2)] border border-[var(--line)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
