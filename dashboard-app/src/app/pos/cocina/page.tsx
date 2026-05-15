'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame, RefreshCw } from 'lucide-react'
import { getKitchenOrders, updateOrderStatus, type KitchenOrderFromDB } from '@/lib/pos-data'

function getElapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)

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

  const advanceStatus = async (id: string, currentStatus: string) => {
    let newStatus = ''
    if (currentStatus === 'enviada') newStatus = 'preparando'
    else if (currentStatus === 'preparando') newStatus = 'lista'
    else if (currentStatus === 'lista') newStatus = 'entregada'
    if (newStatus) {
      await updateOrderStatus(id, newStatus)
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
              const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])

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
                    {items.map((item: { nombre?: string; name?: string; cantidad?: number; quantity?: number; modificadores?: string[] }, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold text-sm min-w-[24px]">
                          {item.cantidad || item.quantity || 1}x
                        </span>
                        <div>
                          <span className="text-white text-sm">{item.nombre || item.name}</span>
                          {item.modificadores && item.modificadores.length > 0 && (
                            <p className="text-slate-500 text-xs">{item.modificadores.join(' · ')}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => advanceStatus(order.id, order.status)}
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                      order.status === 'enviada' ? 'bg-amber-500 hover:bg-amber-400 text-black' :
                      order.status === 'preparando' ? 'bg-emerald-500 hover:bg-emerald-400 text-black' :
                      'bg-slate-600 hover:bg-slate-500 text-white'
                    }`}
                  >
                    <Check size={18} />
                    {config.nextLabel}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
