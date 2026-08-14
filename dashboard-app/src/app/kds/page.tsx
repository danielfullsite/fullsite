'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Printer } from 'lucide-react'
import {
  getKitchenOrders, updateOrderStatus, logAudit,
  type KitchenOrderFromDB, type OrderItem,
} from '@/lib/pos-data'
import { reprintByStation, type ReprintOrderContext } from '@/lib/printer'
import { type StationName, getStationByName } from '@/lib/pos-constants'
import { setPosServerHost } from '@/lib/bridge-client'
import { useKdsWsClient } from '@/hooks/useKdsWsClient'

declare global { interface Window { fullsiteApp?: { quit: () => void; isElectron?: boolean } } }

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
  station?: string
  comanda_batch_id?: string
}

// Resolve which station an item belongs to.
// Trusts item.station (set by POS at order time) as primary source.
// Falls back to name-based detection from pos-constants for legacy orders
// that predate the item.station field.
function resolveItemStation(item: ParsedItem): string {
  if (item.station) return item.station
  return getStationByName(item.nombre || item.name || '')
}

// Parseo defensivo de order.items. Una fila con items="null"/malformado hacía
// JSON.parse → null y luego .forEach/.map/.some sobre null → TypeError sin
// capturar → crasheaba TODO el KDS. Siempre devuelve un array.
function safeItems(raw: unknown): ParsedItem[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? (v as ParsedItem[]) : []
  } catch {
    return []
  }
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

const MODE_PILL = {
  LAN_PRIMARY:  { dot: 'bg-emerald-500', label: 'LAN' },
  RECONCILING:  { dot: 'bg-amber-400 animate-pulse', label: '...' },
  FALLBACK:     { dot: 'bg-orange-400', label: 'Supabase' },
  OFFLINE:      { dot: 'bg-slate-500', label: '' },
}

// ── Component ────────────────────────────────────────────────────────────

