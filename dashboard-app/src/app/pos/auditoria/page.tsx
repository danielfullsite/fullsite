'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Search, RefreshCw, Clock, User, FileText, Ban, CreditCard, ChefHat, Pencil, Plus, Percent } from 'lucide-react'
import { getAuditLog, type AuditLogEntry } from '@/lib/pos-data'

const ACTION_CONFIG: Record<string, { icon: typeof ShieldCheck; color: string; label: string }> = {
  order_created: { icon: Plus, color: 'text-emerald-400', label: 'Orden creada' },
  order_sent_kitchen: { icon: ChefHat, color: 'text-emerald-400', label: 'Enviada a cocina' },
  order_closed: { icon: CreditCard, color: 'text-blue-400', label: 'Orden cerrada' },
  order_cancelled: { icon: Ban, color: 'text-red-400', label: 'Orden anulada' },
  item_added: { icon: Plus, color: 'text-emerald-400', label: 'Item agregado' },
  item_modified: { icon: Pencil, color: 'text-amber-400', label: 'Item modificado' },
  item_cancelled: { icon: Ban, color: 'text-red-400', label: 'Item cancelado' },
  quantity_changed: { icon: Pencil, color: 'text-[var(--text-3)]', label: 'Cantidad cambiada' },
  discount_applied: { icon: Percent, color: 'text-amber-400', label: 'Descuento aplicado' },
  discount_removed: { icon: Percent, color: 'text-[var(--text-3)]', label: 'Descuento removido' },
  status_changed: { icon: ChefHat, color: 'text-blue-400', label: 'Estado cambiado' },
  payment_processed: { icon: CreditCard, color: 'text-emerald-400', label: 'Pago procesado' },
  preticket_printed: { icon: FileText, color: 'text-purple-400', label: 'Pre-cuenta impresa' },
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

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck size={24} className="text-emerald-400" />
            <h1 className="text-xl font-bold">Auditoria</h1>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-[var(--text-3)]">
            {entries.length} eventos · {alertEntries.length} cancelaciones
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 bg-[var(--surface-2)]/50 border-b border-slate-700">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por mesero, orden, motivo..."
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm min-h-[42px]"
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
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <div className="text-center">
              <ShieldCheck size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">Sin eventos registrados</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map(entry => {
              const config = ACTION_CONFIG[entry.action] || { icon: FileText, color: 'text-[var(--text-3)]', label: entry.action }
              const Icon = config.icon
              const details = parseDetails(entry.details)
              const isAlert = entry.action === 'item_cancelled' || entry.action === 'order_cancelled'

              return (
                <div
                  key={entry.id}
                  className={`px-6 py-4 hover:bg-[var(--surface-2)]/50 transition-colors ${isAlert ? 'bg-red-950/20 border-l-2 border-red-500' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isAlert ? 'bg-red-900/40' : 'bg-[var(--surface-2)]'
                    }`}>
                      <Icon size={16} className={config.color} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-semibold text-sm ${config.color}`}>{config.label}</span>
                        {entry.mesa && (
                          <span className="text-[var(--text-2)] text-xs">Mesa {entry.mesa}</span>
                        )}
                        {entry.order_id && (
                          <span className="text-[var(--text-2)] text-xs font-mono">{entry.order_id.slice(0, 8)}</span>
                        )}
                      </div>

                      {/* Details */}
                      {details && (
                        <div className="text-[var(--text-3)] text-sm space-y-0.5">
                          {'item' in details && details.item ? <p>Item: <span className="text-white">{String(details.item)}</span></p> : null}
                          {'method' in details && details.method ? <p>Metodo: <span className="text-white">{String(details.method)}</span></p> : null}
                          {'total' in details && details.total != null ? <p>Total: <span className="text-white">${Number(details.total).toFixed(2)}</span></p> : null}
                          {'amount' in details && details.amount != null ? <p>Monto: <span className="text-white">${Number(details.amount).toFixed(2)}</span></p> : null}
                          {'from' in details && 'to' in details && typeof details.from !== 'object' ? (
                            <p>{String(details.from)} → <span className="text-white">{String(details.to)}</span></p>
                          ) : null}
                          {'cantidad' in details && details.cantidad != null ? <p>Cantidad: <span className="text-white">{String(details.cantidad)}</span></p> : null}
                        </div>
                      )}

                      {/* Reason (for cancellations) */}
                      {entry.reason && (
                        <p className="text-red-400 text-sm mt-1">
                          Motivo: <span className="font-medium">{entry.reason}</span>
                        </p>
                      )}
                    </div>

                    {/* Right side: actor + time + approver */}
                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1.5 justify-end mb-1">
                        <User size={12} className="text-[var(--text-2)]" />
                        <span className="text-sm text-white">{entry.actor}</span>
                      </div>
                      <div className="flex items-center gap-1.5 justify-end">
                        <Clock size={12} className="text-[var(--text-2)]" />
                        <span className="text-xs text-[var(--text-2)]">{formatTime(entry.created_at)}</span>
                      </div>
                      {entry.approved_by && (
                        <p className="text-amber-400 text-xs mt-1">
                          Aprobado: {entry.approved_by}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
