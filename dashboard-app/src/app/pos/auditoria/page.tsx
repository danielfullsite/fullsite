'use client'

// Migración visual a las primitivas del rediseño V2 (fase 2).
//
// Sólo cambia la PIEL. La consulta (`getAuditLog(200)`), los filtros, el conteo
// de cabecera, el mapa de acciones, el desglose de `details`, el motivo, el
// actor, la hora y el aprobador quedan idénticos. Lo que antes eran clases de
// Tailwind sueltas (`text-emerald-400`, `bg-red-950/20`, `divide-slate-800`)
// ahora son tonos del sistema — mismo significado, un solo vocabulario.
//
// NO se añadió manejo de error a propósito: `getAuditLog` puede rechazar sin
// red y `fetchData` no tiene try/catch, así que la pantalla se queda en
// "cargando". Ese defecto es PREVIO y arreglarlo es un cambio de comportamiento,
// fuera del alcance de esta fase. Queda reportado.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Search, RefreshCw, Clock, User, FileText, Ban, CreditCard, ChefHat, Pencil, Plus, Percent } from 'lucide-react'
import { getAuditLog, type AuditLogEntry } from '@/lib/pos-data'
import { List, Row, Pill, type DataTone } from '@/components/pos/ui/PosKit'

const ACTION_CONFIG: Record<string, { icon: typeof ShieldCheck; tone: DataTone; label: string }> = {
  order_created: { icon: Plus, tone: 'ok', label: 'Orden creada' },
  order_sent_kitchen: { icon: ChefHat, tone: 'ok', label: 'Enviada a cocina' },
  order_closed: { icon: CreditCard, tone: 'info', label: 'Orden cerrada' },
  order_cancelled: { icon: Ban, tone: 'bad', label: 'Orden anulada' },
  item_added: { icon: Plus, tone: 'ok', label: 'Item agregado' },
  item_modified: { icon: Pencil, tone: 'warn', label: 'Item modificado' },
  item_cancelled: { icon: Ban, tone: 'bad', label: 'Item cancelado' },
  quantity_changed: { icon: Pencil, tone: 'neutral', label: 'Cantidad cambiada' },
  discount_applied: { icon: Percent, tone: 'warn', label: 'Descuento aplicado' },
  discount_removed: { icon: Percent, tone: 'neutral', label: 'Descuento removido' },
  status_changed: { icon: ChefHat, tone: 'info', label: 'Estado cambiado' },
  payment_processed: { icon: CreditCard, tone: 'ok', label: 'Pago procesado' },
  preticket_printed: { icon: FileText, tone: 'info', label: 'Pre-cuenta impresa' },
  kitchen_item_updated: { icon: Pencil, tone: 'warn', label: 'Item actualizado en cocina' },
}