export default function KDSStandalone() {
  // Station identity — read from ?station= URL param on mount, persisted to localStorage.
  // Defaults to 'cocina' so an unconfigured terminal still shows the kitchen.
  // To open as barra: /kds?station=barra  (Electron appends this from config.json kds_station)
  const [station, setStation] = useState<string>('cocina')
  const [mounted, setMounted] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [, setTick] = useState(0)
  const [doneItems, setDoneItems] = useState<Set<string>>(new Set())
  const [reprintMsg, setReprintMsg] = useState<{ success: boolean; text: string } | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ success: boolean; text: string } | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  // Estado "preparando" por item (local/efímero): 1er toque = preparando (ámbar),
  // 2º toque = listo. Eduardo: el chef marca 1×1 conforme trabaja.
  const [prepItems, setPrepItems] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [alertMins, setAlertMins] = useState(10)   // min para parpadear "te tardas"
  const [fontScale, setFontScale] = useState(1)     // tamaño de comanda ajustable (zoom)
  const advancingRef = useRef<Set<string>>(new Set())
  const prevEnviadaRef = useRef(0)

  // Modo demo (?demo=1): comandas de muestra para ver/mostrar el rediseño sin datos
  // reales. Read-only: los toques marcan estado local, no escriben a Supabase.
  const [isDemo, setIsDemo] = useState(false)
  const [demoOrders] = useState<KitchenOrderFromDB[]>(() => {
    const t = (m: number) => new Date(Date.now() - m * 60000).toISOString()
    const mk = (o: Record<string, unknown>) => o as unknown as KitchenOrderFromDB
    return [
      mk({ id: 'demo-1', mesa: 5, mesero: 'Omar Aguilera', status: 'enviada', created_at: t(2), items: JSON.stringify([{ nombre: 'Chilaquiles Verdes', cantidad: 2, station: 'cocina', modificadores: ['Sin cebolla'] }, { nombre: 'Ensalada de papa', cantidad: 1, station: 'cocina' }]) }),
      mk({ id: 'demo-2', mesa: 12, mesero: 'Aldo Ruiz Ramirez', status: 'preparando', created_at: t(7), items: JSON.stringify([{ nombre: 'Ensalada de papa', cantidad: 3, station: 'cocina' }, { nombre: 'Croissant Clásico', cantidad: 1, station: 'cocina' }]) }),
      mk({ id: 'demo-3', mesa: 3, mesero: 'Mariana Salas', status: 'lista', created_at: t(1), items: JSON.stringify([{ nombre: 'Pancakes', cantidad: 1, station: 'cocina', modificadores: ['Extra miel'] }]) }),
      mk({ id: 'demo-4', mesa: 20, mesero: 'Julio Hernández', status: 'enviada', created_at: t(18), items: JSON.stringify([{ nombre: 'Ensalada de papa', cantidad: 1, station: 'cocina' }, { nombre: 'Chilaquiles Rojos', cantidad: 2, station: 'cocina', modificadores: ['Extra pollo'] }]) }),
    ]
  })
  const kdsClient = useKdsWsClient()
  const orders = isDemo ? demoOrders : kdsClient.orders

  useEffect(() => {
    const n = orders.filter(o => o.status === 'enviada').length
    if (prevEnviadaRef.current > 0 && n > prevEnviadaRef.current) playAlert()
    prevEnviadaRef.current = n
  }, [orders])

  useEffect(() => {
    const restored = new Set<string>()
    for (const order of orders) {
      let kdsStatus: Record<string, boolean> = {}
      if (order.kds_item_status) {
        try {
          const parsed = typeof order.kds_item_status === 'string'
            ? JSON.parse(order.kds_item_status)
            : order.kds_item_status
          // JSON.parse('null') → null; una fila con kds_item_status="null" hacía
          // Object.keys(null) → TypeError sin capturar → crasheaba TODO el KDS
          // (pantalla "This page couldn't load"). Solo aceptar objetos reales.
          if (parsed && typeof parsed === 'object') kdsStatus = parsed as Record<string, boolean>
        } catch { /* */ }
      }
      if (Object.keys(kdsStatus).length > 0) {
        for (const [idx, done] of Object.entries(kdsStatus)) {
          if (done) restored.add(`${order.id}-${idx}`)
        }
      } else {
        const items = safeItems(order.items)
        items.forEach((item, idx) => {
          if ((item as ParsedItem & { kds_done?: boolean }).kds_done) restored.add(`${order.id}-${idx}`)
        })
      }
    }
    setDoneItems(restored)
  }, [orders])

  const handleReprint = async (order: KitchenOrderFromDB, items: ParsedItem[], batchSeq?: number, sentAt?: string) => {
    const ctx: ReprintOrderContext = { id: order.id, mesa: order.mesa, mesero: order.mesero, notas: order.notas }
    const result = await reprintByStation(ctx, station as StationName, items as unknown as OrderItem[], batchSeq !== undefined ? { batchSeq, sentAt: sentAt ?? order.created_at } : undefined)
    const msg = result.printed ? 'Reimpreso' : (result.error ?? 'Error al imprimir')
    setReprintMsg({ success: result.printed, text: msg })
    setTimeout(() => setReprintMsg(null), 3000)
    void logAudit({ order_id: order.id, action: 'reprint_comanda', actor: 'kds', mesa: order.mesa, details: { station } })
  }

  const fetchOrdersForFallback = useCallback(async () => {
    let data: KitchenOrderFromDB[]
    try {
      data = await getKitchenOrders()
    } catch {
      try {
        const { getCachedOrders } = await import('@/lib/pos-offline-db')
        const [env, prep, lst] = await Promise.all([
          getCachedOrders('enviada'),
          getCachedOrders('preparando'),
          getCachedOrders('lista'),
        ])
        const cached = [...env, ...prep, ...lst] as unknown as KitchenOrderFromDB[]
        if (cached.length > 0) kdsClient.setFallbackOrders(cached)
      } catch { /* IndexedDB not available */ }
      return
    }
    const now = Date.now()
    const fourHours = 4 * 60 * 60 * 1000
    const fresh = data.filter(o => {
      const age = now - new Date(o.created_at).getTime()
      return age <= fourHours || o.status === 'lista'
    })
    kdsClient.setFallbackOrders(fresh)
    setLastUpdate(new Date())
  }, [kdsClient])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') setIsDemo(true)
    const bridgeHost = params.get('bridge')
    if (bridgeHost) setPosServerHost(bridgeHost)
    // Station identity — URL param wins; fall back to persisted value from last session
    const stationParam = params.get('station')
    if (stationParam) {
      const s = stationParam.toLowerCase()
      setStation(s)
      localStorage.setItem('kds_station', s)
    } else {
      const saved = localStorage.getItem('kds_station')
      if (saved) setStation(saved)
    }
    if (bridgeHost || stationParam) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    const am = parseInt(localStorage.getItem('kds_alert_mins') || '10', 10)
    if (am > 0) setAlertMins(am)
    const fs = parseFloat(localStorage.getItem('kds_font_scale') || '1')
    if (fs >= 0.6 && fs <= 1.8) setFontScale(fs)
    setMounted(true)
  }, [])

  useEffect(() => {
    const timerInterval = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(timerInterval)
  }, [])

  useEffect(() => {
    if (kdsClient.mode === 'LAN_PRIMARY') {
      setLastUpdate(new Date())
      return
    }
    fetchOrdersForFallback()
    const interval = setInterval(fetchOrdersForFallback, 2000)
    return () => clearInterval(interval)
  }, [kdsClient.mode, fetchOrdersForFallback])

  const advance = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    if (isDemo) return
    if (advancingRef.current.has(id)) return
    advancingRef.current.add(id)
    const next = currentStatus === 'enviada' ? 'preparando' : currentStatus === 'preparando' ? 'lista' : currentStatus === 'lista' ? 'entregada' : null
    if (!next) { advancingRef.current.delete(id); return }
    // KDS-020: optimistic update for FALLBACK/OFFLINE — immediate visual feedback before async write
    if (kdsClient.mode !== 'LAN_PRIMARY') {
      kdsClient.setFallbackOrders(orders.map(o => o.id === id ? { ...o, status: next } : o))
    }
    try {
      kdsClient.sendCommand('ORDER_UPSERTED', { order_id: id, mesa, status: next })
      const ok = await updateOrderStatus(id, next)
      if (!ok) {
        // Server rejected while online — rollback optimistic update
        if (kdsClient.mode !== 'LAN_PRIMARY') {
          kdsClient.setFallbackOrders(orders.map(o => o.id === id ? { ...o, status: currentStatus } : o))
        }
        setStatusMsg({ success: false, text: 'Error al guardar — intenta de nuevo' })
        setTimeout(() => setStatusMsg(null), 3000)
        return
      }
      void logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: currentStatus, to: next, mesero } })
      if (kdsClient.mode !== 'LAN_PRIMARY' && typeof navigator !== 'undefined' && !navigator.onLine) {
        setStatusMsg({ success: true, text: 'Avanzado · se sincroniza al reconectar' })
        setTimeout(() => setStatusMsg(null), 3000)
      }
    } finally {
      advancingRef.current.delete(id)
    }
  }

  const bump = async (id: string, mesa: number, mesero: string) => {
    if (isDemo) return
    if (advancingRef.current.has(id)) return
    advancingRef.current.add(id)
    // KDS-020: optimistic update — remove order from visible list immediately
    if (kdsClient.mode !== 'LAN_PRIMARY') {
      kdsClient.setFallbackOrders(orders.map(o => o.id === id ? { ...o, status: 'entregada' } : o))
    }
    try {
      kdsClient.sendCommand('ORDER_UPSERTED', { order_id: id, mesa, status: 'entregada' })
      const ok = await updateOrderStatus(id, 'entregada')
      if (!ok) {
        if (kdsClient.mode !== 'LAN_PRIMARY') {
          kdsClient.setFallbackOrders(orders.map(o => o.id === id ? { ...o, status: 'lista' } : o))
        }
        setStatusMsg({ success: false, text: 'Error al guardar — intenta de nuevo' })
        setTimeout(() => setStatusMsg(null), 3000)
        return
      }
      void logAudit({ order_id: id, action: 'status_changed', actor: 'KDS', mesa, details: { from: 'lista', to: 'entregada', mesero } })
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
        const items: ParsedItem[] = safeItems(order.items)
        const allDone = items.every((item, idx) => {
          if (item.cancelled) return true
          const k = `${orderId}-${idx}`
          return k === key || prev.has(k)
        })
        if (allDone && order.status === 'preparando') {
          advance(orderId, order.status, order.mesa, order.mesero)
        }
      }

      const items: ParsedItem[] = safeItems(order.items)
      const kdsStatus: Record<string, boolean> = {}
      items.forEach((item, idx) => {
        if (item.cancelled) return
        const k = `${orderId}-${idx}`
        kdsStatus[`${idx}`] = k === key ? !prev.has(key) : next.has(k)
      })

      kdsClient.sendCommand('KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: JSON.stringify(kdsStatus) })

      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ kds_item_status: JSON.stringify(kdsStatus) }),
      }).catch(() => {
        import('@/lib/pos-offline-db').then(({ queueOperation }) =>
          queueOperation('pos_orders', 'PATCH', { kds_item_status: JSON.stringify(kdsStatus) }, `pos_orders?id=eq.${orderId}`)
        ).catch(() => {
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

  const filteredOrders = orders
    .filter(o => o.status !== 'entregada')
    .filter(o => {
      const items: ParsedItem[] = safeItems(o.items)
      return items.some(item => !item.cancelled && resolveItemStation(item) === station)
    })
    .sort((a, b) => {
      const p: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
      const ps = (p[a.status] || 3) - (p[b.status] || 3)
      if (ps !== 0) return ps
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

  // KDS-013: expand filteredOrders → per-batch cards so multi-round orders show separate cards
  interface KDSBatchCard {
    order: typeof orders[0]
    batchId: string | null
    batchSeq: number
    batchCreatedAt: string
  }
  const kdsCards: KDSBatchCard[] = []
  for (const order of filteredOrders) {
    const allBatchItems: ParsedItem[] = safeItems(order.items)
    let batchMeta: Record<string, { seq?: number; created_at?: string }> = {}
    try { batchMeta = typeof order.comanda_batches === 'string' ? JSON.parse(order.comanda_batches || '{}') : ((order.comanda_batches as unknown as Record<string, { seq?: number; created_at?: string }>) ?? {}) } catch {}
    const batchIds = [...new Set(allBatchItems.map(i => i.comanda_batch_id).filter((b): b is string => !!b))]
    if (batchIds.length <= 1) {
      kdsCards.push({ order, batchId: null, batchSeq: 0, batchCreatedAt: order.created_at })
    } else {
      for (const bid of batchIds) {
        kdsCards.push({ order, batchId: bid, batchSeq: batchMeta[bid]?.seq ?? 0, batchCreatedAt: batchMeta[bid]?.created_at ?? order.created_at })
      }
    }
  }
  kdsCards.sort((a, b) => new Date(a.batchCreatedAt).getTime() - new Date(b.batchCreatedAt).getTime())

  // Toque por item (Eduardo): pending → preparando (1 toque) → listo (2º toque).
  // El 1er toque en una orden NUEVA la avanza a "preparando" (color ámbar).
  const handleItemTap = (order: KitchenOrderFromDB, originalIndex: number) => {
    const key = `${order.id}-${originalIndex}`
    if (isDemo) {  // solo visual, sin red
      if (doneItems.has(key)) { setDoneItems(p => { const n = new Set(p); n.delete(key); return n }); return }
      if (prepItems.has(key)) { setPrepItems(p => { const n = new Set(p); n.delete(key); return n }); setDoneItems(p => { const n = new Set(p); n.add(key); return n }); return }
      setPrepItems(p => { const n = new Set(p); n.add(key); return n }); return
    }
    if (doneItems.has(key)) {
      toggleItemDone(order.id, originalIndex, order)  // deshacer: listo → pending
      return
    }
    if (prepItems.has(key)) {
      setPrepItems(p => { const n = new Set(p); n.delete(key); return n })
      toggleItemDone(order.id, originalIndex, order)  // preparando → listo
      return
    }
    if (order.status === 'enviada') advance(order.id, 'enviada', order.mesa, order.mesero)
    setPrepItems(p => { const n = new Set(p); n.add(key); return n })
  }

  const saveSettings = (mins: number, scale: number) => {
    setAlertMins(mins); setFontScale(scale)
    try { localStorage.setItem('kds_alert_mins', String(mins)); localStorage.setItem('kds_font_scale', String(scale)) } catch {}
  }

  // Panel izquierdo — platillos PENDIENTES agregados por DEMANDA (lo más pedido arriba).
  // Excluye cancelados, otra estación y los ya marcados listos. Eduardo: "me debes 5 ensaladas".
  const demandMap = new Map<string, number>()
  for (const order of filteredOrders) {
    safeItems(order.items).forEach((item, idx) => {
      if (item.cancelled || resolveItemStation(item) !== station) return
      if (doneItems.has(`${order.id}-${idx}`)) return
      const name = String(item.nombre || item.name || '—')
      demandMap.set(name, (demandMap.get(name) || 0) + (item.cantidad || item.quantity || 1))
    })
  }
  const demandList = [...demandMap.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)

  const modePill = MODE_PILL[kdsClient.mode]

  if (!mounted) return null

  return (
    <div className="h-screen flex flex-col bg-black text-white select-none overflow-hidden" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 flex-shrink-0" style={{ background: '#111' }}>
        <div className="flex items-center gap-3">
          <span className="text-white font-black text-xl tracking-widest uppercase">
            {station.charAt(0).toUpperCase() + station.slice(1)}
          </span>
          <div className="flex items-center gap-3 text-sm ml-4">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-white/40" />
              {orders.filter(o => o.status === 'enviada').length} nueva{orders.filter(o => o.status === 'enviada').length !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              {orders.filter(o => o.status === 'preparando').length} prep
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              {orders.filter(o => o.status === 'lista').length} lista{orders.filter(o => o.status === 'lista').length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {modePill.label && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${modePill.dot}`} />
              {modePill.label}
            </span>
          )}
          <span className="text-slate-500 text-xs font-mono">
            {lastUpdate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          {/* Ajustes */}
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
            title="Ajustes"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          {/* X salir — SIEMPRE visible */}
          <button
            onClick={() => setShowExitConfirm(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-800 text-slate-300 hover:bg-red-600 hover:text-white transition-colors"
            title="Salir del KDS"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Cuerpo: panel PENDIENTES (izq) + comandas (der) */}
      <div className="flex-1 flex overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <p className="text-5xl mb-4">👨‍🍳</p>
              <p className="text-2xl font-bold text-slate-300">Sin ordenes</p>
              <p className="text-sm mt-1">
                {kdsClient.mode === 'LAN_PRIMARY' ? 'Escuchando en red local' : 'Actualizando cada 2 segundos'}
              </p>
            </div>
          </div>
        ) : (
        <>
          {/* Panel izquierdo: platillos pendientes por DEMANDA (lo más pedido arriba) */}
          <aside className="w-56 flex-shrink-0 border-r border-slate-800 overflow-y-auto py-2" style={{ background: '#0d0d0d' }}>
            <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">Pendientes</p>
            <div>
              {demandList.map(d => (
                <div key={d.name} className="flex items-baseline gap-2 px-3 py-1.5 border-b border-slate-800/50">
                  <span className="text-emerald-400 font-black text-xl min-w-[38px] tabular-nums">{d.qty}×</span>
                  <span className="text-slate-200 text-sm font-medium leading-tight">{d.name}</span>
                </div>
              ))}
            </div>
          </aside>
          {/* Comandas (zoom = tamaño ajustable en Ajustes) */}
          <div className="flex-1 overflow-y-auto p-2.5" style={{ zoom: fontScale }}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
            {kdsCards.map(card => {
              const order = card.order
              const mins = elapsed(card.batchCreatedAt)
              const isNew = order.status === 'enviada'
              const isPrep = order.status === 'preparando'
              const isDone = order.status === 'lista'

              const allItems: ParsedItem[] = safeItems(order.items)
              const activeItemsWithIndex = allItems
                .map((item, idx) => ({ item, originalIndex: idx }))
                .filter(({ item }) => !item.cancelled && (!card.batchId || item.comanda_batch_id === card.batchId) && resolveItemStation(item) === station)
              if (activeItemsWithIndex.length === 0) return null
              const doneCount = activeItemsWithIndex.filter(({ originalIndex }) => doneItems.has(`${order.id}-${originalIndex}`)).length
              const totalCount = activeItemsWithIndex.length

              const borderColor = isNew ? 'border-white/40' : isPrep ? 'border-amber-500/50' : 'border-emerald-500/50'
              const headerBg = isNew ? 'bg-white text-black' : isPrep ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'
              const cardKey = card.batchId ? `${order.id}-${card.batchId}` : order.id

              return (
                <div
                  key={cardKey}
                  className={`rounded-2xl border-2 ${borderColor} flex flex-col overflow-hidden ${isNew ? 'animate-pulse-once' : ''} ${mins >= alertMins ? 'kds-late' : ''}`}
                  style={{ background: '#1a1a1a' }}
                >
                  <div
                    onDoubleClick={() => bump(order.id, order.mesa, order.mesero)}
                    title="Doble clic = quitar la comanda"
                    className={`flex items-center justify-between px-4 py-3 cursor-pointer ${headerBg}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-black">{order.mesa || 'D'}</span>
                      {card.batchSeq > 0 && (
                        <span className="text-xs font-bold opacity-60 bg-black/20 px-1.5 py-0.5 rounded">
                          R{card.batchSeq + 1}
                        </span>
                      )}
                      <div className="leading-tight">
                        <p className="text-sm font-black uppercase tracking-wide">{isNew ? 'NUEVA' : isPrep ? 'PREPARANDO' : 'LISTA'}</p>
                        <p className="text-xs opacity-70">{order.mesero?.split(' ').slice(0, 2).join(' ')} · {new Date(card.batchCreatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPrep && totalCount > 0 && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-black/20">
                          {doneCount}/{totalCount}
                        </span>
                      )}
                      <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border ${timerBg(mins)}`}>
                        <span className={`text-lg font-mono font-black ${timerColor(mins)}`}>{mins}m</span>
                      </div>
                    </div>
                  </div>

                  {isPrep && totalCount > 0 && (
                    <div className="h-1 bg-slate-700">
                      <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(doneCount / totalCount) * 100}%` }} />
                    </div>
                  )}

                  <div className="flex-1 px-4 py-3 space-y-0.5">
                    {activeItemsWithIndex.map(({ item, originalIndex }) => {
                      const itemKey = `${order.id}-${originalIndex}`
                      const itemDone = doneItems.has(itemKey)
                      const itemPrep = !itemDone && prepItems.has(itemKey)

                      return (
                        <button
                          key={originalIndex}
                          type="button"
                          onClick={() => handleItemTap(order, originalIndex)}
                          className={`flex items-start gap-2 w-full text-left rounded-lg px-2 py-2 min-h-[46px] transition-colors cursor-pointer active:bg-slate-700/50 ${itemPrep ? 'bg-amber-500/10' : ''} ${itemDone ? 'opacity-55' : ''}`}
                        >
                          <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                            itemDone ? 'bg-emerald-500 border-emerald-500' : itemPrep ? 'border-amber-400 bg-amber-400/20' : 'border-slate-600'
                          }`}>
                            {itemDone ? (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : itemPrep ? (
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                            ) : null}
                          </span>
                          <span className={`font-black text-base min-w-[26px] tabular-nums ${itemDone ? 'text-emerald-600' : 'text-emerald-400'}`}>
                            {item.cantidad || item.quantity || 1}×
                          </span>
                          <div className="flex-1">
                            <p className={`text-[15px] font-semibold leading-tight ${itemDone ? 'text-emerald-400 line-through' : itemPrep ? 'text-amber-200' : 'text-white'}`}>
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
                    onClick={() => handleReprint(order, activeItemsWithIndex.map(i => i.item), card.batchId ? card.batchSeq : undefined, card.batchId ? card.batchCreatedAt : undefined)}
                    className="mx-3 mb-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium flex items-center justify-center gap-1.5 min-h-[40px] transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Reimprimir
                  </button>
                </div>
              )
            })}
          </div>
          </div>
        </>
        )}
      </div>

      {reprintMsg && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-lg z-50 ${reprintMsg.success ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {reprintMsg.text}
        </div>
      )}
      {statusMsg && (
        <div className={`fixed bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-lg z-50 ${statusMsg.success ? 'bg-slate-700 text-white' : 'bg-red-600 text-white'}`}>
          {statusMsg.text}
        </div>
      )}

      {/* Ajustes del KDS */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-slate-800 rounded-2xl p-7 w-[340px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-white text-lg font-bold mb-5">Ajustes del KDS</p>

            <label className="block text-slate-300 text-sm mb-2">Alerta de demora — parpadea a los (min)</label>
            <div className="flex items-center gap-2 mb-5">
              {[5, 10, 15, 20].map(m => (
                <button key={m} onClick={() => saveSettings(m, fontScale)}
                  className={`flex-1 py-2 rounded-lg font-bold ${alertMins === m ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-300'}`}>
                  {m}
                </button>
              ))}
            </div>

            <label className="block text-slate-300 text-sm mb-2">Tamaño de comanda</label>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => saveSettings(alertMins, Math.max(0.7, Math.round((fontScale - 0.1) * 10) / 10))}
                className="w-12 h-12 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-2xl font-black">−</button>
              <span className="flex-1 text-center text-white font-bold text-lg tabular-nums">{Math.round(fontScale * 100)}%</span>
              <button onClick={() => saveSettings(alertMins, Math.min(1.6, Math.round((fontScale + 0.1) * 10) / 10))}
                className="w-12 h-12 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-2xl font-black">+</button>
            </div>

            <button onClick={() => setShowSettings(false)}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg">
              Listo
            </button>
          </div>
        </div>
      )}

      {/* Exit confirmation overlay */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl p-8 flex flex-col items-center gap-6 shadow-2xl">
            <p className="text-white text-xl font-bold">¿Cerrar el KDS?</p>
            <div className="flex gap-4">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-8 py-3 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-bold text-lg"
              >
                Cancelar
              </button>
              <button
                onClick={() => { window.fullsiteApp?.quit() }}
                className="px-8 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-lg"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse-once {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          50% { box-shadow: 0 0 0 8px rgba(255,255,255,0.15); }
        }
        .animate-pulse-once { animation: pulse-once 1s ease-in-out 2; }
        @keyframes kds-late-blink {
          0%, 100% { box-shadow: 0 0 0 0 rgba(242,85,90,0); }
          50% { box-shadow: 0 0 0 4px rgba(242,85,90,0.55); }
        }
        .kds-late { animation: kds-late-blink 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
