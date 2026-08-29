'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame, RefreshCw, Ban, ShieldAlert, X, Settings, WifiOff, ChevronsDown } from 'lucide-react'
import {
  getKitchenOrders, updateOrderStatus, logAudit, saveOrder,
  updateInventoryStock, logInventoryMovement, getInventory, getRecipes,
  getRecipeDetail,
  verifyManagerPin, RECIPE_ALIASES, formatMXN,
  type KitchenOrderFromDB, type RecipeDetail,
} from '@/lib/pos-data'
import { isBebida, POLL_INTERVAL_KITCHEN, getStationByName, type StationName } from '@/lib/pos-constants'
import { getActiveClientSlug as _cid } from '@/lib/data'


function getElapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

interface ParsedItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  modificadores?: string[]
  notas?: string
  cancelled?: boolean
  cancelReason?: string
  cancelledBy?: string
  station?: 'cocina' | 'barra' | 'caja'
  menuItemId?: string
}

const PANADERIA_KW = ['croissant', 'concha', 'bakery', 'panadería', 'postre', 'cheesecake', 'carrot cake', 'toast', 'bagel', 'galleta', 'brownie', 'crunchy', 'muffin', 'scone']

/** Resolve the station for an item — stored station field takes priority, keyword fallback */
function resolveItemStation(i: ParsedItem): StationName {
  if (i.station) return i.station
  const name = (i.nombre || i.name || '').toLowerCase()
  return getStationByName(name)
}