const TONE_INK: Record<DataTone, string> = {
  ok: 'var(--accent-bright)',
  info: 'var(--info)',
  warn: 'var(--warn)',
  bad: 'var(--crit-ink)',
  neutral: 'var(--text-3)',
}
const TONE_SOFT: Record<DataTone, string> = {
  ok: 'var(--accent-soft)',
  info: 'var(--info-soft)',
  warn: 'var(--warn-soft)',
  bad: 'var(--crit-soft)',
  neutral: 'var(--surface-2)',
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('es-MX', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function parseDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null
  try { return typeof details === 'string' ? JSON.parse(details) : details }
  catch { return null }
}

export default function AuditoriaPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterAction, setFilterAction] = useState<string>('all')

  const fetchData = async () => {
    setLoading(true)
    const data = await getAuditLog(200)
    setEntries(data)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const filtered = entries.filter(e => {
    if (filterAction !== 'all' && e.action !== filterAction) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const matchActor = e.actor.toLowerCase().includes(term)
      const matchOrder = e.order_id?.toLowerCase().includes(term)
      const matchReason = e.reason?.toLowerCase().includes(term)
      const matchDetails = e.details?.toLowerCase().includes(term)
      if (!matchActor && !matchOrder && !matchReason && !matchDetails) return false
    }
    return true
  })

  const alertEntries = entries.filter(e =>
    e.action === 'item_cancelled' || e.action === 'order_cancelled'
  )

  const field = 'rounded-xl border px-3 text-sm focus:outline-none'
  const fieldStyle = { background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-1)', minHeight: 44 }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      {/* Header */}
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
            <ShieldCheck size={22} style={{ color: 'var(--accent-bright)' }} />
            <h1 className="text-xl font-black tracking-tight">Auditoria</h1>
          </div>
          <button
            type="button"
            onClick={fetchData}
            aria-label="Actualizar"
            className="w-11 h-11 rounded-xl border grid place-items-center transition-transform active:scale-95"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Pill state="neutral" dot={false}>{entries.length} eventos</Pill>
          <Pill state={alertEntries.length ? 'warn' : 'neutral'} dot={false}>{alertEntries.length} cancelaciones</Pill>
        </div>
      </header>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="relative flex-1 max-w-md min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por mesero, orden, motivo..."
            aria-label="Buscar en la auditoría"
            className={`w-full pl-10 pr-4 ${field}`}
            style={fieldStyle}
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          aria-label="Filtrar por acción"
          className={field}
          style={fieldStyle}
        >
          <option value="all">Todas las acciones</option>
          <option value="item_cancelled">Cancelaciones de item</option>
          <option value="order_cancelled">Ordenes anuladas</option>
          <option value="item_added">Items agregados</option>
          <option value="item_modified">Items modificados</option>
          <option value="discount_applied">Descuentos</option>
          <option value="payment_processed">Pagos</option>
          <option value="status_changed">Cambios de estado</option>
        </select>
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full" data-testid="auditoria-cargando">
            <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full" data-testid="auditoria-vacio" style={{ color: 'var(--text-2)' }}>
            <div className="text-center">
              <ShieldCheck size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl font-bold">Sin eventos registrados</p>
            </div>
          </div>
        ) : (
          <List className="h-full" data-testid="auditoria-lista">
            {filtered.map(entry => {
              const config = ACTION_CONFIG[entry.action] || { icon: FileText, tone: 'neutral' as DataTone, label: entry.action }
              const Icon = config.icon
              const details = parseDetails(entry.details)
              const isAlert = entry.action === 'item_cancelled' || entry.action === 'order_cancelled'

              return (
                <Row
                  key={entry.id}
                  data-testid="auditoria-evento"
                  columns="auto 1fr auto"
                  tone={isAlert ? 'bad' : undefined}
                  className="!py-3 items-start"
                  style={{ alignItems: 'flex-start' }}
                >
                  {/* Icon */}
                  <div
                    className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0"
                    style={{ background: TONE_SOFT[config.tone] }}
                  >
                    <Icon size={16} style={{ color: TONE_INK[config.tone] }} />
                  </div>

                  {/* Content */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm" style={{ color: TONE_INK[config.tone] }}>{config.label}</span>
                      {entry.mesa ? (
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Mesa {entry.mesa}</span>
                      ) : null}
                      {entry.order_id ? (
                        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{entry.order_id.slice(0, 8)}</span>
                      ) : null}
                    </div>

                    {/* Details */}
                    {details && (
                      <div className="text-sm space-y-0.5 mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {'item' in details && details.item ? <p>Item: <span style={{ color: 'var(--text-1)' }}>{String(details.item)}</span></p> : null}
                        {'method' in details && details.method ? <p>Metodo: <span style={{ color: 'var(--text-1)' }}>{String(details.method)}</span></p> : null}
                        {'total' in details && details.total != null ? <p>Total: <span style={{ color: 'var(--text-1)' }}>${Number(details.total).toFixed(2)}</span></p> : null}
                        {'amount' in details && details.amount != null ? <p>Monto: <span style={{ color: 'var(--text-1)' }}>${Number(details.amount).toFixed(2)}</span></p> : null}
                        {'from' in details && 'to' in details && typeof details.from !== 'object' ? (
                          <p>{String(details.from)} → <span style={{ color: 'var(--text-1)' }}>{String(details.to)}</span></p>
                        ) : null}
                        {'cantidad' in details && details.cantidad != null ? <p>Cantidad: <span style={{ color: 'var(--text-1)' }}>{String(details.cantidad)}</span></p> : null}
                      </div>
                    )}

                    {/* Reason (for cancellations) */}
                    {entry.reason && (
                      <p className="text-sm mt-1" style={{ color: 'var(--crit-ink)' }}>
                        Motivo: <span className="font-semibold">{entry.reason}</span>
                      </p>
                    )}
                  </div>

                  {/* Right side: actor + time + approver */}
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center gap-1.5 justify-end">
                      <User size={12} style={{ color: 'var(--text-3)' }} />
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{entry.actor}</span>
                    </div>
                    <div className="flex items-center gap-1.5 justify-end mt-0.5">
                      <Clock size={12} style={{ color: 'var(--text-3)' }} />
                      <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{formatTime(entry.created_at)}</span>
                    </div>
                    {/* El nombre del aprobador NO va en un Tag: los Tag son
                        mayúsculas y un nombre propio no se grita. */}
                    {entry.approved_by && (
                      <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--warn)' }}>
                        Aprobado: {entry.approved_by}
                      </p>
                    )}
                  </div>
                </Row>
              )
            })}
          </List>
        )}
      </div>
    </div>
  )
}
