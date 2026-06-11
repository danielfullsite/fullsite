'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Users, Clock, DollarSign, AlertTriangle, ExternalLink } from 'lucide-react'
import { MESAS_CONFIG, formatMXN } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() {
  try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' }
}

// ---------------------------------------------------------------------------
// Floor plan types & layout
// ---------------------------------------------------------------------------

type TableShape = 'round' | 'round-lg' | 'square' | 'rect-h'

interface FloorTable {
  number: number
  x: number
  y: number
  shape: TableShape
  zone: string
}

const TABLE_SIZE: Record<TableShape, { w: number; h: number }> = {
  round:      { w: 54, h: 54 },
  'round-lg': { w: 72, h: 72 },
  square:     { w: 56, h: 52 },
  'rect-h':   { w: 88, h: 50 },
}

// Positions traced from the physical floor plan
const FLOOR_TABLES: FloorTable[] = [
  // Entrada
  { number: 45, x: 9,  y: 9,  shape: 'round',   zone: 'Entrada' },
  { number: 1,  x: 22, y: 9,  shape: 'round',   zone: 'Entrada' },
  { number: 2,  x: 30, y: 9,  shape: 'round',   zone: 'Entrada' },
  { number: 3,  x: 38, y: 9,  shape: 'round',   zone: 'Entrada' },
  { number: 4,  x: 31, y: 22, shape: 'round',   zone: 'Entrada' },
  // Lamparas (interior)
  { number: 5,  x: 56, y: 9,  shape: 'rect-h',  zone: 'Interior' },
  { number: 6,  x: 65, y: 9,  shape: 'rect-h',  zone: 'Interior' },
  { number: 7,  x: 74, y: 9,  shape: 'rect-h',  zone: 'Interior' },
  { number: 9,  x: 60, y: 22, shape: 'round',   zone: 'Interior' },
  { number: 8,  x: 69, y: 22, shape: 'round',   zone: 'Interior' },
  // Pasillo
  { number: 44, x: 9,  y: 35, shape: 'round',   zone: 'Pasillo' },
  { number: 43, x: 9,  y: 58, shape: 'round',   zone: 'Pasillo' },
  // Terraza
  { number: 21, x: 27,   y: 35, shape: 'square',  zone: 'Terraza' },
  { number: 20, x: 37,   y: 35, shape: 'round',   zone: 'Terraza' },
  { number: 32, x: 26,   y: 47, shape: 'round',   zone: 'Terraza' },
  { number: 31, x: 35,   y: 47, shape: 'round',   zone: 'Terraza' },
  { number: 30, x: 45,   y: 47, shape: 'round-lg',zone: 'Terraza' },
  { number: 42, x: 27,   y: 59, shape: 'rect-h',  zone: 'Terraza' },
  { number: 41, x: 36.5, y: 59, shape: 'rect-h',  zone: 'Terraza' },
  { number: 40, x: 46,   y: 59, shape: 'rect-h',  zone: 'Terraza' },
  // Barra
  { number: 10, x: 57, y: 34, shape: 'square',  zone: 'Barra' },
  { number: 11, x: 57, y: 46, shape: 'square',  zone: 'Barra' },
  { number: 12, x: 57, y: 58, shape: 'square',  zone: 'Barra' },
  // Toldo (exterior)
  { number: 50, x: 12, y: 78, shape: 'rect-h',  zone: 'Toldo' },
  { number: 53, x: 24, y: 78, shape: 'rect-h',  zone: 'Toldo' },
  { number: 55, x: 36, y: 78, shape: 'rect-h',  zone: 'Toldo' },
  { number: 51, x: 12, y: 91, shape: 'rect-h',  zone: 'Toldo' },
  { number: 52, x: 24, y: 91, shape: 'rect-h',  zone: 'Toldo' },
  { number: 54, x: 36, y: 91, shape: 'rect-h',  zone: 'Toldo' },
  // Privado
  { number: 61, x: 68, y: 78, shape: 'rect-h',  zone: 'Privado' },
  { number: 63, x: 80, y: 78, shape: 'rect-h',  zone: 'Privado' },
  { number: 60, x: 68, y: 91, shape: 'rect-h',  zone: 'Privado' },
  { number: 62, x: 80, y: 91, shape: 'rect-h',  zone: 'Privado' },
]

