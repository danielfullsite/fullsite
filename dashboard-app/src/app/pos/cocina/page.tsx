'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame, RefreshCw } from 'lucide-react'
import { getKitchenOrders, updateOrderStatus } from '@/lib/pos-data'
import type { KitchenOrderFromDB } from '@/lib/pos-data'

interface KitchenItem {
  nombre: string
  cantidad: number
  modificadores?: string[]
  notas?: string
}

interface KitchenOrder {
  id: string
  mesa: number
  mesero: string
  items: KitchenItem[]
  status: 'enviada' | 'preparando' | 'lista'
  createdAt: Date
  notas: string | null
}

function parseDBOrder(row: KitchenOrderFromDB): KitchenOrder {
  let items: KitchenItem[] = []
  try {
    const parsed = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
    items = (parsed as Array<Record<string, unknown>>).map((i) => ({
      nombre: (i.nombre as string) || (i.name as string) || '',
      cantidad: (i.cantidad as number) || (i.quantity as number) || 1,
      modificadores: (i.modificadores as string[]) || [],
      notas: (i.notas as string) || '',
    }))
  } catch {
    // items stays empty
  }
  return {
    id: row.id,
    mesa: row.mesa,
    mesero: row.mesero,
    items,
    status: row.status as KitchenOrder['status'],
    createdAt: new Date(row.created_at),
    notas: row.notas,
  }
}

function getElapsedMinutes(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 60000)
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)

  const fetchOrders = useCallback(async () => {
    const rows = await getKitchenOrders()
    setOrders(rows.map(parseDBOrder))
    setLoading(false)
  }, [])

  // Initial load + poll every 5 seconds
  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 5000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  // Update elapsed times every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const advanceStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'enviada' ? 'preparando' : 'lista'
    // Optimistic update
    setOrders((prev) =>
      prev.map((order) =>
        order.id === id ? { ...order, status: nextStatus as KitchenOrder['status'] } : order
      )
    )
    await updateOrderStatus(id, nextStatus)
  }

  const dismissOrder = async (id: string) => {
    // Mark as entregada (effectively removes from kitchen view)
    setOrders((prev) => prev.filter((o) => o.id !== id))
    await updateOrderStatus(id, 'entregada')
  }

  const statusConfig: Record<
    string,
    { bg: string; border: string; badge: string; badgeText: string; label: string }
  > = {
    enviada: {
      bg: 'bg-slate-800',
      border: 'border-white/20',
      badge: 'bg-white',
      badgeText: 'text-slate-900',
      label: 'NUEVA',
    },
    preparando: {
      bg: 'bg-amber-950/40',
      border: 'border-amber-500/40',
      badge: 'bg-amber-500',
      badgeText: 'text-black',
      label: 'PREPARANDO',
    },
    lista: {
      bg: 'bg-emerald-950/40',
      border: 'border-emerald-500/40',
      badge: 'bg-emerald-500',
      badgeText: 'text-black',
      label: 'LISTA',
    },
  }

  // Sort: enviada first, then preparando, then lista
  const sortedOrders = [...orders].sort((a, b) => {
    const priority: Record<string, number> = { enviada: 0, preparando: 1, lista: 2 }
    return (priority[a.status] ?? 3) - (priority[b.status] ?? 3)
  })

  return (
    <div className="h-screen flex flex-col text-white">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/pos"
            className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat size={24} className="text-emerald-400" />
            <h1 className="text-xl font-bold">Cocina</h1>
          </div>
          <button
            onClick={() => fetchOrders()}
            className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors text-slate-300"
            title="Refrescar"
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-white" />
            <span className="text-sm text-slate-300">
              Nuevas ({orders.filter((o) => o.status === 'enviada').length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm text-slate-300">
              Preparando ({orders.filter((o) => o.status === 'preparando').length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-sm text-slate-300">
              Listas ({orders.filter((o) => o.status === 'lista').length})
            </span>
          </div>
        </div>
      </header>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center">
              <ChefHat size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">No hay ordenes pendientes</p>
              <p className="text-sm mt-2">Se actualiza cada 5 segundos</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedOrders.map((order) => {
              const config = statusConfig[order.status] ?? statusConfig.enviada
              const elapsed = getElapsedMinutes(order.createdAt)
              const isUrgent = elapsed > 15 && order.status !== 'lista'

              return (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 p-5 flex flex-col ${config.bg} ${config.border} ${
                    isUrgent ? 'animate-pulse' : ''
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-3xl font-black">
                          {order.mesa}
                        </span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${config.badge} ${config.badgeText}`}
                        >
                          {config.label}
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm">{order.mesero}</p>
                    </div>
                    <div
                      className={`flex items-center gap-1 ${
                        isUrgent ? 'text-red-400' : 'text-slate-400'
                      }`}
                    >
                      {isUrgent ? <Flame size={16} /> : <Clock size={16} />}
                      <span className="text-sm font-mono font-semibold">
                        {elapsed}m
                      </span>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="flex-1 space-y-2 mb-4">
                    {order.items.map((item, i) => (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-emerald-400 w-6">
                            {item.cantidad}x
                          </span>
                          <span className="text-[16px] font-medium">
                            {item.nombre}
                          </span>
                        </div>
                        {item.modificadores && item.modificadores.length > 0 && (
                          <p className="text-slate-400 text-xs ml-8">
                            {item.modificadores.join(' · ')}
                          </p>
                        )}
                        {item.notas && (
                          <p className="text-slate-500 text-xs italic ml-8">
                            {item.notas}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Order notes */}
                  {order.notas && (
                    <p className="text-amber-400/80 text-xs italic mb-3 border-t border-slate-700 pt-2">
                      Nota: {order.notas}
                    </p>
                  )}

                  {/* Action button */}
                  {order.status === 'enviada' && (
                    <button
                      onClick={() => advanceStatus(order.id, order.status)}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px] flex items-center justify-center gap-2"
                    >
                      <Flame size={20} />
                      Preparando
                    </button>
                  )}
                  {order.status === 'preparando' && (
                    <button
                      onClick={() => advanceStatus(order.id, order.status)}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px] flex items-center justify-center gap-2"
                    >
                      <Check size={20} />
                      Lista
                    </button>
                  )}
                  {order.status === 'lista' && (
                    <button
                      onClick={() => dismissOrder(order.id)}
                      className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px] flex items-center justify-center gap-2"
                    >
                      <Check size={20} />
                      Entregada
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
