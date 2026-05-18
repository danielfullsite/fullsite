'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users, Calendar, RefreshCw } from 'lucide-react'
import { MESAS_CONFIG, formatMXN } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Reserva {
  codigo_reserva: string
  nombre: string
  guests: number
  horario_inicio: string
  espacio: string
  status: string
}

interface ActiveOrder {
  mesa: number
  mesero: string
  personas: number
  total: number
  status: string
  created_at: string
}

export default function MesasPage() {
  const router = useRouter()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      // Fetch active orders (not closed/cancelled)
      const ordersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?status=in.(enviada,preparando,lista,abierta)&order=created_at.desc&limit=50`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
      )
      const orders: ActiveOrder[] = ordersRes.ok ? await ordersRes.json() : []
      setActiveOrders(orders)

      // Fetch today's reservations
      const today = new Date().toISOString().split('T')[0]
      const resRes = await fetch(
        `${SUPABASE_URL}/rest/v1/amalay_reservaciones?fecha=eq.${today}&status=neq.cancelled&order=horario_inicio.asc&select=codigo_reserva,nombre,guests,horario_inicio,espacio,status`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const res: Reserva[] = resRes.ok ? await resRes.json() : []
      setReservas(res)
    } catch { /* */ }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  // Build mesa states from active orders
  const ordersByMesa = new Map<number, ActiveOrder>()
  for (const order of activeOrders) {
    // Keep the most recent order per mesa
    if (!ordersByMesa.has(order.mesa)) {
      ordersByMesa.set(order.mesa, order)
    }
  }

  const mesas: Mesa[] = MESAS_CONFIG.map(m => {
    const order = ordersByMesa.get(m.number)
    if (order) {
      return {
        ...m,
        status: order.status === 'lista' ? 'cuenta' as const : 'ocupada' as const,
        mesero: order.mesero,
        personas: order.personas,
        total: order.total,
      }
    }
    return m
  })

  const statusColor: Record<string, string> = {
    disponible: 'bg-emerald-900/50 border-emerald-600 hover:bg-emerald-800/60',
    ocupada: 'bg-blue-900/50 border-blue-600 hover:bg-blue-800/60',
    cuenta: 'bg-amber-900/50 border-amber-600 hover:bg-amber-800/60',
  }

  const statusLabel: Record<string, string> = {
    disponible: 'Disponible',
    ocupada: 'Ocupada',
    cuenta: 'Lista',
  }

  const statusDot: Record<string, string> = {
    disponible: 'bg-emerald-400',
    ocupada: 'bg-blue-400',
    cuenta: 'bg-amber-400',
  }

  const counts = {
    disponible: mesas.filter(m => m.status === 'disponible').length,
    ocupada: mesas.filter(m => m.status === 'ocupada').length,
    cuenta: mesas.filter(m => m.status === 'cuenta').length,
  }

  return (
    <div className="h-screen flex flex-col text-white">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Mesas</h1>
            <p className="text-slate-400 text-sm">En tiempo real · {activeOrders.length} ordenes activas</p>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-6">
          {Object.entries(counts).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${statusDot[status]}`} />
              <span className="text-sm text-slate-300">
                {statusLabel[status]} <span className="text-slate-500">({count})</span>
              </span>
            </div>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
              {mesas.map(mesa => (
                <button
                  key={mesa.number}
                  onClick={() => router.push(`/pos?mesa=${mesa.number}`)}
                  className={`rounded-2xl border-2 p-5 transition-all active:scale-95 min-h-[160px] flex flex-col justify-between ${statusColor[mesa.status]}`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-3xl font-bold">{mesa.number}</span>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      mesa.status === 'disponible' ? 'bg-emerald-600/30 text-emerald-300' :
                      mesa.status === 'ocupada' ? 'bg-blue-600/30 text-blue-300' :
                      'bg-amber-600/30 text-amber-300'
                    }`}>
                      {statusLabel[mesa.status]}
                    </span>
                  </div>
                  <div className="mt-3">
                    {mesa.status !== 'disponible' ? (
                      <>
                        <p className="text-slate-300 text-sm truncate">{mesa.mesero}</p>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1 text-slate-400 text-sm">
                            <Users size={14} />
                            <span>{mesa.personas}</span>
                          </div>
                          {mesa.total != null && (
                            <span className="text-white font-semibold">{formatMXN(mesa.total)}</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-slate-500 text-sm">{mesa.capacity} lugares</p>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Reservaciones de hoy */}
            {reservas.length > 0 && (
              <div className="max-w-5xl mx-auto mt-6">
                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                  <Calendar size={18} className="text-amber-400" />
                  Reservaciones hoy ({reservas.length})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {reservas.map(r => (
                    <div key={r.codigo_reserva} className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-amber-400 font-bold text-sm">{r.horario_inicio?.slice(0, 5)}</span>
                        <span className="text-amber-400/60 text-xs">{r.codigo_reserva}</span>
                      </div>
                      <p className="text-white font-medium">{r.nombre}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-slate-400 text-sm flex items-center gap-1"><Users size={12} /> {r.guests} personas</span>
                        <span className="text-slate-500 text-xs">{r.espacio}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
