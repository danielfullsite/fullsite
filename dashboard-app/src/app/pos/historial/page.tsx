'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, RefreshCw, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { formatMXN } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface OrderFromDB {
  id: string
  mesa: number
  mesero: string
  personas: number
  status: string
  subtotal: number
  iva: number
  total: number
  descuento: number
  metodo_pago: string | null
  items: string
  notas: string | null
  created_at: string
  closed_at: string | null
}

export default function HistorialPage() {
  const [orders, setOrders] = useState<OrderFromDB[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchOrders = async () => {
    setLoading(true)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_orders?created_at=gte.${selectedDate}T00:00:00&created_at=lte.${selectedDate}T23:59:59&order=created_at.desc&limit=200`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const raw: OrderFromDB[] = await res.json()
      // Deduplicate by mesa+mesero+items+created_at (same order sent twice)
      const seen = new Set<string>()
      const deduped = raw.filter(o => {
        const key = `${o.mesa}-${o.mesero}-${o.items}-${o.created_at.slice(0, 16)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setOrders(deduped)
    }
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [selectedDate])

  const filtered = orders.filter(o => {
    if (filterStatus !== 'all' && o.status !== filterStatus) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      if (!o.mesero.toLowerCase().includes(term) && !o.id.toLowerCase().includes(term) && !String(o.mesa).includes(term)) return false
    }
    return true
  })

  const statusConfig: Record<string, { color: string; label: string }> = {
    abierta: { color: 'text-[var(--text-3)]', label: 'Abierta' },
    enviada: { color: 'text-blue-400', label: 'Enviada' },
    preparando: { color: 'text-amber-400', label: 'Preparando' },
    lista: { color: 'text-emerald-400', label: 'Lista' },
    cerrada: { color: 'text-emerald-400', label: 'Cerrada' },
    cancelada: { color: 'text-red-400', label: 'Cancelada' },
  }

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <FileText size={24} className="text-[var(--text-3)]" />
            <h1 className="text-xl font-bold">Historial de ordenes</h1>
          </div>
          <button onClick={fetchOrders} className="w-8 h-8 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <span className="text-[var(--text-3)] text-sm">{filtered.length} ordenes</span>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 bg-[var(--surface-2)]/50 border-b border-slate-700">
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
          className="bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-white text-sm" />
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar mesero, mesa, orden..."
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-white text-sm">
          <option value="all">Todos</option>
          <option value="cerrada">Cerradas</option>
          <option value="cancelada">Canceladas</option>
          <option value="enviada">Enviadas</option>
        </select>
      </div>

      {/* Orders list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <p>Sin ordenes para esta fecha</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map(order => {
              const config = statusConfig[order.status] || statusConfig.abierta
              const isOpen = expanded === order.id
              const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])

              return (
                <div key={order.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                    className="w-full flex items-center gap-4 px-6 py-3 hover:bg-[var(--surface-2)]/50 text-left"
                  >
                    <div className="w-7 h-7 rounded bg-[var(--line)] flex items-center justify-center flex-shrink-0">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">Mesa {order.mesa}</span>
                        <span className="text-[var(--text-2)] text-xs">{order.mesero}</span>
                        <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
                      </div>
                      <p className="text-[var(--text-2)] text-xs">
                        {new Date(order.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        {order.metodo_pago && ` · ${order.metodo_pago}`}
                        {order.personas > 0 && ` · ${order.personas} personas`}
                      </p>
                    </div>
                    <span className="text-white font-semibold">{formatMXN(order.total)}</span>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-3">
                      <div className="bg-[var(--surface-2)]/60 rounded-xl p-4 ml-11">
                        <div className="space-y-1.5 mb-3">
                          {items.map((item: { nombre?: string; name?: string; cantidad?: number; quantity?: number; subtotal?: number; modificadores?: string[] }, i: number) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-[var(--text-4)]">
                                {item.cantidad || item.quantity || 1}x {item.nombre || item.name}
                                {item.modificadores && item.modificadores.length > 0 && (
                                  <span className="text-[var(--text-2)] text-xs ml-1">({item.modificadores.join(', ')})</span>
                                )}
                              </span>
                              <span className="text-[var(--text-3)]">{formatMXN(item.subtotal || 0)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-slate-700 pt-2 text-xs text-[var(--text-2)] flex gap-4">
                          <span>Sub: {formatMXN(order.subtotal)}</span>
                          <span>IVA: {formatMXN(order.iva)}</span>
                          {order.descuento > 0 && <span className="text-red-400">Desc: -{formatMXN(order.descuento)}</span>}
                          <span>ID: {order.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>
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
