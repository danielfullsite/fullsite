'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getKitchenOrders, updateOrderStatus, logAudit,
  type KitchenOrderFromDB,
} from '@/lib/pos-data'

// ── Helpers ──────────────────────────────────────────────────────────────

function elapsed(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

function timerColor(mins: number): string {
  if (mins <= 10) return 'text-emerald-400'
  if (mins <= 20) return 'text-amber-400'
  return 'text-red-400'
}

function timerBg(mins: number): string {
  if (mins <= 10) return 'bg-emerald-500/100/10 border-emerald-500/30'
  if (mins <= 20) return 'bg-amber-500/100/10 border-amber-500/30'
  return 'bg-red-500/100/10 border-red-500/30'
}

interface ParsedItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  modificadores?: string[]
  cancelled?: boolean
}

type Station = 'todas' | 'caliente' | 'fria' | 'panaderia' | 'barra'

const STATION_KEYWORDS: Record<string, string[]> = {
  barra: ['cafe', 'café', 'cappuccino', 'capuchino', 'latte', 'americano', 'mocca', 'matcha', 'chai', 'smoothie', 'frappe', 'jugo', 'limonada', 'fresco', 'soda', 'coca', 'agua', 'te ', 'té ', 'mimosa', 'chamoyada', 'cerveza', 'vino', 'tisana'],
  fria: ['bowl', 'acai', 'fruit', 'salad', 'ensalada', 'ceviche'],
  panaderia: ['croissant', 'concha', 'bakery', 'postre', 'cheesecake', 'carrot cake', 'toast', 'bagel', 'galleta', 'brownie', 'crunchy'],
}

function getStation(itemName: string): string {
  const name = itemName.toLowerCase()
  for (const [station, keywords] of Object.entries(STATION_KEYWORDS)) {
    if (keywords.some(kw => name.includes(kw))) return station
  }
  return 'caliente'
}

const STATION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  todas: { label: 'Todas', color: 'text-white', bg: 'bg-slate-600' },
  caliente: { label: 'Caliente', color: 'text-red-400', bg: 'bg-red-600' },
  fria: { label: 'Fria', color: 'text-cyan-400', bg: 'bg-cyan-600' },
  panaderia: { label: 'Panaderia', color: 'text-orange-400', bg: 'bg-orange-600' },
  barra: { label: 'Barra', color: 'text-blue-400', bg: 'bg-blue-600' },
}

// ── Sound ────────────────────────────────────────────────────────────────

function playAlert() {
  try {
    const ctx = new AudioContext()
    const freqs = [880, 1100, 880]
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.value = 0.4
      osc.start(ctx.currentTime + i * 0.2)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.2 + 0.3)
      osc.stop(ctx.currentTime + i * 0.2 + 0.3)
    })
  } catch { /* audio not available */ }
}

// ── Component ────────────────────────────────────────────────────────────

