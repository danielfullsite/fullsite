'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Printer } from 'lucide-react'
import {
  getKitchenOrders, updateOrderStatus, logAudit,
  type KitchenOrderFromDB, type OrderItem,
} from '@/lib/pos-data'
import { reprintByStation, type ReprintOrderContext } from '@/lib/printer'
import { type StationName } from '@/lib/pos-constants'
import { useBridgeClient, setPosServerHost } from '@/lib/bridge-client'

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
  if (mins <= 10) return 'bg-emerald-500/10 border-emerald-500/30'
  if (mins <= 20) return 'bg-amber-500/10 border-amber-500/30'
  return 'bg-red-500/10 border-red-500/30'
}

interface ParsedItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  modificadores?: string[]
  notas?: string
  cancelled?: boolean
  station?: string  // 'cocina' | 'barra' | 'caja' — fijada por el POS al agregar (por categoría)
}

type Station = 'cocina' | 'panaderia' | 'barra'

const STATION_KEYWORDS: Record<string, string[]> = {
  barra: ['cafe', 'café', 'cappuccino', 'capuchino', 'latte', 'americano', 'mocca', 'matcha', 'chai', 'smoothie', 'frappe', 'jugo', 'limonada', 'fresco', 'soda', 'coca', 'agua', 'te ', 'té ', 'mimosa', 'chamoyada', 'cerveza', 'vino', 'tisana'],
  panaderia: ['croissant', 'concha', 'bakery', 'postre', 'cheesecake', 'carrot cake', 'toast', 'bagel', 'galleta', 'brownie', 'crunchy'],
}

function getStation(item: ParsedItem): string {
  if (item.station === 'barra') return 'barra'
  if (item.station === 'caja') return 'panaderia'
  const name = (item.nombre || item.name || '').toLowerCase()
  if (item.station === 'cocina') {
    if (STATION_KEYWORDS.panaderia.some(kw => name.includes(kw))) return 'panaderia'
    return 'cocina'
  }
  for (const [station, keywords] of Object.entries(STATION_KEYWORDS)) {
    if (keywords.some(kw => name.includes(kw))) return station
  }
  return 'cocina'
}