/** Returns true if at least one non-cancelled item in the order matches the given station filter. */
function orderHasItemsForStation(order: KitchenOrderFromDB, filter: 'todo' | 'panaderia' | StationName): boolean {
  const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
  return items.some(i => {
    if (i.cancelled) return false
    if (i.menuItemId === '__tiempo__') return filter === 'todo'
    if (filter === 'todo') return true
    const name = (i.nombre || i.name || '').toLowerCase()
    if (filter === 'panaderia') return PANADERIA_KW.some(kw => name.includes(kw))
    return resolveItemStation(i) === filter
  })
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  // Display-only wall clock (HH:MM:SS) — presentation parity with KDS surface
  const [clock, setClock] = useState('')

  // Recipe detail modal
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const showRecipeDetail = async (itemName: string) => {
    setLoadingDetail(true)
    const detail = await getRecipeDetail(itemName)
    setRecipeDetail(detail)
    setLoadingDetail(false)
  }

  // Station filter
  const isKdsSurface = typeof window !== 'undefined' && (window as unknown as { fullsiteApp?: { surface?: string } }).fullsiteApp?.surface === 'kds'

  const [stationFilter, setStationFilter] = useState<'todo' | 'panaderia' | StationName>('cocina')

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState<{ orderId: string; itemIndex: number; itemName: string; mesa: number; mesero: string } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelPin, setCancelPin] = useState('')
  const [cancelError, setCancelError] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const CANCEL_REASONS = [
    'Cliente cambio de opinion',
    'Platillo agotado',
    'Error del mesero',
    'Preparacion incorrecta',
    'Tiempo de espera excesivo',
  ]

  const prevOrderCountRef = useRef(0)

  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.value = 0.3
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc.stop(ctx.currentTime + 0.5)
      // Second beep
      setTimeout(() => {
        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.connect(gain2)
        gain2.connect(ctx.destination)
        osc2.frequency.value = 1100
        osc2.type = 'sine'
        gain2.gain.value = 0.3
        osc2.start()
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
        osc2.stop(ctx.currentTime + 0.5)
      }, 200)
    } catch { /* audio not available */ }
  }

  const fetchOrders = async () => {
    try {
      await fetchOrdersInner()
    } catch {
      // Nunca dejar el spinner colgado (p. ej. sin red)
    } finally {
      setLoading(false)
      setOffline(typeof navigator !== 'undefined' && !navigator.onLine)
    }
  }

  const fetchOrdersInner = async () => {
    const data = await getKitchenOrders()

    // Auto-archive orders older than 4 hours (stuck in enviada/preparando)
    const now = Date.now()
    const fourHoursMs = 4 * 60 * 60 * 1000
    for (const order of data) {
      const age = now - new Date(order.created_at).getTime()
      if (age > fourHoursMs && (order.status === 'enviada' || order.status === 'preparando')) {
        try {
          await updateOrderStatus(order.id, 'entregada')
        } catch { /* non-blocking */ }
      }
    }
    // Re-filter after auto-archive
    const fresh = data.filter(o => {
      const age = now - new Date(o.created_at).getTime()
      return age <= fourHoursMs || o.status === 'lista'
    })

    // Also fetch delivery orders (nueva/preparando)
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const delRes = await fetch(
        `${sbUrl}/rest/v1/delivery_orders?select=*&status=in.(nueva,aceptada,preparando)&client_id=eq.${_cid()}&order=created_at.desc`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      )
      if (delRes.ok) {
        const deliveryOrders = await delRes.json()
        for (const d of deliveryOrders) {
          const platformBadge: Record<string, string> = { ubereats: '🟢 Uber', rappi: '🟠 Rappi' }
          const items = typeof d.items === 'string' ? JSON.parse(d.items) : d.items || []
          fresh.push({
            id: d.id,
            mesa: 0,
            mesero: platformBadge[d.platform] || d.platform,
            status: d.status === 'nueva' ? 'enviada' : d.status,
            items: JSON.stringify(items.map((i: { name: string; qty: number; notes?: string; modifiers?: string }) => ({
              nombre: i.name, cantidad: i.qty, notas: i.notes || '', modificadores: i.modifiers || '',
            }))),
            created_at: d.created_at,
            notas: d.notes || `${d.customer_name} · $${d.total}`,
          } as KitchenOrderFromDB)
        }
      }
    } catch { /* delivery table might not exist yet */ }

    // Play sound if new 'enviada' orders appeared (skip first load)
    const newEnviadas = fresh.filter(o => o.status === 'enviada').length
    if (prevOrderCountRef.current > 0 && newEnviadas > prevOrderCountRef.current) {
      playNotificationSound()
    }
    prevOrderCountRef.current = newEnviadas
    setOrders(fresh)
  }

  useEffect(() => {
    setMounted(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, POLL_INTERVAL_KITCHEN)
    return () => clearInterval(interval)
  }, [])

  // Wall clock tick (display only)
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Cancel an item from a sent order
  const handleCancelItem = async () => {
    if (!cancelTarget) return
    if (!cancelReason) { setCancelError('Selecciona un motivo'); return }
    if (!cancelPin) { setCancelError('Ingresa PIN de gerente'); return }
    const manager = await verifyManagerPin(cancelPin)
    if (!manager) { setCancelError('PIN invalido'); return }

    // 1. Get the order and mark item as cancelled
    const order = orders.find(o => o.id === cancelTarget.orderId)
    if (!order) return

    const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
    if (!items[cancelTarget.itemIndex]) { setCancelError('Item no encontrado'); return }
    items[cancelTarget.itemIndex] = {
      ...items[cancelTarget.itemIndex],
      cancelled: true,
      cancelReason,
      cancelledBy: manager,
    }

    // 2. Update order items via revision-aware save boundary
    // R2D1B: cocina cancel must advance order_revision to maintain reconciliation lineage
    // R2D: save_operation_id for exactly-once idempotency
    const cocinaOpId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const saveRes = await fetch('/api/pos/save-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: cancelTarget.orderId,
        expected_revision: order.order_revision ?? 0,
        save_operation_id: cocinaOpId,
        items,
        status: order.status,
      }),
    })
    const saveResult = saveRes.ok ? await saveRes.json() : { ok: false }
    if (saveResult.conflict) {
      setCancelError('Orden modificada por otra terminal — recarga')
      return
    }
    if (!saveResult.ok) {
      setCancelError('Error al guardar cancelación')
      return
    }

    // 3. Re-add ingredients to inventory
    const itemName = cancelTarget.itemName.toLowerCase()
    const allRecipes = await getRecipes()
    const inventory = await getInventory()
    const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

    const recipesByName = new Map<string, typeof allRecipes>()
    for (const r of allRecipes) {
      const key = r.menu_item_name.toLowerCase()
      if (!recipesByName.has(key)) recipesByName.set(key, [])
      recipesByName.get(key)!.push(r)
    }

    // Find matching recipe (same logic as deduction)
    let recipeRows = recipesByName.get(itemName) ?? []
    if (recipeRows.length === 0) {
      const aliases = RECIPE_ALIASES[itemName]
      if (aliases) {
        for (const alias of aliases) {
          const rows = recipesByName.get(alias.toLowerCase())
          if (rows && rows.length > 0) { recipeRows = rows; break }
        }
      }
    }

    // R0.5 CONTAINMENT — recipe reversal suspended because R0 suspends forward
    // recipe deductions. Reversing never-deducted stock creates phantom inflation.
    // Will be re-enabled via unified R1 reconciler. See R0.5 containment.
    if (recipeRows.length > 0) {
      console.log(`[inventory] R0.5 containment: KDS cancel reversal for ${cancelTarget.itemName} suspended (${recipeRows.length} recipe rows) — forward deduction was R0-suspended`)
    }

    // 4. Audit log
    logAudit({
      order_id: cancelTarget.orderId,
      action: 'item_cancelled',
      actor: cancelTarget.mesero,
      mesa: cancelTarget.mesa,
      details: { item: cancelTarget.itemName, reason: cancelReason },
      reason: cancelReason,
      approved_by: manager,
    })

    setCancelTarget(null)
    setCancelReason('')
    setCancelPin('')
    setCancelError('')
    showToast(`${cancelTarget.itemName} cancelado — ingredientes devueltos al inventario`)
    fetchOrders()
  }

  const STATUS_ORDER: Record<string, number> = { enviada: 1, preparando: 2, lista: 3, entregada: 4 }

  const advanceStatus = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    let newStatus = ''
    if (currentStatus === 'enviada') newStatus = 'preparando'
    else if (currentStatus === 'preparando') newStatus = 'lista'
    else if (currentStatus === 'lista') newStatus = 'entregada'
    if (!newStatus) return

    // Forward-only guard: check current DB status from orders state before advancing.
    // This prevents a stale localStorage itemStatus on one device from flipping an order
    // backward when another device already advanced it.
    const orderInState = orders.find(o => o.id === id)
    const dbStatusRank = STATUS_ORDER[orderInState?.status ?? currentStatus] ?? 0
    const newStatusRank = STATUS_ORDER[newStatus] ?? 0
    if (newStatusRank <= dbStatusRank) {
      // Already at or past this status — skip to avoid going backward
      return
    }

    try {
      await updateOrderStatus(id, newStatus)
      logAudit({
        order_id: id, action: 'status_changed', actor: 'Cocina', mesa,
        details: { from: currentStatus, to: newStatus, mesero },
      })
      fetchOrders()
    } catch (err) {
      console.error('Error advancing status:', err)
      alert('Error al cambiar estado. Intenta de nuevo.')
    }
  }

  // KDS Settings (configurable alert threshold) — persist in localStorage
  const [alertMinutes, setAlertMinutes] = useState(() => {
    try { const v = localStorage.getItem('kds_alert_minutes'); return v ? Number(v) : 10 } catch { return 10 }
  })
  const [showSettings, setShowSettings] = useState(false)

  // Persist alert setting
  useEffect(() => {
    try { localStorage.setItem('kds_alert_minutes', String(alertMinutes)) } catch {}
  }, [alertMinutes])

  // Item-level status tracking: 1 click = preparando, 2 clicks = listo (disappears)
  // Persisted in localStorage so refresh doesn't reset chef's progress
  const KDS_STATUS_KEY = 'kds_item_status'

  const loadItemStatus = (): Record<string, 'preparando' | 'listo'> => {
    try {
      const raw = localStorage.getItem(KDS_STATUS_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      // Clean entries older than 4 hours (same as order auto-archive)
      const now = Date.now()
      const fourHours = 4 * 60 * 60 * 1000
      const cleaned: Record<string, 'preparando' | 'listo'> = {}
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'object' && val !== null && 'status' in val && 'ts' in val) {
          const entry = val as { status: 'preparando' | 'listo'; ts: number }
          if (now - entry.ts < fourHours) {
            cleaned[key] = entry.status
          }
        }
      }
      return cleaned
    } catch { return {} }
  }

  const [itemStatus, setItemStatus] = useState<Record<string, 'preparando' | 'listo'>>(loadItemStatus)

  // Persist itemStatus to localStorage on every change
  useEffect(() => {
    try {
      const now = Date.now()
      const toStore: Record<string, { status: string; ts: number }> = {}
      for (const [key, status] of Object.entries(itemStatus)) {
        toStore[key] = { status, ts: now }
      }
      localStorage.setItem(KDS_STATUS_KEY, JSON.stringify(toStore))
    } catch {}
  }, [itemStatus])

  // Auto-advance orders where all items are marked listo (runs as effect, not during render)
  useEffect(() => {
    for (const order of orders) {
      if (order.status === 'lista' || order.status === 'entregada') continue
      const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
      const active = items.filter(i => !i.cancelled)
      if (active.length === 0) continue
      const allListo = active.every((_, idx) => {
        const globalIdx = items.indexOf(active[idx])
        return itemStatus[`${order.id}-${globalIdx}`] === 'listo'
      })
      if (allListo) {
        advanceStatus(order.id, order.status, order.mesa, order.mesero)
      }
    }
  }, [itemStatus])

  const lastClickTime = useRef<Record<string, number>>({})

  const handleItemClick = (orderId: string, itemIndex: number, itemName: string) => {
    const key = `${orderId}-${itemIndex}`
    const now = Date.now()
    // Debounce: minimum 500ms between state transitions to prevent accidental double-click
    if (lastClickTime.current[key] && now - lastClickTime.current[key] < 500) return
    lastClickTime.current[key] = now

    setItemStatus(prev => {
      const current = prev[key]
      if (!current) {
        // First click: preparando
        return { ...prev, [key]: 'preparando' }
      } else if (current === 'preparando') {
        // Second click: listo (will be filtered out)
        return { ...prev, [key]: 'listo' }
      }
      return prev
    })
  }

  const statusConfig: Record<string, { bg: string; border: string; badge: string; badgeText: string; label: string; nextLabel: string }> = {
    enviada: { bg: 'bg-[var(--surface-2)]', border: 'border-white/20', badge: 'bg-[var(--surface)]', badgeText: 'text-[var(--text-1)]', label: 'NUEVA', nextLabel: 'Preparando' },
    preparando: { bg: 'bg-amber-950/40', border: 'border-amber-500/40', badge: 'bg-amber-500', badgeText: 'text-black', label: 'PREPARANDO', nextLabel: 'Lista' },
    lista: { bg: 'bg-emerald-950/40', border: 'border-emerald-500/40', badge: 'bg-emerald-500', badgeText: 'text-black', label: 'LISTA', nextLabel: 'Entregada' },
  }

  // Batch counter: count pending items by name — filtered by current station
  const batchCounts = (() => {
    const counts: Record<string, { total: number; listo: number }> = {}
    const pendingOrders = orders.filter(o => o.status === 'enviada' || o.status === 'preparando')
    for (const order of pendingOrders) {
      const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
      items.forEach((item, idx) => {
        if (item.cancelled) return
        if (item.menuItemId === '__tiempo__') return
        // Only count items that belong to the current station filter
        const itemStation = resolveItemStation(item)
        if (stationFilter !== 'todo' && stationFilter !== 'panaderia' && itemStation !== stationFilter) return
        if (stationFilter === 'panaderia') {
          const name = (item.nombre || item.name || '').toLowerCase()
          if (!PANADERIA_KW.some(kw => name.includes(kw))) return
        }
        const name = item.nombre || item.name || '?'
        const qty = item.cantidad || item.quantity || 1
        if (!counts[name]) counts[name] = { total: 0, listo: 0 }
        counts[name].total += qty
        const key = `${order.id}-${idx}`
        if (itemStatus[key] === 'listo') counts[name].listo += qty
      })
    }
    return counts
  })()

  // Production area classification for summary bar
  // isBebida imported from shared constants at top of file

  const AREA_KEYWORDS: Record<string, string[]> = {
    'Cocina': ['chilaquil', 'enchilada', 'huevo', 'egg', 'omelet', 'benedict', 'machacado', 'half & half', 'pancake', 'waffle', 'french toast', 'panini', 'pizza', 'pasta', 'combo amalay', 'combo fit', 'croque', 'bowl', 'acai', 'fruit', 'salad', 'ensalada', 'ceviche'],
    'Panadería': ['croissant', 'concha', 'bakery', 'panadería', 'postre', 'cheesecake', 'carrot cake', 'toast', 'bagel', 'galleta', 'brownie', 'crunchy'],
  }

  const AREA_COLORS: Record<string, string> = {
    'Cocina': 'bg-amber-500',
    'Panadería': 'bg-orange-400',
  }

  const areaCounts = (() => {
    const counts: Record<string, number> = { 'Cocina': 0, 'Panadería': 0 }
    const pendingOrders = orders.filter(o => o.status === 'enviada' || o.status === 'preparando')
    for (const order of pendingOrders) {
      const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
      for (const item of items) {
        if (item.cancelled) continue
        const name = (item.nombre || item.name || '').toLowerCase()
        const qty = item.cantidad || item.quantity || 1
        // Skip bebidas — they go to Barra
        if (isBebida(name)) continue
        let matched = false
        for (const [area, keywords] of Object.entries(AREA_KEYWORDS)) {
          if (keywords.some(kw => name.includes(kw))) {
            counts[area] += qty
            matched = true
            break
          }
        }
        if (!matched) counts['Cocina'] += qty // default to kitchen
      }
    }
    return counts
  })()

  const totalPendingItems = Object.values(areaCounts).reduce((a, b) => a + b, 0)

  // FIFO: oldest orders first (Eduardo feedback Jul 21)
  const sortedOrders = [...orders].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  if (!mounted) return null

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--text-1)]">
      <header className="flex items-center justify-between gap-3 flex-wrap px-[18px] py-[14px] border-b border-[var(--line)] flex-shrink-0" style={{ background: 'linear-gradient(180deg,var(--surface-2),var(--surface))' }}>
        <div className="flex items-center gap-4 flex-wrap">
          {!isKdsSurface && (
            <Link href="/pos" aria-label="Volver" className="w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent-line)] hover:bg-[var(--raised)] text-[var(--text-2)] hover:text-[var(--text-1)] flex items-center justify-center transition-colors">
              <ArrowLeft size={18} />
            </Link>
          )}
          <div className="flex items-center gap-2.5 text-[26px] font-black leading-none tracking-[0.04em]">
            <span className="w-[34px] h-[34px] rounded-[10px] bg-[var(--accent-soft)] border border-[var(--accent-line)] grid place-items-center text-[var(--accent-ink)]">
              <ChefHat size={20} />
            </span>
            COCINA
          </div>
          <div className="flex items-center gap-3.5 text-[12.5px] font-semibold text-[var(--text-2)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--text-2)' }} />
              <b className="text-[var(--text-1)] tnum">{orders.filter(o => o.status === 'enviada' && orderHasItemsForStation(o, stationFilter)).length}</b> nuevas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--warn)' }} />
              <b className="text-[var(--text-1)] tnum">{orders.filter(o => o.status === 'preparando' && orderHasItemsForStation(o, stationFilter)).length}</b> prep
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-bright)' }} />
              <b className="text-[var(--text-1)] tnum">{orders.filter(o => o.status === 'lista' && orderHasItemsForStation(o, stationFilter)).length}</b> listas
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="inline-flex items-center gap-2 px-3 py-[7px] rounded-full bg-[var(--surface-2)] border border-[var(--line)] text-xs font-semibold text-[var(--text-2)]">
            {offline
              ? <><span className="w-2 h-2 rounded-full" style={{ background: 'var(--warn)' }} />Offline</>
              : <><span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-bright)' }} />LAN</>}
          </span>
          <span className="font-mono text-xs text-[var(--text-3)] tnum">{clock}</span>
          <button onClick={fetchOrders} aria-label="Refrescar" className="w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent-line)] hover:bg-[var(--raised)] text-[var(--text-2)] hover:text-[var(--text-1)] grid place-items-center transition-colors">
            <RefreshCw size={18} />
          </button>
          <button onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent-line)] text-[var(--text-2)] hover:text-[var(--text-1)] text-[12.5px] font-semibold transition-colors">
            <Settings size={16} />
            <span className="hidden sm:inline">Settings · alerta {alertMinutes} min</span>
          </button>
        </div>
      </header>

      {/* Offline banner */}
      {offline && (
        <div className="flex items-center gap-2.5 px-[18px] py-2.5 text-[13px] font-semibold text-[var(--warn-ink)] border-b flex-shrink-0" style={{ background: 'var(--warn-soft)', borderColor: 'color-mix(in srgb,var(--warn) 35%,transparent)' }}>
          <WifiOff size={17} className="text-[var(--warn)]" />
          Sin conexión — mostrando órdenes guardadas en este dispositivo. Se sincroniza al volver el internet.
        </div>
      )}

      {/* Station filter tabs */}
      <div className="flex items-center gap-2 flex-wrap px-[18px] py-[11px] bg-[var(--surface)] border-b border-[var(--line-soft)] flex-shrink-0">
        {([
          { key: 'cocina', label: 'Cocina', dot: 'var(--st-cocina)', onBg: 'var(--st-cocina)', onText: '#1a1206' },
          { key: 'panaderia', label: 'Panadería', dot: 'var(--st-pan)', onBg: 'var(--st-pan)', onText: '#1a1206' },
          { key: 'barra', label: 'Barra', dot: 'var(--st-barra)', onBg: 'var(--st-barra)', onText: '#0c0616' },
          { key: 'caja', label: 'Market', dot: 'var(--st-caja)', onBg: 'var(--st-caja)', onText: '#04140d' },
          { key: 'todo', label: 'Todo', dot: 'var(--accent)', onBg: 'var(--accent)', onText: '#04140d' },
        ] as const).map(tab => {
          const on = stationFilter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setStationFilter(tab.key)}
              className="inline-flex items-center gap-[7px] min-h-[38px] px-4 rounded-full text-[13px] font-bold transition-colors"
              style={on
                ? { background: tab.onBg, borderColor: tab.onBg, color: tab.onText, border: '1px solid' }
                : { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-3)' }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: on ? tab.onText : tab.dot }} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Batch counter — how many of each dish are pending */}
      {Object.keys(batchCounts).length > 0 && (
        <div className="flex items-center gap-[9px] flex-wrap px-[18px] py-2.5 bg-[var(--surface-2)] border-b border-[var(--line-soft)] flex-shrink-0 overflow-x-auto">
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--text-4)] mr-0.5">Pendientes</span>
          {Object.entries(batchCounts)
            .filter(([, v]) => v.total - v.listo > 0)
            .sort((a, b) => (b[1].total - b[1].listo) - (a[1].total - a[1].listo))
            .slice(0, 15)
            .map(([name, { total, listo }]) => (
            <span key={name} className="inline-flex items-center gap-2 px-[11px] py-1.5 rounded-[10px] bg-[var(--surface)] border border-[var(--line)] text-[13px] font-bold text-[var(--text-1)] whitespace-nowrap">
              {name.length > 18 ? name.slice(0, 18) + '…' : name}
              <span className={`font-mono text-[12.5px] tnum ${listo > 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--warn-ink)]'}`}>
                {listo}/{total}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="relative bg-[var(--panel)] border border-[var(--line)] rounded-[18px] w-full max-w-sm shadow-2xl mx-4 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-9 h-9 rounded-[10px] bg-[var(--accent-soft)] border border-[var(--accent-line)] grid place-items-center text-[var(--accent-ink)]"><Settings size={18} /></span>
              <h3 className="text-lg font-bold text-[var(--text-1)]">Settings KDS</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text-3)] block mb-2">Alerta de tiempo (minutos)</label>
                <input
                  type="number"
                  value={alertMinutes}
                  onChange={e => setAlertMinutes(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[11px] px-4 py-3 text-[var(--text-1)] text-center text-2xl font-bold tnum focus:outline-none focus:border-[var(--accent)]"
                  style={{ boxShadow: 'none' }}
                />
                <p className="text-xs text-[var(--text-4)] mt-1.5">Las órdenes se ponen en rojo después de {alertMinutes} minutos</p>
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} className="w-full mt-4 min-h-[48px] rounded-xl font-bold text-[#04140d]" style={{ background: 'linear-gradient(150deg,var(--accent-bright),var(--accent-deep))', boxShadow: '0 1px 0 rgba(255,255,255,.18) inset,0 10px 22px -8px var(--accent)' }}>
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-[18px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3.5">
            <div className="w-[26px] h-[26px] border-[2.5px] border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin" />
            <small className="text-[var(--text-3)] text-xs">Cargando órdenes…</small>
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2.5 text-center border border-dashed border-[var(--line)] rounded-[14px] bg-[var(--surface)] px-6 py-9 max-w-sm">
              <div className="text-[46px]" aria-hidden="true">👨‍🍳</div>
              <div className="text-[15px] font-bold text-[var(--text-1)]">Sin órdenes</div>
              <small className="text-[var(--text-3)] text-xs">Escuchando en red local · se actualiza cada 2 segundos</small>
            </div>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(268px,1fr))' }}>
            {sortedOrders.map(order => {
              const config = statusConfig[order.status] || statusConfig.enviada
              const elapsed = getElapsedMinutes(order.created_at)
              const isUrgent = elapsed >= alertMinutes && order.status !== 'lista'
              const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
              // Filter items by station — strict: each station only sees its own items
              const activeItems = items.filter(i => {
                if (i.cancelled) return false
                if (i.menuItemId === '__tiempo__') return stationFilter === 'todo'
                if (stationFilter === 'todo') return true
                const name = (i.nombre || i.name || '').toLowerCase()
                if (stationFilter === 'panaderia') return PANADERIA_KW.some(kw => name.includes(kw))
                return resolveItemStation(i) === stationFilter
              })

              // Skip orders with no items matching the filter
              if (activeItems.length === 0) return null

              // Filter out items marked as "listo" by the chef
              const visibleItems = activeItems.filter((_, idx) => {
                const globalIdx = items.indexOf(activeItems[idx])
                const key = `${order.id}-${globalIdx}`
                return itemStatus[key] !== 'listo'
              })
              // If all items are listo, skip rendering (auto-advance handled by effect below)
              if (visibleItems.length === 0 && activeItems.length > 0) {
                return null
              }

              const isOverAlert = elapsed >= alertMinutes && order.status !== 'lista'
              const entryTime = new Date(order.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

              // Card status skin: urgent overrides status color
              const cardTone = isOverAlert ? 'urgent' : order.status // enviada | preparando | lista | urgent
              const cardStyle: CSSProperties =
                cardTone === 'urgent' ? { background: 'var(--card)', borderColor: 'color-mix(in srgb,var(--crit) 60%,transparent)', boxShadow: 'var(--sh-mid),0 0 0 1px color-mix(in srgb,var(--crit) 30%,transparent)' } :
                cardTone === 'preparando' ? { background: 'var(--card)', borderColor: 'color-mix(in srgb,var(--warn) 42%,transparent)', boxShadow: 'var(--sh-mid)' } :
                cardTone === 'lista' ? { background: 'var(--card)', borderColor: 'var(--accent-line)', boxShadow: 'var(--sh-mid)' } :
                { background: 'var(--card)', borderColor: 'var(--line)', boxShadow: 'var(--sh-mid)' }
              const headStyle: CSSProperties =
                cardTone === 'urgent' ? { background: 'var(--crit-soft)' } :
                cardTone === 'preparando' ? { background: 'var(--warn-soft)' } :
                cardTone === 'lista' ? { background: 'var(--accent-soft)' } : {}
              // Status label chip
              const stLabel = isOverAlert ? config.label : config.label
              const stLabelStyle: CSSProperties =
                cardTone === 'urgent' ? { background: 'var(--crit)', color: '#fff' } :
                cardTone === 'preparando' ? { background: 'var(--warn)', color: '#1a1206' } :
                cardTone === 'lista' ? { background: 'var(--accent)', color: '#04140d' } :
                { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }
              // Timer chip tier: crit >= alert, warn >= 70% alert, else ok (preserves existing thresholds)
              const timerTier = isOverAlert ? 'crit' : (elapsed >= alertMinutes * 0.7 ? 'warn' : 'ok')
              const timerStyle: CSSProperties =
                timerTier === 'crit' ? { background: 'var(--crit-soft)', color: 'var(--crit-ink)', borderColor: 'color-mix(in srgb,var(--crit) 45%,transparent)' } :
                timerTier === 'warn' ? { background: 'var(--warn-soft)', color: 'var(--warn-ink)', borderColor: 'color-mix(in srgb,var(--warn) 40%,transparent)' } :
                { background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'var(--accent-line)' }
              // Progress: done items / active items (station-scoped)
              const doneCount = activeItems.filter(it => itemStatus[`${order.id}-${items.indexOf(it)}`] === 'listo').length
              const revision = (order as { order_revision?: number }).order_revision
              const showRevBadge = typeof revision === 'number' && revision >= 2

              return (
                <div key={order.id} className="rounded-[14px] border flex flex-col overflow-hidden" style={cardStyle}>
                  <div className="flex items-start justify-between gap-2.5 px-3.5 pt-3 pb-2.5 border-b border-[var(--line-soft)]" style={headStyle}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[44px] font-black leading-[0.9] tracking-[-0.03em] tnum text-[var(--text-1)]">{order.mesa}</span>
                      <div className="flex flex-col gap-1.5">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-extrabold tracking-[0.08em] px-2.5 py-[3px] rounded-full w-fit" style={stLabelStyle}>
                          {stLabel}
                          {showRevBadge && <span className="font-mono text-[10px] font-extrabold px-1.5 py-px rounded-md text-[var(--info-ink)]" style={{ background: 'var(--info-soft)', border: '1px solid color-mix(in srgb,var(--info) 35%,transparent)' }}>R{revision}</span>}
                        </span>
                        <span className="text-[12.5px] text-[var(--text-3)] font-medium">{order.mesero}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`inline-flex items-center gap-1.5 font-mono text-[17px] font-extrabold tnum px-2.5 py-[3px] rounded-[10px] border ${isOverAlert ? 'animate-pulse' : ''}`} style={timerStyle}>
                        {isOverAlert ? <Flame size={15} /> : <Clock size={14} />}
                        {elapsed}m
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-4)] tnum">{entryTime}</span>
                      {order.status !== 'enviada' && (
                        <span className="font-mono text-[11px] font-bold text-[var(--warn-ink)] tnum">{doneCount}/{activeItems.length}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5 px-2.5 py-2.5 flex-1">
                    {visibleItems.map((item, i) => {
                      const globalIdx = items.indexOf(item)
                      const key = `${order.id}-${globalIdx}`
                      const status = itemStatus[key]
                      return (
                      <div
                        key={i}
                        onClick={() => { if (!item.cancelled) handleItemClick(order.id, globalIdx, item.nombre || item.name || '') }}
                        className="flex items-start gap-2.5 cursor-pointer rounded-[10px] px-2 py-2 transition-colors"
                        style={status === 'preparando' ? { background: 'var(--warn-soft)' } : undefined}
                        onMouseEnter={e => { if (status !== 'preparando') (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                        onMouseLeave={e => { if (status !== 'preparando') (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <span
                          className="w-6 h-6 flex-none rounded-[7px] grid place-items-center mt-px transition-colors"
                          style={status === 'listo'
                            ? { background: 'var(--accent)', border: '2px solid var(--accent)', color: '#04140d' }
                            : { border: '2px solid var(--line)', color: 'transparent' }}
                        >
                          <Check size={14} strokeWidth={3} />
                        </span>
                        <span className="font-mono font-extrabold text-[15px] min-w-[30px] tnum mt-px" style={{ color: status === 'preparando' ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
                          {`${item.cantidad || item.quantity || 1}×`}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15.5px] font-bold leading-[1.15]" style={{ color: status === 'preparando' ? 'var(--warn-ink)' : 'var(--text-1)' }}>
                            {item.nombre || item.name}
                          </p>
                          {item.modificadores && item.modificadores.length > 0 && (
                            <div className="mt-0.5 text-[12.5px] font-semibold leading-[1.35] text-[var(--warn-ink)]">
                              {(typeof item.modificadores === 'string' ? (item.modificadores as string).split(/\s*·\s*/) : (item.modificadores as string[])).map((mod: string) => `· ${mod}`).join(' ')}
                            </div>
                          )}
                          {item.notas && (
                            <p className="text-[12.5px] italic mt-0.5 text-[var(--info-ink)]">{item.notas}</p>
                          )}
                          {status === 'preparando' && (
                            <p className="text-[var(--warn-ink)] text-[11px] mt-1 font-semibold">Preparando — toca para marcar listo</p>
                          )}
                        </div>
                      </div>
                      )
                    })}
                  </div>

                  {visibleItems.length > 0 && (
                    <div className="flex gap-2 px-3 py-2.5 border-t border-[var(--line-soft)]">
                      <button
                        onClick={() => advanceStatus(order.id, order.status, order.mesa, order.mesero)}
                        className="flex-1 inline-flex items-center justify-center gap-2 min-h-[56px] rounded-[14px] font-bold text-[15px] transition-[filter]"
                        style={
                          order.status === 'enviada'
                            ? { background: 'linear-gradient(150deg,#fbbf4d,var(--warn))', color: '#1a1206', boxShadow: '0 1px 0 rgba(255,255,255,.22) inset,0 10px 22px -9px var(--warn)' }
                            : order.status === 'lista'
                              ? { background: 'linear-gradient(150deg,var(--accent-deep),#047857)', color: '#eafff5' }
                              : { background: 'linear-gradient(150deg,var(--accent-bright),var(--accent-deep))', color: '#04140d', boxShadow: '0 1px 0 rgba(255,255,255,.18) inset,0 10px 22px -8px var(--accent)' }
                        }
                      >
                        {order.status === 'lista'
                          ? <><ChevronsDown size={18} strokeWidth={2.4} />BUMP</>
                          : <><Check size={18} strokeWidth={2.4} />{order.status === 'enviada' ? 'PREPARAR' : 'LISTA'}</>}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Recipe Detail Modal */}
      {(recipeDetail || loadingDetail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setRecipeDetail(null)} />
          <div className="relative bg-[var(--panel)] border border-[var(--accent-line)] rounded-[18px] w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl mx-4">
            {loadingDetail ? (
              <div className="p-12 text-center">
                <div className="w-[26px] h-[26px] border-[2.5px] border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin mx-auto" />
              </div>
            ) : recipeDetail ? (
              <>
                <div className="sticky top-0 bg-[var(--panel)] border-b border-[var(--line)] px-5 py-4 rounded-t-[18px] z-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-[var(--text-1)]">{recipeDetail.name}</h3>
                      {recipeDetail.category && <p className="text-[var(--accent-ink)] text-sm font-semibold">{recipeDetail.category}</p>}
                    </div>
                    <button onClick={() => setRecipeDetail(null)} className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent-line)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)]">
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {/* Info rápida */}
                  <div className="flex gap-3 flex-wrap">
                    {recipeDetail.prep_time && (
                      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-[10px] px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase font-mono tracking-wider">Prep</p>
                        <p className="text-[var(--text-1)] font-semibold text-sm">{recipeDetail.prep_time}</p>
                      </div>
                    )}
                    {recipeDetail.cook_time && (
                      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-[10px] px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase font-mono tracking-wider">Coccion</p>
                        <p className="text-[var(--text-1)] font-semibold text-sm">{recipeDetail.cook_time}</p>
                      </div>
                    )}
                    {recipeDetail.serving_temp && (
                      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-[10px] px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase font-mono tracking-wider">Temp</p>
                        <p className="text-[var(--text-1)] font-semibold text-sm">{recipeDetail.serving_temp}°</p>
                      </div>
                    )}
                    {recipeDetail.portion_size && (
                      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-[10px] px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase font-mono tracking-wider">Porcion</p>
                        <p className="text-[var(--text-1)] font-semibold text-sm">{recipeDetail.portion_size}</p>
                      </div>
                    )}
                  </div>

                  {/* Plato */}
                  {recipeDetail.plate && (
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--info-soft)', border: '1px solid color-mix(in srgb,var(--info) 35%,transparent)' }}>
                      <p className="text-[var(--info-ink)] text-xs font-semibold uppercase mb-1">Plato</p>
                      <p className="text-[var(--text-1)] text-sm">{recipeDetail.plate}</p>
                    </div>
                  )}

                  {/* Presentación */}
                  {recipeDetail.presentation && (
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
                      <p className="text-[var(--accent-ink)] text-xs font-semibold uppercase mb-1">Presentacion</p>
                      <p className="text-[var(--text-1)] text-sm whitespace-pre-wrap">{recipeDetail.presentation}</p>
                    </div>
                  )}

                  {/* Elaboración */}
                  {recipeDetail.elaboration && (
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--warn-soft)', border: '1px solid color-mix(in srgb,var(--warn) 40%,transparent)' }}>
                      <p className="text-[var(--warn-ink)] text-xs font-semibold uppercase mb-1">Elaboracion</p>
                      <p className="text-[var(--text-1)] text-sm whitespace-pre-wrap">{recipeDetail.elaboration}</p>
                    </div>
                  )}

                  {/* Equipo */}
                  {recipeDetail.equipment && (
                    <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3">
                      <p className="text-[var(--text-3)] text-xs font-semibold uppercase mb-1">Equipo</p>
                      <p className="text-[var(--text-1)] text-sm">{recipeDetail.equipment}</p>
                    </div>
                  )}

                  {/* Alérgenos */}
                  {recipeDetail.allergens && recipeDetail.allergens.length > 0 && (
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--crit-soft)', border: '1px solid color-mix(in srgb,var(--crit) 35%,transparent)' }}>
                      <p className="text-[var(--crit-ink)] text-xs font-semibold uppercase mb-2">Alergenos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(typeof recipeDetail.allergens === 'string' ? JSON.parse(recipeDetail.allergens) : recipeDetail.allergens).map((a: string, i: number) => (
                          <span key={i} className="text-[var(--crit-ink)] text-xs px-2 py-1 rounded-full" style={{ background: 'var(--crit-soft)', border: '1px solid color-mix(in srgb,var(--crit) 35%,transparent)' }}>{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-[var(--text-2)]">
                <p>Sin datos de presentacion para este platillo</p>
                <button onClick={() => setRecipeDetail(null)} className="mt-3 text-sm text-[var(--text-3)] underline">Cerrar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Item Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCancelTarget(null)} />
          <div className="relative bg-[var(--panel)] rounded-[18px] w-full max-w-md shadow-2xl mx-4 p-5" style={{ border: '1px solid color-mix(in srgb,var(--crit) 40%,transparent)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--crit-ink)]" style={{ background: 'var(--crit-soft)', border: '1px solid color-mix(in srgb,var(--crit) 40%,transparent)' }}>
                <ShieldAlert size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-1)]">Cancelar item</h3>
                <p className="text-[var(--crit-ink)] text-sm font-semibold">{cancelTarget.itemName} — Mesa {cancelTarget.mesa}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo</label>
                <div className="grid grid-cols-1 gap-2">
                  {CANCEL_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => { setCancelReason(r); setCancelError('') }}
                      className="px-3 py-2.5 rounded-[9px] text-[12.5px] text-left transition-colors"
                      style={cancelReason === r
                        ? { background: 'var(--crit-soft)', border: '1px solid color-mix(in srgb,var(--crit) 45%,transparent)', color: 'var(--crit-ink)', fontWeight: 650 }
                        : { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)' }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">PIN de gerente</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={cancelPin}
                  onChange={(e) => { setCancelPin(e.target.value.replace(/\D/g, '')); setCancelError('') }}
                  placeholder="••••"
                  className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[11px] px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-center text-2xl tracking-[0.5em] tnum focus:outline-none min-h-[48px]"
                  style={{ boxShadow: 'none' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--crit)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
                />
              </div>

              {cancelError && <p className="text-[var(--crit-ink)] text-sm text-center">{cancelError}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setCancelTarget(null)} className="flex-1 min-h-[48px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] hover:bg-[var(--raised)] text-[var(--text-2)] hover:text-[var(--text-1)] font-semibold">
                Volver
              </button>
              <button
                onClick={handleCancelItem}
                className="flex-[2] min-h-[48px] rounded-xl text-white font-semibold flex items-center justify-center gap-2"
                style={{ background: 'var(--crit)' }}
              >
                <Ban size={18} />
                Cancelar item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] inline-flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] px-5 py-3 rounded-xl shadow-2xl text-[12.5px] font-semibold">
          <span className="w-[7px] h-[7px] rounded-full" style={{ background: 'var(--accent)' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