interface FloorLabel { text: string; x: number; y: number; vertical?: boolean }

const FLOOR_LABELS: FloorLabel[] = [
  { text: 'ENTRADA',   x: 30, y: 16 },
  { text: 'LAMPARAS',  x: 65, y: 16 },
  { text: 'PASILLO',   x: 3,  y: 46, vertical: true },
  { text: 'TERRAZA',   x: 35, y: 41 },
  { text: 'BARRA',     x: 64, y: 41 },
  { text: 'TOLDO',     x: 24, y: 70 },
  { text: 'PRIVADO',   x: 56, y: 84, vertical: true },
]

interface FloorWall {
  x: number; y: number; w: number; h: number; color: 'green' | 'maroon'
}

const FLOOR_WALLS: FloorWall[] = [
  { x: 15.5, y: 3.5,  w: 0.7, h: 11,   color: 'green' },
  { x: 19.5, y: 28.5, w: 0.7, h: 14,   color: 'green' },
  { x: 19.5, y: 28.5, w: 23,  h: 1.2,  color: 'green' },
  { x: 42.5, y: 27.8, w: 7.5, h: 2.6,  color: 'maroon' },
  { x: 50.5, y: 30.5, w: 0.7, h: 33,   color: 'green' },
  { x: 19.5, y: 52,   w: 0.7, h: 12,   color: 'green' },
  { x: 71,   y: 31,   w: 14,  h: 4,    color: 'maroon' },
  { x: 71,   y: 31,   w: 4.5, h: 30,   color: 'maroon' },
]

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface ActiveOrder {
  id: string
  mesa: number
  mesero: string
  personas: number
  total: number
  status: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const STATUS_COLORS = {
  disponible: {
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.5)',
    dot: '#34d399',
    label: 'Disponible',
    glow: 'none',
  },
  ocupada: {
    bg: 'rgba(59, 130, 246, 0.2)',
    border: 'rgba(59, 130, 246, 0.6)',
    dot: '#60a5fa',
    label: 'Ocupada',
    glow: '0 0 12px rgba(59,130,246,0.25)',
  },
  cuenta: {
    bg: 'rgba(245, 158, 11, 0.2)',
    border: 'rgba(245, 158, 11, 0.6)',
    dot: '#fbbf24',
    label: 'Cuenta pedida',
    glow: '0 0 12px rgba(245,158,11,0.3)',
  },
  reservada: {
    bg: 'rgba(107, 114, 128, 0.2)',
    border: 'rgba(107, 114, 128, 0.5)',
    dot: '#9ca3af',
    label: 'Reservada',
    glow: 'none',
  },
} as const

