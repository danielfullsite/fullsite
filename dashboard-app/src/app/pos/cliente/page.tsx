'use client'

import { useState, useEffect } from 'react'
import { formatMXN, getClientId } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface OrderItem {
  nombre?: string
  name?: string
  cantidad?: number
  quantity?: number
  precio?: number
  price?: number
  subtotal?: number
  modificadores?: string[]
}

interface ActiveOrder {
  id: string
  mesa: number
  mesero: string
  personas: number
  subtotal: number
  iva: number
  total: number
  descuento: number
  items: string
  status: string
  created_at: string
}

export default function ClienteDisplay() {
  const [order, setOrder] = useState<ActiveOrder | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const fetchLatest = async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${getClientId()}&status=in.(enviada,preparando,lista,abierta)&order=created_at.desc&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
        )
        if (res.ok) {
          const rows = await res.json()
          setOrder(rows[0] || null)
        }
      } catch { /* */ }
    }

    fetchLatest()
    const interval = setInterval(fetchLatest, 3000)
    return () => clearInterval(interval)
  }, [])

  if (!mounted) return null

  const items: OrderItem[] = order
    ? (typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [])
    : []

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="text-center py-6 border-b border-slate-800">
        <span className="text-white font-black text-3xl tracking-tight">
          AMALAY
        </span>
        <p className="text-emerald-400 text-sm tracking-widest">COFFEE & MARKET</p>
        {order && (
          <p className="text-[var(--text-3)] text-lg mt-2">Mesa {order.mesa}</p>
        )}
      </header>

      {/* Order items */}
      <div className="flex-1 px-8 py-6">
        {!order || items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[var(--text-2)] text-2xl font-light">Bienvenido a AMALAY</p>
              <p className="text-[var(--text-1)] text-sm mt-2">Tu orden aparecerá aquí</p>
            </div>
          </div>
        ) : (
          <div className="max-w-lg mx-auto space-y-4">
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-800/50">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-400 font-bold text-lg">{item.cantidad || item.quantity || 1}x</span>
                    <span className="text-white text-lg">{item.nombre || item.name}</span>
                  </div>
                  {item.modificadores && item.modificadores.length > 0 && (
                    <p className="text-[var(--text-2)] text-sm ml-10">{item.modificadores.join(' · ')}</p>
                  )}
                </div>
                <span className="text-white font-semibold text-lg">
                  {formatMXN(item.subtotal || (item.precio || item.price || 0) * (item.cantidad || item.quantity || 1))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total */}
      {order && items.length > 0 && (
        <div className="border-t border-slate-800 px-8 py-6">
          <div className="max-w-lg mx-auto">
            {order.descuento > 0 && (
              <div className="flex justify-between text-red-400 mb-2">
                <span>Descuento</span>
                <span>-{formatMXN(order.descuento)}</span>
              </div>
            )}
            <div className="flex justify-between text-[var(--text-3)] mb-2">
              <span>Subtotal</span>
              <span>{formatMXN(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[var(--text-3)] mb-4">
              <span>IVA (16%)</span>
              <span>{formatMXN(order.iva)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-2xl font-bold">Total</span>
              <span className="text-3xl font-bold text-emerald-400">{formatMXN(order.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center py-4 border-t border-slate-900">
        <p className="text-[var(--text-1)] text-xs">Gracias por tu visita</p>
      </div>
    </div>
  )
}
