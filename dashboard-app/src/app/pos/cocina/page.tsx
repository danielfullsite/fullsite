'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, ChefHat, Check, Flame } from 'lucide-react'

interface KitchenItem {
  name: string
  quantity: number
  modifiers?: string
}

interface KitchenOrder {
  id: string
  mesa: number
  mesero: string
  items: KitchenItem[]
  status: 'nueva' | 'preparando' | 'lista'
  createdAt: Date
}

// Demo kitchen orders
const DEMO_ORDERS: KitchenOrder[] = [
  {
    id: 'k1',
    mesa: 7,
    mesero: 'Daniela Rico',
    items: [
      { name: 'Chilaquiles', quantity: 2 },
      { name: 'Avocado Toast', quantity: 1 },
      { name: 'Cafe Americano', quantity: 3 },
      { name: 'Jugo de Naranja', quantity: 2 },
    ],
    status: 'nueva',
    createdAt: new Date(Date.now() - 2 * 60000),
  },
  {
    id: 'k2',
    mesa: 5,
    mesero: 'Brayan Berlanga',
    items: [
      { name: 'Half & Half', quantity: 1 },
      { name: 'Cafe Latte', quantity: 2 },
    ],
    status: 'preparando',
    createdAt: new Date(Date.now() - 8 * 60000),
  },
  {
    id: 'k3',
    mesa: 2,
    mesero: 'Omar Aguilera',
    items: [
      { name: 'Enchiladas Suizas', quantity: 1 },
      { name: 'Salmon Bagel', quantity: 1 },
      { name: 'Capuchino', quantity: 2 },
    ],
    status: 'preparando',
    createdAt: new Date(Date.now() - 12 * 60000),
  },
  {
    id: 'k4',
    mesa: 9,
    mesero: 'Hector Rodriguez',
    items: [
      { name: 'French Toast', quantity: 2 },
      { name: 'Pancakes', quantity: 1 },
      { name: 'Chai Latte', quantity: 3 },
    ],
    status: 'lista',
    createdAt: new Date(Date.now() - 18 * 60000),
  },
  {
    id: 'k5',
    mesa: 12,
    mesero: 'Oscar Rios',
    items: [
      { name: 'Miss Benedict', quantity: 2 },
      { name: 'Cheesecake', quantity: 1 },
      { name: 'Frappe Mokka', quantity: 2 },
    ],
    status: 'nueva',
    createdAt: new Date(Date.now() - 1 * 60000),
  },
]

function getElapsedMinutes(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 60000)
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [mounted, setMounted] = useState(false)
  const [, setTick] = useState(0)

  // Only render dynamic content after mount (fixes hydration mismatch)
  useEffect(() => {
    setOrders(DEMO_ORDERS)
    setMounted(true)
  }, [])

  // Update elapsed times every 10s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  const advanceStatus = (id: string) => {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== id) return order
        if (order.status === 'nueva') return { ...order, status: 'preparando' }
        if (order.status === 'preparando') return { ...order, status: 'lista' }
        return order
      })
    )
  }

  const dismissOrder = (id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id))
  }

  const statusConfig: Record<
    string,
    { bg: string; border: string; badge: string; badgeText: string; label: string }
  > = {
    nueva: {
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

  // Sort: nueva first, then preparando, then lista
  const sortedOrders = [...orders].sort((a, b) => {
    const priority = { nueva: 0, preparando: 1, lista: 2 }
    return priority[a.status] - priority[b.status]
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
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-white" />
            <span className="text-sm text-slate-300">
              Nuevas ({orders.filter((o) => o.status === 'nueva').length})
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
        {sortedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center">
              <ChefHat size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">No hay ordenes pendientes</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedOrders.map((order) => {
              const config = statusConfig[order.status]
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
                      <div
                        key={i}
                        className="flex items-center gap-2"
                      >
                        <span className="text-lg font-bold text-emerald-400 w-6">
                          {item.quantity}x
                        </span>
                        <span className="text-[16px] font-medium">
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Action button */}
                  {order.status === 'nueva' && (
                    <button
                      onClick={() => advanceStatus(order.id)}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px] flex items-center justify-center gap-2"
                    >
                      <Flame size={20} />
                      Preparando
                    </button>
                  )}
                  {order.status === 'preparando' && (
                    <button
                      onClick={() => advanceStatus(order.id)}
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
