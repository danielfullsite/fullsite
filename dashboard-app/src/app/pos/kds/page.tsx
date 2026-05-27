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
  notas?: string
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
  caliente: { label: 'Cocina', color: 'text-red-400', bg: 'bg-red-600' },
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
  const [doneItems, setDoneItems] = useState<Set<string>>(new Set())
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

  const toggleItemDone = (orderId: string, itemIndex: number, order: KitchenOrderFromDB) => {
    const key = `${orderId}-${itemIndex}`
    setDoneItems(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        // Check if all active items are now done — auto-advance to "lista"
        const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
        const allDone = items.every((item, idx) => {
          if (item.cancelled) return true // skip cancelled items
          const k = `${orderId}-${idx}`
          return k === key || prev.has(k)
        })
        if (allDone && order.status === 'preparando') {
          advance(orderId, order.status, order.mesa, order.mesero)
        }
      }
      return next
    })
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
        {/* Back button + Station filter tabs */}
        <div className="flex gap-1.5 items-center">
          <button
            onClick={() => window.history.back()}
            className="w-10 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center mr-2 text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
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

              const isNew = order.status === 'enviada'
              const isPrep = order.status === 'preparando'
              const isDone = order.status === 'lista'

              // Item-level done tracking — use original index (before station filter) for stable keys
              const allItems: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
              const activeItemsWithIndex = allItems
                .map((item, idx) => ({ item, originalIndex: idx }))
                .filter(({ item }) => {
                  if (item.cancelled) return false
                  if (station === 'todas') return true
                  return getStation(item.nombre || item.name || '') === station
                })
              const doneCount = activeItemsWithIndex.filter(({ originalIndex }) => doneItems.has(`${order.id}-${originalIndex}`)).length
              const totalCount = activeItemsWithIndex.length

              const borderColor = isNew ? 'border-white/40' : isPrep ? 'border-amber-500/50' : 'border-emerald-500/50'
              const headerBg = isNew ? 'bg-white text-black' : isPrep ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'

              return (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 ${borderColor} bg-[var(--surface)] flex flex-col overflow-hidden ${isNew ? 'animate-pulse-once' : ''}`}
                >
                  {/* Header — mesa + timer + progress */}
                  <div className={`flex items-center justify-between px-4 py-3 ${headerBg}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-black">{order.mesa || 'D'}</span>
                      <div className="leading-tight">
                        <p className="text-sm font-black uppercase tracking-wide">{isNew ? 'NUEVA' : isPrep ? 'PREPARANDO' : 'LISTA'}</p>
                        <p className="text-xs opacity-70">{order.mesero?.split(' ').slice(0, 2).join(' ')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPrep && totalCount > 0 && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-black/20">
                          {doneCount}/{totalCount}
                        </span>
                      )}
                      <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border ${timerBg(mins)}`}>
                        <span className={`text-lg font-mono font-black ${timerColor(mins)}`}>
                          {mins}m
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar for preparando orders */}
                  {isPrep && totalCount > 0 && (
                    <div className="h-1 bg-slate-700">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${(doneCount / totalCount) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* Items — tappable in preparando state */}
                  <div className="flex-1 px-4 py-3 space-y-0.5">
                    {activeItemsWithIndex.map(({ item, originalIndex }) => {
                      const itemKey = `${order.id}-${originalIndex}`
                      const itemDone = doneItems.has(itemKey)
                      const canToggle = isPrep

                      return (
                        <button
                          key={originalIndex}
                          type="button"
                          disabled={!canToggle}
                          onClick={() => canToggle && toggleItemDone(order.id, originalIndex, order)}
                          className={`flex items-start gap-2 w-full text-left rounded-lg px-2 py-1.5 min-h-[48px] transition-colors ${
                            canToggle ? 'active:bg-slate-700/50 cursor-pointer' : 'cursor-default'
                          } ${itemDone ? 'opacity-60' : ''}`}
                        >
                          {/* Done indicator */}
                          {canToggle && (
                            <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                              itemDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'
                            }`}>
                              {itemDone && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          )}
                          <span className={`font-bold text-base min-w-[28px] ${itemDone ? 'text-emerald-600' : 'text-emerald-400'}`}>
                            {item.cantidad || item.quantity || 1}x
                          </span>
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${itemDone ? 'text-emerald-400 line-through' : 'text-white'}`}>
                              {item.nombre || item.name}
                            </p>
                            {item.modificadores && item.modificadores.length > 0 && (
                              <p className={`text-xs ${itemDone ? 'text-emerald-600/60 line-through' : 'text-amber-400/80'}`}>
                                {item.modificadores.join(' · ')}
                              </p>
                            )}
                            {item.notas && (
                              <p className={`text-xs italic ${itemDone ? 'text-sky-600/60 line-through' : 'text-sky-300/80'}`}>
                                {item.notas}
                              </p>
                            )}
                          </div>
                        </button>
                      )
                    })}
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
