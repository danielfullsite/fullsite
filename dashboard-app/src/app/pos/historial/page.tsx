'use client'

// Migración visual a las primitivas del rediseño V2 (fase 2).
//
// La consulta con ventana en la zona del restaurante, la deduplicación, el
// respaldo offline desde IndexedDB, los tres filtros, el desplegable por orden,
// el desglose de totales y la reimpresión quedan IDÉNTICOS. Lo único que cambia
// son las clases: de Tailwind suelto (`bg-slate-*`, `text-emerald-400`) a los
// tonos y primitivas del sistema.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, RefreshCw, FileText, ChevronDown, ChevronRight, Printer } from 'lucide-react'
import { formatMXN, getClientId } from '@/lib/pos-data'
import { printTicketCSS } from '@/lib/printer'
import { todayMX, zonedStartOfDayISO } from '@/lib/date-mx'
import { List, Row, RowText, Tag, Pill, type DataTone } from '@/components/pos/ui/PosKit'

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
  // Era `new Date().toISOString().split('T')[0]`: la fecha en UTC, sin siquiera
  // intentar la zona del restaurante. Después de las 18:00 en Monterrey ya es el día
  // siguiente en UTC, así que el historial abría en MAÑANA — vacío — justo a la hora
  // de la cena. `todayMX()` formatea en la zona del tenant.
  const [selectedDate, setSelectedDate] = useState(() => todayMX())
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchOrders = async () => {
    setLoading(true)
    try {
      // La ventana se arma en la zona del restaurante. Con `${fecha}T00:00:00` desnudo,
      // Postgres (que corre en UTC) devolvía del día anterior a las 18:00 hasta las
      // 17:59 del día pedido: se perdía la cena del día y se colaba la de ayer.
      const desde = zonedStartOfDayISO(selectedDate)
      const [y, m, d] = selectedDate.split('-').map(Number)
      const hasta = zonedStartOfDayISO(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().split('T')[0])
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${getClientId()}` +
        `&created_at=gte.${encodeURIComponent(desde)}&created_at=lt.${encodeURIComponent(hasta)}` +
        `&order=created_at.desc&limit=200`,
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
    } catch {
      // Offline — muestra las órdenes cacheadas (sin filtro de fecha) en vez de
      // quedarse colgado en "cargando" con la red caída.
      try {
        const { getCachedOrders } = await import('@/lib/pos-offline-db')
        setOrders((await getCachedOrders()) as unknown as OrderFromDB[])
      } catch { /* IDB no disponible */ }
    } finally {
      setLoading(false)
    }
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

  const statusConfig: Record<string, { tone: DataTone; label: string }> = {
    abierta: { tone: 'neutral', label: 'Abierta' },
    enviada: { tone: 'info', label: 'Enviada' },
    preparando: { tone: 'warn', label: 'Preparando' },
    lista: { tone: 'ok', label: 'Lista' },
    cerrada: { tone: 'ok', label: 'Cerrada' },
    cancelada: { tone: 'bad', label: 'Cancelada' },
  }

  const field = 'rounded-xl border px-3 text-sm focus:outline-none'
  const fieldStyle = { background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-1)', minHeight: 44 }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      <header
        className="flex items-center justify-between gap-3 px-5 py-3 border-b flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/pos"
            aria-label="Volver al punto de venta"
            className="w-11 h-11 rounded-xl border grid place-items-center transition-transform active:scale-95"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <FileText size={22} style={{ color: 'var(--text-3)' }} />
            <h1 className="text-xl font-black tracking-tight">Historial de ordenes</h1>
          </div>
          <button
            type="button"
            onClick={fetchOrders}
            aria-label="Actualizar"
            className="w-11 h-11 rounded-xl border grid place-items-center transition-transform active:scale-95"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <Pill state="neutral" dot={false}>{filtered.length} ordenes</Pill>
      </header>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <input
          type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
          aria-label="Fecha"
          className={field} style={fieldStyle}
        />
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
          <input
            type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar mesero, mesa, orden..."
            aria-label="Buscar órdenes"
            className={`w-full pl-9 pr-3 ${field}`} style={fieldStyle}
          />
        </div>
        <select
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          aria-label="Filtrar por estado"
          className={field} style={fieldStyle}
        >
          <option value="all">Todos</option>
          <option value="cerrada">Cerradas</option>
          <option value="cancelada">Canceladas</option>
          <option value="enviada">Enviadas</option>
        </select>
      </div>

      {/* Orders list */}
      <div className="flex-1 min-h-0 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full" data-testid="historial-cargando">
            <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--info)', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full" data-testid="historial-vacio" style={{ color: 'var(--text-2)' }}>
            <p className="font-bold">Sin ordenes para esta fecha</p>
          </div>
        ) : (
          <List className="h-full" data-testid="historial-lista">
            {filtered.map(order => {
              const config = statusConfig[order.status] || statusConfig.abierta
              const isOpen = expanded === order.id
              const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])

              return (
                <div key={order.id}>
                  <Row
                    data-testid="historial-orden"
                    columns="auto 1fr auto"
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                  >
                    <span
                      className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">Mesa {order.mesa}</span>
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{order.mesero}</span>
                        <Tag tone={config.tone}>{config.label}</Tag>
                      </div>
                      <p className="text-[11.5px] font-semibold mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {new Date(order.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        {order.metodo_pago && ` · ${order.metodo_pago}`}
                        {order.personas > 0 && ` · ${order.personas} personas`}
                      </p>
                    </div>
                    <span className="font-black tabular-nums" style={{ color: 'var(--text-1)' }}>{formatMXN(order.total)}</span>
                  </Row>

                  {isOpen && (
                    <div className="px-4 py-3" data-testid="historial-detalle">
                      <div className="rounded-xl border p-4 ml-11" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                        <div className="space-y-1.5 mb-3">
                          {items.map((item: { nombre?: string; name?: string; cantidad?: number; quantity?: number; subtotal?: number; modificadores?: string[] }, i: number) => (
                            <div key={i} className="flex items-center justify-between gap-3 text-sm">
                              <RowText
                                title={`${item.cantidad || item.quantity || 1}x ${item.nombre || item.name}`}
                                sub={item.modificadores && item.modificadores.length > 0 ? item.modificadores.join(', ') : undefined}
                              />
                              <span className="font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--text-3)' }}>{formatMXN(item.subtotal || 0)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t pt-2.5 text-xs flex items-center gap-4 flex-wrap" style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                          <span>Sub: {formatMXN(order.subtotal)}</span>
                          <span>IVA: {formatMXN(order.iva)}</span>
                          {order.descuento > 0 && <span style={{ color: 'var(--crit-ink)' }}>Desc: -{formatMXN(order.descuento)}</span>}
                          <span className="font-mono">ID: {order.id.slice(0, 8)}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              printTicketCSS({
                                id: order.id,
                                mesa: order.mesa,
                                mesero: order.mesero,
                                personas: order.personas,
                                status: (order.status as 'cerrada') || 'cerrada',
                                items: items.map((it: { nombre?: string; name?: string; cantidad?: number; quantity?: number; subtotal?: number; precio?: number; precioExtra?: number; modificadores?: string[]; notas?: string; menuItemId?: string }) => ({
                                  id: it.menuItemId || '',
                                  menuItemId: it.menuItemId || '',
                                  nombre: it.nombre || it.name || '',
                                  precio: it.precio || (it.subtotal || 0) / (it.cantidad || it.quantity || 1),
                                  cantidad: it.cantidad || it.quantity || 1,
                                  subtotal: it.subtotal || 0,
                                  precioExtra: it.precioExtra || 0,
                                  modificadores: it.modificadores || [],
                                  notas: it.notas || '',
                                })),
                                subtotal: order.subtotal,
                                iva: order.iva,
                                descuento: order.descuento,
                                total: order.total,
                                metodoPago: order.metodo_pago || undefined,
                                createdAt: new Date(order.created_at),
                                closedAt: order.closed_at ? new Date(order.closed_at) : undefined,
                              })
                            }}
                            className="ml-auto inline-flex items-center gap-1.5 px-3 rounded-lg border text-xs font-bold transition-transform active:scale-95"
                            style={{ minHeight: 40, background: 'var(--info-soft)', borderColor: 'rgba(56,189,248,.30)', color: 'var(--info)' }}
                          >
                            <Printer size={12} />
                            Reimprimir
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </List>
        )}
      </div>
    </div>
  )
}