export default function KDSPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [station, setStation] = useState<Station>('todas')
  const [mounted, setMounted] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [, setTick] = useState(0) // force re-render for timer updates
  const prevCount = useRef(0)

  const fetchOrders = useCallback(async () => {
    const data = await getKitchenOrders()
    const now = Date.now()
    const fourHours = 4 * 60 * 60 * 1000
    const fresh = data.filter(o => {
      const age = now - new Date(o.created_at).getTime()
      return age <= fourHours || o.status === 'lista'
    })

    // Sound alert for new orders
    const newCount = fresh.filter(o => o.status === 'enviada').length
    if (prevCount.current > 0 && newCount > prevCount.current) {
      playAlert()
    }
    prevCount.current = newCount

    setOrders(fresh)
    setLastUpdate(new Date())
  }, [])

  useEffect(() => {
    setMounted(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, 3000)
    const timerInterval = setInterval(() => setTick(t => t + 1), 10000)
    return () => { clearInterval(interval); clearInterval(timerInterval) }
  }, [fetchOrders])

  const advance = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    const next = currentStatus === 'enviada' ? 'preparando' : currentStatus === 'preparando' ? 'lista' : 'entregada'
    await updateOrderStatus(id, next)
    logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: currentStatus, to: next, mesero } })
    fetchOrders()
  }

  const bump = async (id: string, mesa: number, mesero: string) => {
    await updateOrderStatus(id, 'entregada')
    logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: 'lista', to: 'entregada', mesero } })
    fetchOrders()
  }

  // Filter orders by station
  const filteredOrders = orders
    .filter(o => o.status !== 'entregada')
    .filter(o => {
      if (station === 'todas') return true
      const items: ParsedItem[] = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
      return items.some(item => !item.cancelled && getStation(item.nombre || item.name || '') === station)
    })
    .sort((a, b) => {
      const p: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
      const ps = (p[a.status] || 3) - (p[b.status] || 3)
      if (ps !== 0) return ps
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

  // Station counts
  const stationCounts: Record<string, number> = { todas: 0, caliente: 0, fria: 0, panaderia: 0, barra: 0 }
  for (const o of orders.filter(o => o.status === 'enviada' || o.status === 'preparando')) {
    const items: ParsedItem[] = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
    for (const item of items) {
      if (item.cancelled) continue
      const s = getStation(item.nombre || item.name || '')
      const qty = item.cantidad || item.quantity || 1
      stationCounts[s] += qty
      stationCounts.todas += qty
    }
  }

  if (!mounted) return null

  return (
    <div className="h-screen flex flex-col bg-black text-white select-none overflow-hidden">
      {/* Top bar — minimal, touch targets */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--surface)] border-b border-slate-800 flex-shrink-0">
        {/* Station filter tabs */}
        <div className="flex gap-1.5">
          {(Object.keys(STATION_CONFIG) as Station[]).map(s => {
            const cfg = STATION_CONFIG[s]
            const count = stationCounts[s]
            const active = station === s
            return (
              <button
                key={s}
                onClick={() => setStation(s)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[48px] ${
                  active ? `${cfg.bg} text-white` : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--line)]'
                }`}
              >
                {cfg.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-[var(--surface)]/20' : 'bg-slate-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Status summary + clock */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[var(--surface)] animate-pulse" />
              {orders.filter(o => o.status === 'enviada').length}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500/100" />
              {orders.filter(o => o.status === 'preparando').length}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500/100" />
              {orders.filter(o => o.status === 'lista').length}
            </span>
          </div>
          <span className="text-[var(--text-2)] text-xs font-mono">
            {lastUpdate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Orders grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-[var(--text-2)]">
              <p className="text-6xl mb-4">👨‍🍳</p>
              <p className="text-2xl font-bold">Sin ordenes</p>
              <p className="text-sm mt-1">Actualizando cada 3 segundos</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredOrders.map(order => {
              const mins = elapsed(order.created_at)
              const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
              const activeItems = items.filter(i => {
                if (i.cancelled) return false
                if (station === 'todas') return true
                return getStation(i.nombre || i.name || '') === station
              })

              const isNew = order.status === 'enviada'
              const isPrep = order.status === 'preparando'
              const isDone = order.status === 'lista'

              const borderColor = isNew ? 'border-white/40' : isPrep ? 'border-amber-500/50' : 'border-emerald-500/50'
              const headerBg = isNew ? 'bg-[var(--surface)] text-black' : isPrep ? 'bg-amber-500/100 text-black' : 'bg-emerald-500/100 text-black'

              return (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 ${borderColor} bg-[var(--surface)] flex flex-col overflow-hidden ${isNew ? 'animate-pulse-once' : ''}`}
                >
                  {/* Header — mesa + timer */}
                  <div className={`flex items-center justify-between px-4 py-3 ${headerBg}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-black">{order.mesa || 'D'}</span>
                      <div className="text-xs leading-tight">
                        <p className="font-bold uppercase">{isNew ? 'NUEVA' : isPrep ? 'PREP' : 'LISTA'}</p>
                        <p className="opacity-70">{order.mesero?.split(' ')[0]}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border ${timerBg(mins)}`}>
                      <span className={`text-lg font-mono font-black ${timerColor(mins)}`}>
                        {mins}m
                      </span>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="flex-1 px-4 py-3 space-y-1.5">
                    {activeItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold text-base min-w-[28px]">
                          {item.cantidad || item.quantity || 1}x
                        </span>
                        <div className="flex-1">
                          <p className="text-white text-sm font-medium">{item.nombre || item.name}</p>
                          {item.modificadores && item.modificadores.length > 0 && (
                            <p className="text-amber-400/80 text-xs">{item.modificadores.join(' · ')}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action button — BIG touch target */}
                  {isDone ? (
                    <button
                      onClick={() => bump(order.id, order.mesa, order.mesero)}
                      className="mx-3 mb-3 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500/100 active:bg-emerald-700 text-white font-bold text-lg transition-colors min-h-[56px]"
                    >
                      BUMP
                    </button>
                  ) : (
                    <button
                      onClick={() => advance(order.id, order.status, order.mesa, order.mesero)}
                      className={`mx-3 mb-3 py-4 rounded-xl font-bold text-lg transition-colors min-h-[56px] ${
                        isNew
                          ? 'bg-amber-500/100 hover:bg-amber-400 active:bg-amber-600 text-black'
                          : 'bg-emerald-500/100 hover:bg-emerald-400 active:bg-emerald-600 text-black'
                      }`}
                    >
                      {isNew ? 'PREPARAR' : 'LISTA'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse-once {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          50% { box-shadow: 0 0 0 8px rgba(255,255,255,0.15); }
        }
        .animate-pulse-once {
          animation: pulse-once 1s ease-in-out 2;
        }
      `}</style>
    </div>
  )
}
