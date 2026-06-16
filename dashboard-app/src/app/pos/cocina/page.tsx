'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame, RefreshCw, Ban, ShieldAlert, X } from 'lucide-react'
import {
  getKitchenOrders, updateOrderStatus, logAudit, saveOrder,
  updateInventoryStock, logInventoryMovement, getInventory, getRecipes,
  getRecipeDetail,
  verifyManagerPin, RECIPE_ALIASES, formatMXN,
  type KitchenOrderFromDB, type RecipeDetail,
} from '@/lib/pos-data'
import { isBebida, POLL_INTERVAL_KITCHEN, getStationByName, type StationName } from '@/lib/pos-constants'

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

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

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

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
  const [stationFilter, setStationFilter] = useState<'todo' | StationName>('cocina')

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
          const platformBadge: Record<string, string> = { ubereats: '🟢 Uber', rappi: '🟠 Rappi', didi: '🔶 Didi' }
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
    if (prevOrderCountRef.current >= 0 && newEnviadas > prevOrderCountRef.current) {
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

    // 2. Update order items in Supabase
    await updateOrderStatus(cancelTarget.orderId, order.status, {
      items: JSON.stringify(items),
    })

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

    // Revert deductions (wrapped in try-catch so cancel still works if inventory fails)
    try {
      for (const row of recipeRows) {
        const qty = row.quantity * (items[cancelTarget.itemIndex].cantidad || items[cancelTarget.itemIndex].quantity || 1)
        const inv = invMap.get(row.ingredient_id)
        if (inv) {
          await updateInventoryStock(row.ingredient_id, inv.stock + qty)
          await logInventoryMovement({
            ingredient_id: row.ingredient_id,
            movement_type: 'adjustment',
            quantity: qty,
            order_id: cancelTarget.orderId,
            actor: manager,
            notes: `Cancelacion: ${cancelTarget.itemName} — ${cancelReason}`,
          })
        }
      }
    } catch { /* inventory reversal failed but cancellation still proceeds */ }

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

  const advanceStatus = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    let newStatus = ''
    if (currentStatus === 'enviada') newStatus = 'preparando'
    else if (currentStatus === 'preparando') newStatus = 'lista'
    else if (currentStatus === 'lista') newStatus = 'entregada'
    if (newStatus) {
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
  }

  const statusConfig: Record<string, { bg: string; border: string; badge: string; badgeText: string; label: string; nextLabel: string }> = {
    enviada: { bg: 'bg-[var(--surface-2)]', border: 'border-white/20', badge: 'bg-[var(--surface)]', badgeText: 'text-[var(--text-1)]', label: 'NUEVA', nextLabel: 'Preparando' },
    preparando: { bg: 'bg-amber-950/40', border: 'border-amber-500/40', badge: 'bg-amber-500', badgeText: 'text-black', label: 'PREPARANDO', nextLabel: 'Lista' },
    lista: { bg: 'bg-emerald-950/40', border: 'border-emerald-500/40', badge: 'bg-emerald-500', badgeText: 'text-black', label: 'LISTA', nextLabel: 'Entregada' },
  }

  // Production area classification for summary bar
  // isBebida imported from shared constants at top of file

  const AREA_KEYWORDS: Record<string, string[]> = {
    'Caliente': ['chilaquil', 'enchilada', 'huevo', 'egg', 'omelet', 'benedict', 'machacado', 'half & half', 'pancake', 'waffle', 'french toast', 'panini', 'pizza', 'pasta', 'combo amalay', 'combo fit', 'croque'],
    'Fría': ['bowl', 'acai', 'fruit', 'salad', 'ensalada', 'ceviche'],
    'Panadería': ['croissant', 'concha', 'bakery', 'panadería', 'postre', 'cheesecake', 'carrot cake', 'toast', 'bagel', 'galleta', 'brownie', 'crunchy'],
  }

  const AREA_COLORS: Record<string, string> = {
    'Caliente': 'bg-red-500',
    'Fría': 'bg-cyan-500',
    'Panadería': 'bg-orange-400',
  }

  const areaCounts = (() => {
    const counts: Record<string, number> = { 'Caliente': 0, 'Fría': 0, 'Panadería': 0 }
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
        if (!matched) counts['Caliente'] += qty // default to hot kitchen
      }
    }
    return counts
  })()

  const totalPendingItems = Object.values(areaCounts).reduce((a, b) => a + b, 0)

  const sortedOrders = [...orders].sort((a, b) => {
    const priority: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
    return (priority[a.status] || 3) - (priority[b.status] || 3)
  })

  if (!mounted) return null

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat size={24} className="text-emerald-400" />
            <h1 className="text-xl font-bold">Cocina</h1>
          </div>
          <button onClick={fetchOrders} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--surface)]" />
            <span className="text-sm text-[var(--text-4)]">Nuevas ({orders.filter(o => o.status === 'enviada').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm text-[var(--text-4)]">Preparando ({orders.filter(o => o.status === 'preparando').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-sm text-[var(--text-4)]">Listas ({orders.filter(o => o.status === 'lista').length})</span>
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {offline && (
        <div className="px-6 py-2 bg-amber-900/40 border-b border-amber-600/40 text-amber-300 text-sm font-medium flex-shrink-0">
          Sin conexión — mostrando órdenes guardadas en este dispositivo. Se sincroniza al volver el internet.
        </div>
      )}

      {/* Station filter tabs */}
      <div className="flex items-center gap-1 px-6 py-2 bg-[var(--surface-2)]/80 border-b border-slate-700/50 flex-shrink-0">
        {([
          { key: 'todo', label: 'Todo', color: 'bg-white text-black' },
          { key: 'cocina', label: 'Cocina', color: 'bg-amber-500 text-black' },
          { key: 'barra', label: 'Barra', color: 'bg-purple-500 text-white' },
          { key: 'caja', label: 'Market', color: 'bg-cyan-500 text-black' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setStationFilter(tab.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              stationFilter === tab.key
                ? tab.color
                : 'bg-[var(--line)]/60 text-[var(--text-3)] hover:bg-[var(--line)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Production area summary bar */}
      {totalPendingItems > 0 && (
        <div className="flex items-center gap-4 px-6 py-2.5 bg-[var(--surface-2)]/60 border-b border-slate-700/50 flex-shrink-0">
          {Object.entries(areaCounts).map(([area, count]) => (
            <div key={area} className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${AREA_COLORS[area]}`} />
              <span className="text-sm text-[var(--text-4)]">
                {area}: <span className={`font-bold ${count > 0 ? 'text-white' : 'text-[var(--text-2)]'}`}>{count}</span>
              </span>
            </div>
          ))}
          <div className="ml-auto text-xs text-[var(--text-2)]">
            {totalPendingItems} items pendientes
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <div className="text-center">
              <ChefHat size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">No hay órdenes pendientes</p>
              <p className="text-sm mt-1">Se actualiza cada 2 segundos</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedOrders.map(order => {
              const config = statusConfig[order.status] || statusConfig.enviada
              const elapsed = getElapsedMinutes(order.created_at)
              const isUrgent = elapsed > 15 && order.status !== 'lista'
              const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
              // Filter items based on station filter
              const activeItems = items.filter(i => {
                if (i.cancelled) return false
                // Skip tiempo separators — they belong to no station
                if (i.menuItemId === '__tiempo__') return stationFilter === 'todo'
                const name = i.nombre || i.name || ''
                if (stationFilter === 'todo') return true
                // Use saved station first, fallback to name-based detection
                const itemStation = i.station || getStationByName(name)
                return itemStation === stationFilter
              })

              // Skip orders with no items matching the filter
              if (activeItems.length === 0) return null

              return (
                <div key={order.id} className={`rounded-2xl border-2 p-5 flex flex-col ${config.bg} ${config.border}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-3xl font-black">{order.mesa}</span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${config.badge} ${config.badgeText}`}>
                          {config.label}
                        </span>
                      </div>
                      <p className="text-[var(--text-3)] text-sm">{order.mesero}</p>
                    </div>
                    <div className={`flex items-center gap-1 ${isUrgent ? 'text-red-400' : 'text-[var(--text-3)]'}`}>
                      {isUrgent ? <Flame size={16} /> : <Clock size={16} />}
                      <span className="text-sm font-mono font-semibold">{elapsed}m</span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-2 mb-4">
                    {items.map((item, i) => (
                      <div key={i} className={`flex items-start gap-2 ${item.cancelled ? 'opacity-40' : ''}`}>
                        <span className={`font-bold text-sm min-w-[24px] ${item.cancelled ? 'text-red-500' : 'text-emerald-400'}`}>
                          {item.cancelled ? '✕' : `${item.cantidad || item.quantity || 1}x`}
                        </span>
                        <div className="flex-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); if (!item.cancelled) showRecipeDetail(item.nombre || item.name || '') }}
                            className={`text-sm text-left ${item.cancelled ? 'line-through text-red-400' : 'text-white underline decoration-dotted underline-offset-2 hover:text-emerald-400'}`}
                          >{item.nombre || item.name}</button>
                          {item.cancelled && (
                            <p className="text-red-500 text-[10px]">Cancelado: {item.cancelReason} — {item.cancelledBy}</p>
                          )}
                          {!item.cancelled && item.modificadores && item.modificadores.length > 0 && (
                            <p className="text-[var(--text-2)] text-xs">{typeof item.modificadores === 'string' ? item.modificadores : item.modificadores.join(' · ')}</p>
                          )}
                          {!item.cancelled && item.notas && (
                            <p className="text-sky-400 text-xs italic">{item.notas}</p>
                          )}
                        </div>
                        {!item.cancelled && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancelTarget({ orderId: order.id, itemIndex: i, itemName: (item.nombre || item.name || ''), mesa: order.mesa, mesero: order.mesero }) }}
                            className="w-7 h-7 rounded-lg bg-red-900/30 hover:bg-red-800/50 text-red-400 flex items-center justify-center flex-shrink-0"
                            title="Cancelar item"
                          >
                            <Ban size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {activeItems.length > 0 && (
                    <button
                      onClick={() => advanceStatus(order.id, order.status, order.mesa, order.mesero)}
                      className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                        order.status === 'enviada' ? 'bg-amber-500 hover:bg-amber-400 text-black' :
                        order.status === 'preparando' ? 'bg-emerald-500 hover:bg-emerald-400 text-black' :
                        'bg-slate-600 hover:bg-[var(--surface-2)]0 text-white'
                      }`}
                    >
                      <Check size={18} />
                      {config.nextLabel}
                    </button>
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
          <div className="relative bg-[var(--surface-2)] border border-emerald-700/40 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl mx-4">
            {loadingDetail ? (
              <div className="p-12 text-center">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : recipeDetail ? (
              <>
                <div className="sticky top-0 bg-[var(--surface-2)] border-b border-slate-700 px-5 py-4 rounded-t-2xl z-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-white">{recipeDetail.name}</h3>
                      {recipeDetail.category && <p className="text-emerald-400 text-sm">{recipeDetail.category}</p>}
                    </div>
                    <button onClick={() => setRecipeDetail(null)} className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center text-[var(--text-4)]">
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {/* Info rápida */}
                  <div className="flex gap-3 flex-wrap">
                    {recipeDetail.prep_time && (
                      <div className="bg-[var(--line)]/60 rounded-lg px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase">Prep</p>
                        <p className="text-white font-semibold text-sm">{recipeDetail.prep_time}</p>
                      </div>
                    )}
                    {recipeDetail.cook_time && (
                      <div className="bg-[var(--line)]/60 rounded-lg px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase">Coccion</p>
                        <p className="text-white font-semibold text-sm">{recipeDetail.cook_time}</p>
                      </div>
                    )}
                    {recipeDetail.serving_temp && (
                      <div className="bg-[var(--line)]/60 rounded-lg px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase">Temp</p>
                        <p className="text-white font-semibold text-sm">{recipeDetail.serving_temp}°</p>
                      </div>
                    )}
                    {recipeDetail.portion_size && (
                      <div className="bg-[var(--line)]/60 rounded-lg px-3 py-2 text-center">
                        <p className="text-[var(--text-3)] text-[10px] uppercase">Porcion</p>
                        <p className="text-white font-semibold text-sm">{recipeDetail.portion_size}</p>
                      </div>
                    )}
                  </div>

                  {/* Plato */}
                  {recipeDetail.plate && (
                    <div className="bg-blue-900/30 border border-blue-700/40 rounded-xl px-4 py-3">
                      <p className="text-blue-400 text-xs font-semibold uppercase mb-1">Plato</p>
                      <p className="text-white text-sm">{recipeDetail.plate}</p>
                    </div>
                  )}

                  {/* Presentación */}
                  {recipeDetail.presentation && (
                    <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-xl px-4 py-3">
                      <p className="text-emerald-400 text-xs font-semibold uppercase mb-1">Presentacion</p>
                      <p className="text-white text-sm whitespace-pre-wrap">{recipeDetail.presentation}</p>
                    </div>
                  )}

                  {/* Elaboración */}
                  {recipeDetail.elaboration && (
                    <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl px-4 py-3">
                      <p className="text-amber-400 text-xs font-semibold uppercase mb-1">Elaboracion</p>
                      <p className="text-white text-sm whitespace-pre-wrap">{recipeDetail.elaboration}</p>
                    </div>
                  )}

                  {/* Equipo */}
                  {recipeDetail.equipment && (
                    <div className="bg-[var(--line)]/40 rounded-xl px-4 py-3">
                      <p className="text-[var(--text-3)] text-xs font-semibold uppercase mb-1">Equipo</p>
                      <p className="text-white text-sm">{recipeDetail.equipment}</p>
                    </div>
                  )}

                  {/* Alérgenos */}
                  {recipeDetail.allergens && recipeDetail.allergens.length > 0 && (
                    <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3">
                      <p className="text-red-400 text-xs font-semibold uppercase mb-2">Alergenos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(typeof recipeDetail.allergens === 'string' ? JSON.parse(recipeDetail.allergens) : recipeDetail.allergens).map((a: string, i: number) => (
                          <span key={i} className="bg-red-900/40 text-red-300 text-xs px-2 py-1 rounded-full">{a}</span>
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
          <div className="relative bg-[var(--surface-2)] border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-900/60 flex items-center justify-center">
                <ShieldAlert size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Cancelar item</h3>
                <p className="text-red-400 text-sm">{cancelTarget.itemName} — Mesa {cancelTarget.mesa}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo</label>
                <div className="grid grid-cols-1 gap-2">
                  {CANCEL_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => { setCancelReason(r); setCancelError('') }}
                      className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                        cancelReason === r
                          ? 'bg-red-900/40 border border-red-600 text-white'
                          : 'bg-[var(--line)]/50 border border-slate-600/50 text-[var(--text-4)] hover:bg-[var(--line)]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">PIN de gerente</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={cancelPin}
                  onChange={(e) => { setCancelPin(e.target.value.replace(/\D/g, '')); setCancelError('') }}
                  placeholder="****"
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
                />
              </div>

              {cancelError && <p className="text-red-400 text-sm text-center">{cancelError}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setCancelTarget(null)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-slate-600 text-[var(--text-4)] font-semibold">
                Volver
              </button>
              <button
                onClick={handleCancelItem}
                className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2"
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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