const STATION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  cocina: { label: 'Cocina', color: 'text-amber-400', bg: 'bg-amber-600' },
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
  const router = useRouter()
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [station, setStation] = useState<Station>('cocina')
  const [mounted, setMounted] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [, setTick] = useState(0) // force re-render for timer updates
  const [doneItems, setDoneItems] = useState<Set<string>>(new Set())
  const [reprintMsg, setReprintMsg] = useState<{ success: boolean; text: string } | null>(null)
  const prevCount = useRef(0)
  // Idempotency guard: prevents double-tap from firing two concurrent status updates
  const advancingRef = useRef<Set<string>>(new Set())

  const handleReprint = async (order: KitchenOrderFromDB, items: ParsedItem[]) => {
    const printerStation: StationName = station === 'panaderia' ? 'caja' : station as StationName
    const ctx: ReprintOrderContext = { id: order.id, mesa: order.mesa, mesero: order.mesero, notas: order.notas }
    const result = await reprintByStation(ctx, printerStation, items as unknown as OrderItem[])
    const msg = result.printed ? 'Reimpreso' : (result.error ?? 'Error al imprimir')
    setReprintMsg({ success: result.printed, text: msg })
    setTimeout(() => setReprintMsg(null), 3000)
    void logAudit({ order_id: order.id, action: 'reprint_comanda', actor: 'kds', mesa: order.mesa, details: { station: printerStation } })
  }

  const fetchOrders = useCallback(async () => {
    let data: KitchenOrderFromDB[]
    try {
      data = await getKitchenOrders()
    } catch {
      // Offline — merge cached orders from IndexedDB into current state
      try {
        const { getCachedOrders } = await import('@/lib/pos-offline-db')
        const [env, prep, lst] = await Promise.all([
          getCachedOrders('enviada'),
          getCachedOrders('preparando'),
          getCachedOrders('lista'),
        ])
        const cached = [...env, ...prep, ...lst] as unknown as KitchenOrderFromDB[]
        if (cached.length > 0) {
          setOrders(prev => {
            const existing = new Set(prev.map(o => o.id))
            const fresh = cached.filter(o => !existing.has(o.id))
            return fresh.length > 0 ? [...prev, ...fresh] : prev
          })
        }
      } catch { /* IndexedDB not available */ }
      return
    }
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
    // Restore done items from kds_item_status (separate field, no race with POS items writes)
    const restored = new Set<string>()
    for (const order of fresh) {
      // Read from kds_item_status field (new) with fallback to kds_done in items (legacy)
      let kdsStatus: Record<string, boolean> = {}
      if (order.kds_item_status) {
        try { kdsStatus = typeof order.kds_item_status === 'string' ? JSON.parse(order.kds_item_status) : order.kds_item_status } catch { /* */ }
      }
      if (Object.keys(kdsStatus).length > 0) {
        for (const [idx, done] of Object.entries(kdsStatus)) {
          if (done) restored.add(`${order.id}-${idx}`)
        }
      } else {
        // Legacy fallback: read kds_done from items
        const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
        items.forEach((item, idx) => {
          if ((item as ParsedItem & { kds_done?: boolean }).kds_done) restored.add(`${order.id}-${idx}`)
        })
      }
    }
    // Replace entire set from DB truth — handles un-done from other devices
    if (restored.size > 0 || doneItems.size > 0) setDoneItems(restored)
  }, [])

  // Register ?bridge=IP on first visit so this device connects to the POS server on LAN
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const bridgeHost = params.get('bridge')
    if (bridgeHost) {
      setPosServerHost(bridgeHost)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Push DELTA events from the POS local server — works cross-device over LAN
  useBridgeClient((event) => {
    const ORDER_EVENTS = ['ORDER_UPSERTED', 'ORDER_SENT', 'ORDER_CLOSED', 'KDS_ITEM_STATUS']
    if (ORDER_EVENTS.includes(event.type)) {
      // Cache order from DELTA so this KDS can show it even if Supabase is down
      if ((event.type === 'ORDER_SENT' || event.type === 'ORDER_UPSERTED') && event.payload) {
        const p = event.payload as Record<string, unknown>
        if (p.order_id) {
          import('@/lib/pos-offline-db').then(({ cacheOrder }) => {
            cacheOrder({
              id: p.order_id as string,
              mesa: p.mesa,
              mesero: p.mesero,
              status: 'enviada',
              items: typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []),
              personas: p.personas || 1,
              total: p.total || 0,
              turno_id: p.turno_id || null,
              notas: p.notas || null,
              comanda_batches: p.comanda_batches ? JSON.stringify(p.comanda_batches) : null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
          }).catch(() => {})
        }
      }
      fetchOrders()
    }
  }, 'kds')

  useEffect(() => {
    setMounted(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, 2000)
    const timerInterval = setInterval(() => setTick(t => t + 1), 10000)
    return () => { clearInterval(interval); clearInterval(timerInterval) }
  }, [fetchOrders])

  const advance = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    if (advancingRef.current.has(id)) return
    advancingRef.current.add(id)
    try {
      const next = currentStatus === 'enviada' ? 'preparando' : currentStatus === 'preparando' ? 'lista' : 'entregada'
      await updateOrderStatus(id, next)
      logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: currentStatus, to: next, mesero } })
      fetchOrders()
    } finally {
      advancingRef.current.delete(id)
    }
  }

  const bump = async (id: string, mesa: number, mesero: string) => {
    if (advancingRef.current.has(id)) return
    advancingRef.current.add(id)
    try {
      await updateOrderStatus(id, 'entregada')
      logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: 'lista', to: 'entregada', mesero } })
      fetchOrders()
    } finally {
      advancingRef.current.delete(id)
    }
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
          if (item.cancelled) return true
          const k = `${orderId}-${idx}`
          return k === key || prev.has(k)
        })
        if (allDone && order.status === 'preparando') {
          advance(orderId, order.status, order.mesa, order.mesero)
        }
      }

      // Persist KDS item statuses to a SEPARATE field (not items) to avoid
      // race condition with POS writes. KDS writes kds_item_status, POS writes items.
      const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
      const kdsStatus: Record<string, boolean> = {}
      items.forEach((item, idx) => {
        if (item.cancelled) return
        const k = `${orderId}-${idx}`
        kdsStatus[`${idx}`] = k === key ? !prev.has(key) : next.has(k)
      })
      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ kds_item_status: JSON.stringify(kdsStatus) }),
      }).then(res => {
        if (!res.ok) console.error(`[KDS] Failed to persist item status for order ${orderId}: HTTP ${res.status}`)
      }).catch(err => {
        console.error(`[KDS] Network error persisting item status for order ${orderId}:`, err)
        // PER-01: try IDB sync_queue first (canonical source of truth)
        import('@/lib/pos-offline-db').then(({ queueOperation }) =>
          queueOperation('pos_orders', 'PATCH', { kds_item_status: JSON.stringify(kdsStatus) }, `pos_orders?id=eq.${orderId}`)
        ).catch(() => {
          // IDB also unavailable — emergency localStorage buffer (drained to IDB on next startup)
          try {
            const q = JSON.parse(localStorage.getItem('fullsite_offline_queue') || '[]')
            q.push({ table: 'pos_orders', method: 'PATCH', endpoint: `pos_orders?id=eq.${orderId}`, data: { kds_item_status: JSON.stringify(kdsStatus) }, timestamp: Date.now(), synced: false })
            localStorage.setItem('fullsite_offline_queue', JSON.stringify(q))
          } catch { /* noop */ }
        })
      })

      return next
    })
  }

  // Filter orders by station
  const filteredOrders = orders
    .filter(o => o.status !== 'entregada')
    .filter(o => {
      // all items shown for this station
      const items: ParsedItem[] = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
      return items.some(item => !item.cancelled && getStation(item) === station)
    })
    .sort((a, b) => {
      const p: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
      const ps = (p[a.status] || 3) - (p[b.status] || 3)
      if (ps !== 0) return ps
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

  // Station counts
  const stationCounts: Record<string, number> = { cocina: 0, panaderia: 0, barra: 0 }
  for (const o of orders.filter(o => o.status === 'enviada' || o.status === 'preparando')) {
    const items: ParsedItem[] = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
    for (const item of items) {
      if (item.cancelled) continue
      const s = getStation(item)
      const qty = item.cantidad || item.quantity || 1
      stationCounts[s] += qty
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
            onClick={() => { router.push('/pos') }}
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
              <span className="w-3 h-3 rounded-full bg-amber-500" />
              {orders.filter(o => o.status === 'preparando').length}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
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
              <p className="text-sm mt-1">Actualizando cada 2 segundos</p>
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
                  // all items shown for this station
                  return getStation(item) === station
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
                      className="mx-3 mb-1 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-lg transition-colors min-h-[56px]"
                    >
                      BUMP
                    </button>
                  ) : (
                    <button
                      onClick={() => advance(order.id, order.status, order.mesa, order.mesero)}
                      className={`mx-3 mb-1 py-4 rounded-xl font-bold text-lg transition-colors min-h-[56px] ${
                        isNew
                          ? 'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black'
                          : 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black'
                      }`}
                    >
                      {isNew ? 'PREPARAR' : 'LISTA'}
                    </button>
                  )}
                  <button
                    onClick={() => handleReprint(order, activeItemsWithIndex.map(i => i.item))}
                    className="mx-3 mb-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-white text-sm font-medium flex items-center justify-center gap-1.5 min-h-[40px] transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Reimprimir
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {reprintMsg && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-lg z-50 ${reprintMsg.success ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {reprintMsg.text}
        </div>
      )}

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
