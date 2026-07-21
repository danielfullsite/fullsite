'use client'

import { useState, useEffect } from 'react'
import { Clock, ChefHat, AlertTriangle } from 'lucide-react'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


interface OrderTimer {
  id: string
  mesa: number
  mesero: string
  status: string
  created_at: string
  minutes: number
  itemCount: number
}

export default function KitchenTimer() {
  const [orders, setOrders] = useState<OrderTimer[]>([])
  const [avgTime, setAvgTime] = useState(0)
  const [, setTick] = useState(0)

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 10000)
    const ticker = setInterval(() => setTick(t => t + 1), 30000) // update minutes display
    return () => { clearInterval(interval); clearInterval(ticker) }
  }, [])

  async function fetchOrders() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?status=in.(enviada,preparando)&client_id=eq.${_cid()}&order=created_at.asc&limit=20`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      const now = Date.now()
      const timers: OrderTimer[] = data.map((o: { id: string; mesa: number; mesero: string; status: string; created_at: string; items: string }) => {
        const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || [])
        return {
          id: o.id,
          mesa: o.mesa,
          mesero: o.mesero,
          status: o.status,
          created_at: o.created_at,
          minutes: Math.floor((now - new Date(o.created_at).getTime()) / 60000),
          itemCount: items.filter((i: { cancelled?: boolean }) => !i.cancelled).length,
        }
      })
      setOrders(timers)

      // Calculate average prep time from recent completed orders
      const completedRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?status=eq.cerrada&client_id=eq.${_cid()}&order=closed_at.desc&limit=20&select=created_at,closed_at`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (completedRes.ok) {
        const completed = await completedRes.json()
        const times = completed
          .filter((o: { created_at: string; closed_at: string }) => o.created_at && o.closed_at)
          .map((o: { created_at: string; closed_at: string }) => (new Date(o.closed_at).getTime() - new Date(o.created_at).getTime()) / 60000)
          .filter((t: number) => t > 0 && t < 180) // exclude outliers
        if (times.length > 0) {
          setAvgTime(Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length))
        }
      }
    } catch { /* */ }
  }

  if (orders.length === 0) return null

  const urgent = orders.filter(o => o.minutes > 20)
  const slow = orders.filter(o => o.minutes > 15 && o.minutes <= 20)

  return (
    <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat size={16} className="text-amber-400" />
          <span className="text-sm font-bold text-[var(--text-1)]">Cocina en vivo</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {avgTime > 0 && (
            <span className="text-[var(--text-3)]">
              <Clock size={12} className="inline mr-1" />
              Promedio: {avgTime}m
            </span>
          )}
          {urgent.length > 0 && (
            <span className="text-red-400 font-bold animate-pulse">
              <AlertTriangle size={12} className="inline mr-1" />
              {urgent.length} urgente{urgent.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-2 space-y-1">
        {orders.slice(0, 6).map(o => (
          <div key={o.id} className="flex items-center gap-3 py-1.5">
            <span className={`text-lg font-black w-8 text-center ${
              o.minutes > 20 ? 'text-red-400' : o.minutes > 15 ? 'text-amber-400' : 'text-[var(--text-1)]'
            }`}>
              {o.mesa}
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  o.status === 'enviada' ? 'bg-white/10 text-white' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {o.status === 'enviada' ? 'NUEVA' : 'PREP'}
                </span>
                <span className="text-xs text-[var(--text-3)]">{o.itemCount} items</span>
              </div>
            </div>
            <span className={`text-sm font-mono font-bold ${
              o.minutes > 20 ? 'text-red-400 animate-pulse' : o.minutes > 15 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {o.minutes}m
            </span>
          </div>
        ))}
        {orders.length > 6 && (
          <p className="text-center text-xs text-[var(--text-3)]">+{orders.length - 6} más</p>
        )}
      </div>
    </div>
  )
}