type TableStatus = keyof typeof STATUS_COLORS

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlanoPage() {
  const router = useRouter()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMesa, setSelectedMesa] = useState<number | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  // Timer tick for elapsed time display
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&status=in.(enviada,preparando,lista,abierta)&order=created_at.desc&limit=50&select=id,mesa,mesero,personas,status,total,created_at`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
      )
      if (res.ok) setActiveOrders(await res.json())
    } catch { /* silent */ }
    setLoading(false)
    setLastRefresh(new Date())
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  // ---------------------------------------------------------------------------
  // Build table state map
  // ---------------------------------------------------------------------------

  const ordersByMesa = new globalThis.Map<number, ActiveOrder>()
  for (const order of activeOrders) {
    if (!ordersByMesa.has(order.mesa)) ordersByMesa.set(order.mesa, order)
  }

  const mesaMap = new globalThis.Map<number, Mesa & { resolvedStatus: TableStatus }>()
  for (const m of MESAS_CONFIG) {
    const order = ordersByMesa.get(m.number)
    if (order) {
      const resolvedStatus: TableStatus = order.status === 'lista' ? 'cuenta' : 'ocupada'
      mesaMap.set(m.number, { ...m, status: resolvedStatus, mesero: order.mesero, personas: order.personas, total: order.total, resolvedStatus })
    } else {
      mesaMap.set(m.number, { ...m, resolvedStatus: 'disponible' })
    }
  }

  const allMesas = Array.from(mesaMap.values())
  const totalMesas = allMesas.length
  const ocupadas = allMesas.filter(m => m.resolvedStatus !== 'disponible').length
  const totalPersonas = allMesas.reduce((s, m) => s + (m.personas || 0), 0)
  const totalIngreso = allMesas.reduce((s, m) => s + (m.total || 0), 0)

  const getMinutes = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  const fmtTime = (mins: number) => mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`

  // Selected table info
  const selectedInfo = selectedMesa != null ? mesaMap.get(selectedMesa) : null
  const selectedOrder = selectedMesa != null ? ordersByMesa.get(selectedMesa) : null

  // ---------------------------------------------------------------------------
  // Chair positions around a table
  // ---------------------------------------------------------------------------

  const getChairPositions = (shape: TableShape, capacity: number): { left: number; top: number }[] => {
    const { w, h } = TABLE_SIZE[shape]
    const chairs: { left: number; top: number }[] = []

    if (shape === 'rect-h') {
      const top = Math.ceil(capacity / 2)
      const bottom = capacity - top
      for (let i = 0; i < top; i++) chairs.push({ left: ((i + 0.5) / top) * w - 6.5, top: -17 })
      for (let i = 0; i < bottom; i++) chairs.push({ left: ((i + 0.5) / bottom) * w - 6.5, top: h + 4 })
    } else if (shape === 'square') {
      const sides = [
        { left: w / 2 - 6.5, top: -17 }, { left: w / 2 - 6.5, top: h + 4 },
        { left: -17, top: h / 2 - 6.5 }, { left: w + 4, top: h / 2 - 6.5 },
      ]
      for (let i = 0; i < Math.min(capacity, 4); i++) chairs.push(sides[i])
    } else {
      const r = w / 2 + 10
      const offset = capacity === 4 ? Math.PI / 4 : -Math.PI / 2
      for (let i = 0; i < capacity; i++) {
        const angle = offset + (i * 2 * Math.PI) / capacity
        chairs.push({ left: w / 2 + r * Math.cos(angle) - 6.5, top: h / 2 + r * Math.sin(angle) - 6.5 })
      }
    }
    return chairs
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(145deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%)',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(15,15,26,0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/pos" style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#94a3b8', textDecoration: 'none',
            transition: 'background 0.2s',
          }}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Plano del Restaurante
            </h1>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
              Actualizado {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              {' '} -- Auto-refresh 30s
            </p>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {(Object.entries(STATUS_COLORS) as [TableStatus, typeof STATUS_COLORS[TableStatus]][]).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: val.dot,
                boxShadow: `0 0 6px ${val.dot}`,
              }} />
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{val.label}</span>
            </div>
          ))}
          <button
            onClick={() => { fetchData() }}
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: 'none', color: '#94a3b8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s',
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* ── Stats Bar ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 16, padding: '16px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        {[
          { icon: <Users size={16} />, label: 'Mesas ocupadas', value: `${ocupadas}/${totalMesas}`, color: '#60a5fa' },
          { icon: <Users size={16} />, label: 'Personas sentadas', value: `${totalPersonas}`, color: '#34d399' },
          { icon: <DollarSign size={16} />, label: 'Ingreso actual', value: formatMXN(totalIngreso), color: '#fbbf24' },
          { icon: <Clock size={16} />, label: 'Tiempo promedio', value: activeOrders.length > 0 ? fmtTime(Math.round(activeOrders.reduce((s, o) => s + getMinutes(o.created_at), 0) / activeOrders.length)) : '--', color: '#a78bfa' },
        ].map((stat, i) => (
          <div key={i} style={{
            flex: 1,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 12,
            padding: '14px 18px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: stat.color }}>{stat.icon}</span>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {stat.label}
              </span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', padding: '16px 24px', gap: 20, minHeight: 'calc(100vh - 180px)' }}>

        {/* Floor Plan */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{
            position: 'relative',
            background: 'rgba(255,255,255,0.02)',
            border: '2px solid rgba(255,255,255,0.06)',
            borderRadius: 24,
            maxWidth: 1100,
            margin: '0 auto',
            aspectRatio: '10 / 8.2',
            minWidth: 800,
          }}>
            {/* Walls */}
            {FLOOR_WALLS.map((wall, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${wall.x}%`,
                top: `${wall.y}%`,
                width: `${wall.w}%`,
                height: `${wall.h}%`,
                background: wall.color === 'green' ? 'rgba(16,185,129,0.3)' : 'rgba(159,18,57,0.4)',
                borderRadius: 2,
              }} />
            ))}

            {/* Barra vertical text */}
            <span style={{
              position: 'absolute',
              left: '72.2%',
              top: '38%',
              color: 'rgba(255,255,255,0.5)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.35em',
              writingMode: 'vertical-rl' as React.CSSProperties['writingMode'],
              pointerEvents: 'none',
            }}>
              BARRA
            </span>

            {/* Zone labels */}
            {FLOOR_LABELS.map(label => (
              <span key={label.text} style={{
                position: 'absolute',
                left: `${label.x}%`,
                top: `${label.y}%`,
                transform: `translate(-50%, -50%)${label.vertical ? ' rotate(180deg)' : ''}`,
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                color: 'rgba(148,163,184,0.35)',
                pointerEvents: 'none',
                letterSpacing: '0.25em',
                fontSize: label.vertical ? 16 : 15,
                ...(label.vertical ? { writingMode: 'vertical-rl' as React.CSSProperties['writingMode'] } : {}),
              }}>
                {label.text}
              </span>
            ))}

            {/* Interior/exterior divider */}
            <div style={{
              position: 'absolute',
              left: '3%',
              right: '3%',
              top: '67%',
              borderTop: '2px dashed rgba(255,255,255,0.08)',
            }} />

            {/* AMALAY watermark */}
            <span style={{
              position: 'absolute',
              left: '80%',
              top: '62%',
              color: 'rgba(148,163,184,0.2)',
              fontWeight: 700,
              letterSpacing: '0.3em',
              fontSize: 13,
              pointerEvents: 'none',
            }}>
              AMALAY
            </span>

            {/* Tables */}
            {FLOOR_TABLES.map(ft => {
              const mesa = mesaMap.get(ft.number)
              if (!mesa) return null
              const order = ordersByMesa.get(mesa.number)
              const mins = order ? getMinutes(order.created_at) : 0
              const isAlert = mins >= 90
              const isWarning = mins >= 60 && mins < 90
              const status = mesa.resolvedStatus
              const sc = STATUS_COLORS[status]
              const { w, h } = TABLE_SIZE[ft.shape]
              const isSelected = selectedMesa === mesa.number
              const isRound = ft.shape === 'round' || ft.shape === 'round-lg'
              const chairs = getChairPositions(ft.shape, mesa.capacity)

              return (
                <div
                  key={ft.number}
                  style={{
                    position: 'absolute',
                    left: `${ft.x}%`,
                    top: `${ft.y}%`,
                    transform: 'translate(-50%, -50%)',
                    transition: 'transform 0.2s ease',
                  }}
                >
                  {/* Chairs */}
                  <div style={{ position: 'relative', width: w, height: h }}>
                    {chairs.map((c, i) => (
                      <div key={i} style={{
                        position: 'absolute',
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        background: status === 'ocupada' ? 'rgba(59,130,246,0.5)' :
                                    status === 'cuenta' ? 'rgba(245,158,11,0.5)' :
                                    'rgba(100,116,139,0.3)',
                        left: c.left,
                        top: c.top,
                        transition: 'background 0.3s',
                      }} />
                    ))}

                    {/* Table surface */}
                    <button
                      onClick={() => setSelectedMesa(isSelected ? null : mesa.number)}
                      style={{
                        position: 'relative',
                        zIndex: 10,
                        width: '100%',
                        height: '100%',
                        borderRadius: isRound ? '50%' : 12,
                        border: `2px solid ${isSelected ? '#818cf8' : sc.border}`,
                        background: isSelected ? 'rgba(99,102,241,0.25)' : sc.bg,
                        boxShadow: isSelected
                          ? '0 0 20px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
                          : `${sc.glow}, inset 0 1px 0 rgba(255,255,255,0.03)`,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.25s ease',
                        color: '#e2e8f0',
                        padding: 0,
                      }}
                    >
                      {/* Table number */}
                      <span style={{
                        fontWeight: 700,
                        fontSize: ft.shape === 'round-lg' ? 20 : 15,
                        lineHeight: 1,
                      }}>
                        {mesa.number}
                      </span>

                      {/* Time badge */}
                      {order && (
                        <span style={{
                          fontSize: 9,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          lineHeight: 1,
                          marginTop: 2,
                          color: isAlert ? '#f87171' : isWarning ? '#fbbf24' : '#94a3b8',
                          animation: isAlert ? 'pulse 1.5s infinite' : undefined,
                        }}>
                          {mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}` : `${mins}m`}
                        </span>
                      )}
                    </button>

                    {/* Total below occupied tables */}
                    {order && mesa.total != null && mesa.total > 0 && (
                      <span style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top: h + 18,
                        zIndex: 20,
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#f1f5f9',
                        background: 'rgba(0,0,0,0.6)',
                        padding: '1px 6px',
                        borderRadius: 10,
                        whiteSpace: 'nowrap' as const,
                      }}>
                        {formatMXN(mesa.total)}
                      </span>
                    )}

                    {/* Mesero name below */}
                    {order && mesa.mesero && (
                      <span style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top: h + (mesa.total && mesa.total > 0 ? 32 : 18),
                        zIndex: 20,
                        fontSize: 8,
                        fontWeight: 500,
                        color: '#64748b',
                        whiteSpace: 'nowrap' as const,
                        maxWidth: 80,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {mesa.mesero.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Detail Panel (right sidebar) ─────────────────────────────── */}
        <div style={{
          width: 320,
          flexShrink: 0,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          height: 'fit-content',
          position: 'sticky',
          top: 100,
        }}>
          {selectedInfo ? (
            <>
              {/* Selected table header */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Mesa {selectedInfo.number}</h2>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: STATUS_COLORS[selectedInfo.resolvedStatus].bg,
                    border: `1px solid ${STATUS_COLORS[selectedInfo.resolvedStatus].border}`,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: STATUS_COLORS[selectedInfo.resolvedStatus].dot,
                      boxShadow: `0 0 6px ${STATUS_COLORS[selectedInfo.resolvedStatus].dot}`,
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLORS[selectedInfo.resolvedStatus].dot }}>
                      {STATUS_COLORS[selectedInfo.resolvedStatus].label}
                    </span>
                  </div>
                </div>

                {/* Zone tag */}
                {(() => {
                  const ft = FLOOR_TABLES.find(t => t.number === selectedInfo.number)
                  return ft ? (
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: '#64748b',
                      background: 'rgba(255,255,255,0.04)',
                      padding: '3px 10px', borderRadius: 8,
                    }}>
                      Zona: {ft.zone}
                    </span>
                  ) : null
                })()}
              </div>

              {/* Details */}
              {selectedOrder ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Info rows */}
                  {[
                    { icon: <Users size={16} />, label: 'Mesero', value: selectedInfo.mesero || '--' },
                    { icon: <Users size={16} />, label: 'Personas', value: String(selectedInfo.personas || 0) },
                    { icon: <Clock size={16} />, label: 'Tiempo', value: fmtTime(getMinutes(selectedOrder.created_at)) },
                    { icon: <DollarSign size={16} />, label: 'Total actual', value: formatMXN(selectedInfo.total || 0) },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#64748b' }}>{row.icon}</span>
                        <span style={{ fontSize: 13, color: '#94a3b8' }}>{row.label}</span>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{row.value}</span>
                    </div>
                  ))}

                  {/* Time alert */}
                  {getMinutes(selectedOrder.created_at) >= 60 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 14px',
                      background: getMinutes(selectedOrder.created_at) >= 90 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      border: `1px solid ${getMinutes(selectedOrder.created_at) >= 90 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                      borderRadius: 10,
                    }}>
                      <AlertTriangle size={16} style={{ color: getMinutes(selectedOrder.created_at) >= 90 ? '#f87171' : '#fbbf24' }} />
                      <span style={{
                        fontSize: 12, fontWeight: 500,
                        color: getMinutes(selectedOrder.created_at) >= 90 ? '#f87171' : '#fbbf24',
                      }}>
                        {getMinutes(selectedOrder.created_at) >= 90 ? 'Tiempo excesivo en mesa' : 'Mas de 1 hora en mesa'}
                      </span>
                    </div>
                  )}

                  {/* Open in POS button */}
                  <button
                    onClick={() => router.push(`/pos?mesa=${selectedInfo.number}`)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '12px 20px',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                      border: 'none',
                      borderRadius: 12,
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: 'pointer',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                      boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                    }}
                  >
                    <ExternalLink size={16} />
                    Abrir orden en POS
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>Mesa disponible</p>
                  <p style={{ fontSize: 12, color: '#475569' }}>
                    Capacidad: {selectedInfo.capacity} personas
                  </p>
                  <button
                    onClick={() => router.push(`/pos?mesa=${selectedInfo.number}`)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '12px 20px',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      border: 'none',
                      borderRadius: 12,
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: 'pointer',
                      marginTop: 16,
                      width: '100%',
                      boxShadow: '0 4px 16px rgba(16,185,129,0.3)',
                    }}
                  >
                    <ExternalLink size={16} />
                    Abrir nueva orden
                  </button>
                </div>
              )}
            </>
          ) : (
            /* No selection state */
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: 'rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <Users size={28} style={{ color: '#475569' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                Selecciona una mesa
              </p>
              <p style={{ fontSize: 12, color: '#475569' }}>
                Haz clic en cualquier mesa del plano para ver sus detalles y abrir la orden en el POS.
              </p>
            </div>
          )}

          {/* Zone summary */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 16,
            marginTop: 'auto',
          }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Ocupacion por zona
            </h3>
            {['Entrada', 'Interior', 'Terraza', 'Barra', 'Pasillo', 'Toldo', 'Privado'].map(zone => {
              const zoneTables = FLOOR_TABLES.filter(ft => ft.zone === zone)
              const zoneOcupadas = zoneTables.filter(ft => {
                const m = mesaMap.get(ft.number)
                return m && m.resolvedStatus !== 'disponible'
              }).length
              const pct = zoneTables.length > 0 ? (zoneOcupadas / zoneTables.length) * 100 : 0

              return (
                <div key={zone} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  marginBottom: 8,
                }}>
                  <span style={{ fontSize: 12, color: '#94a3b8', width: 70, flexShrink: 0 }}>{zone}</span>
                  <div style={{
                    flex: 1, height: 6, borderRadius: 3,
                    background: 'rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      borderRadius: 3,
                      background: pct >= 80 ? '#f87171' : pct >= 50 ? '#fbbf24' : '#34d399',
                      transition: 'width 0.5s ease, background 0.3s',
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>
                    {zoneOcupadas}/{zoneTables.length}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
