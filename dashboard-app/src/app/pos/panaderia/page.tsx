'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, Check, Flame, RefreshCw, CakeSlice } from 'lucide-react'
import { getKitchenOrders, updateOrderStatus, logAudit, type KitchenOrderFromDB } from '@/lib/pos-data'
import { POLL_INTERVAL_KITCHEN, getStationByName } from '@/lib/pos-constants'

function getElapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

interface PanItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  modificadores?: string[]
  notas?: string
  cancelled?: boolean
  station?: string
}

export default function PanaderiaPage() {
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const prevCountRef = useRef(0)

  const playSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3
      osc.start(); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
      osc.stop(ctx.currentTime + 0.3)
    } catch { /* */ }
  }

  const fetchOrders = async () => {
    try {
      const allOrders = await getKitchenOrders()
      const newEnviadas = allOrders.filter(o => o.status === 'enviada').length
      if (prevCountRef.current > 0 && newEnviadas > prevCountRef.current) playSound()
      prevCountRef.current = newEnviadas
      setOrders(allOrders)
    } catch { /* */ } finally {
      setLoading(false)
      setOffline(typeof navigator !== 'undefined' && !navigator.onLine)
    }
  }

  useEffect(() => {
    setMounted(true)
    fetchOrders()
    const interval = setInterval(fetchOrders, POLL_INTERVAL_KITCHEN)
    return () => clearInterval(interval)
  }, [])

  const advanceStatus = async (id: string, currentStatus: string, mesa: number, mesero: string) => {
    let newStatus = ''
    if (currentStatus === 'enviada') newStatus = 'preparando'
    else if (currentStatus === 'preparando') newStatus = 'lista'
    else if (currentStatus === 'lista') newStatus = 'entregada'
    if (newStatus) {
      await updateOrderStatus(id, newStatus)
      logAudit({
        order_id: id, action: 'status_changed', actor: 'Panaderia', mesa,
        details: { from: currentStatus, to: newStatus, mesero },
      })
      fetchOrders()
    }
  }

  const statusConfig: Record<string, { bg: string; border: string; badge: string; badgeText: string; label: string; nextLabel: string }> = {
    enviada: { bg: 'bg-[var(--surface-2)]', border: 'border-white/20', badge: 'bg-[var(--surface)]', badgeText: 'text-[var(--text-1)]', label: 'NUEVA', nextLabel: 'Preparando' },
    preparando: { bg: 'bg-amber-950/40', border: 'border-amber-500/40', badge: 'bg-amber-500', badgeText: 'text-black', label: 'PREPARANDO', nextLabel: 'Lista' },
    lista: { bg: 'bg-emerald-950/40', border: 'border-emerald-500/40', badge: 'bg-emerald-500', badgeText: 'text-black', label: 'LISTA', nextLabel: 'Entregada' },
  }

  // Filter to only panadería/caja items
  const isPanaderiaItem = (item: PanItem): boolean => {
    if (item.cancelled) return false
    const station = item.station || getStationByName(item.nombre || item.name || '')
    return station === 'caja'
  }

  const filteredOrders = orders.filter(order => {
    const items: PanItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
    return items.some(isPanaderiaItem)
  })

  const sortedOrders = [...filteredOrders].sort((a, b) => {
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
            <CakeSlice size={24} className="text-amber-400" />
            <h1 className="text-xl font-bold">Panaderia</h1>
          </div>
          <button onClick={fetchOrders} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--surface)]" />
            <span className="text-sm text-[var(--text-4)]">Nuevas ({filteredOrders.filter(o => o.status === 'enviada').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm text-[var(--text-4)]">Preparando ({filteredOrders.filter(o => o.status === 'preparando').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-sm text-[var(--text-4)]">Listas ({filteredOrders.filter(o => o.status === 'lista').length})</span>
          </div>
        </div>
      </header>

      {offline && (
        <div className="px-6 py-2 bg-amber-900/40 border-b border-amber-600/40 text-amber-300 text-sm font-medium flex-shrink-0">
          Sin conexion — mostrando ordenes guardadas en este dispositivo.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <div className="text-center">
              <CakeSlice size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">No hay pedidos de panaderia</p>
              <p className="text-sm mt-1">Se actualiza cada 2 segundos</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedOrders.map(order => {
              const config = statusConfig[order.status] || statusConfig.enviada
              const elapsed = getElapsedMinutes(order.created_at)
              const isUrgent = elapsed > 10 && order.status !== 'lista'
              const allItems: PanItem[] = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
              const panItems = allItems.filter(isPanaderiaItem)

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
                    {panItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-amber-400 font-bold text-sm min-w-[24px]">
                          {item.cantidad || item.quantity || 1}x
                        </span>
                        <div>
                          <span className="text-white text-sm">{item.nombre || item.name}</span>
                          {item.modificadores && item.modificadores.length > 0 && (
                            <p className="text-[var(--text-2)] text-xs">{item.modificadores.join(' · ')}</p>
                          )}
                          {item.notas && (
                            <p className="text-sky-400 text-xs italic">{item.notas}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

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
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
