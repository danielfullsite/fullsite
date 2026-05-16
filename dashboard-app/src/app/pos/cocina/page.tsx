'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame, RefreshCw, Ban, ShieldAlert, X } from 'lucide-react'
import {
  getKitchenOrders, updateOrderStatus, logAudit, saveOrder,
  updateInventoryStock, logInventoryMovement, getInventory, getRecipes,
  MANAGER_PINS, RECIPE_ALIASES, formatMXN,
  type KitchenOrderFromDB,
} from '@/lib/pos-data'

function getElapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

interface ParsedItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  modificadores?: string[]
  cancelled?: boolean
  cancelReason?: string
  cancelledBy?: string
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)

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

  const fetchOrders = async () => {
    const data = await getKitchenOrders()
    setOrders(data)
    setLoading(false)
  }

  useEffect(() => {
    setMounted(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, 2000)
    return () => clearInterval(interval)
  }, [])

  // Cancel an item from a sent order
  const handleCancelItem = async () => {
    if (!cancelTarget) return
    if (!cancelReason) { setCancelError('Selecciona un motivo'); return }
    if (!cancelPin) { setCancelError('Ingresa PIN de gerente'); return }
    const manager = MANAGER_PINS[cancelPin]
    if (!manager) { setCancelError('PIN invalido'); return }

    // 1. Get the order and mark item as cancelled
    const order = orders.find(o => o.id === cancelTarget.orderId)
    if (!order) return

    const items: ParsedItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
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

    // Revert deductions
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
      await updateOrderStatus(id, newStatus)
      logAudit({
        order_id: id, action: 'status_changed', actor: 'Cocina', mesa,
        details: { from: currentStatus, to: newStatus, mesero },
      })
      fetchOrders()
    }
  }

  const statusConfig: Record<string, { bg: string; border: string; badge: string; badgeText: string; label: string; nextLabel: string }> = {
    enviada: { bg: 'bg-slate-800', border: 'border-white/20', badge: 'bg-white', badgeText: 'text-slate-900', label: 'NUEVA', nextLabel: 'Preparando' },
    preparando: { bg: 'bg-amber-950/40', border: 'border-amber-500/40', badge: 'bg-amber-500', badgeText: 'text-black', label: 'PREPARANDO', nextLabel: 'Lista' },
    lista: { bg: 'bg-emerald-950/40', border: 'border-emerald-500/40', badge: 'bg-emerald-500', badgeText: 'text-black', label: 'LISTA', nextLabel: 'Entregada' },
  }

  const sortedOrders = [...orders].sort((a, b) => {
    const priority: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
    return (priority[a.status] || 3) - (priority[b.status] || 3)
  })

  if (!mounted) return null

  return (
    <div className="h-screen flex flex-col text-white bg-slate-900">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat size={24} className="text-emerald-400" />
            <h1 className="text-xl font-bold">Cocina</h1>
          </div>
          <button onClick={fetchOrders} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-white" />
            <span className="text-sm text-slate-300">Nuevas ({orders.filter(o => o.status === 'enviada').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm text-slate-300">Preparando ({orders.filter(o => o.status === 'preparando').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-sm text-slate-300">Listas ({orders.filter(o => o.status === 'lista').length})</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
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
              const activeItems = items.filter(i => !i.cancelled)

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
                      <p className="text-slate-400 text-sm">{order.mesero}</p>
                    </div>
                    <div className={`flex items-center gap-1 ${isUrgent ? 'text-red-400' : 'text-slate-400'}`}>
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
                          <span className={`text-sm ${item.cancelled ? 'line-through text-red-400' : 'text-white'}`}>{item.nombre || item.name}</span>
                          {item.cancelled && (
                            <p className="text-red-500 text-[10px]">Cancelado: {item.cancelReason} — {item.cancelledBy}</p>
                          )}
                          {!item.cancelled && item.modificadores && item.modificadores.length > 0 && (
                            <p className="text-slate-500 text-xs">{item.modificadores.join(' · ')}</p>
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
                        'bg-slate-600 hover:bg-slate-500 text-white'
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
      {/* Cancel Item Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCancelTarget(null)} />
          <div className="relative bg-slate-800 border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
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
                <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">Motivo</label>
                <div className="grid grid-cols-1 gap-2">
                  {CANCEL_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => { setCancelReason(r); setCancelError('') }}
                      className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                        cancelReason === r
                          ? 'bg-red-900/40 border border-red-600 text-white'
                          : 'bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">PIN de gerente</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={cancelPin}
                  onChange={(e) => { setCancelPin(e.target.value.replace(/\D/g, '')); setCancelError('') }}
                  placeholder="****"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
                />
              </div>

              {cancelError && <p className="text-red-400 text-sm text-center">{cancelError}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setCancelTarget(null)} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold">
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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-700 border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
