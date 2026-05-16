'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, ShoppingCart, RefreshCw, Plus, Send, PackageCheck, FileText, CreditCard,
  ChevronDown, ChevronRight, Sparkles, Check, X, Truck, Receipt, Ban,
} from 'lucide-react'
import {
  getPurchaseOrders, getPurchaseOrderItems, createPurchaseOrder, updatePurchaseOrderStatus,
  receiveOrderItems, restockFromPurchaseOrder,
  getFacturas, createFactura, updateFacturaStatus,
  getSuggestedPurchaseItems, getSuppliers,
  MANAGER_PINS, generateId, formatMXN, logAudit,
  type PurchaseOrder, type PurchaseOrderItem, type Factura,
} from '@/lib/pos-data'

// ─── OC Status Config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  borrador: { color: 'text-slate-400', bg: 'bg-slate-700', label: 'Borrador' },
  enviada: { color: 'text-blue-400', bg: 'bg-blue-900/40', label: 'Enviada' },
  recibida: { color: 'text-amber-400', bg: 'bg-amber-900/40', label: 'Recibida' },
  facturada: { color: 'text-purple-400', bg: 'bg-purple-900/40', label: 'Facturada' },
  pagada: { color: 'text-emerald-400', bg: 'bg-emerald-900/40', label: 'Pagada' },
  cancelada: { color: 'text-red-400', bg: 'bg-red-900/40', label: 'Cancelada' },
}

const FACTURA_STATUS: Record<string, { color: string; bg: string; label: string }> = {
  capturada: { color: 'text-amber-400', bg: 'bg-amber-900/40', label: 'Capturada' },
  aprobada: { color: 'text-blue-400', bg: 'bg-blue-900/40', label: 'Aprobada' },
  pagada: { color: 'text-emerald-400', bg: 'bg-emerald-900/40', label: 'Pagada' },
}

export default function ComprasPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'ordenes' | 'facturas' | 'nueva'>('ordenes')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<PurchaseOrderItem[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchData = async () => {
    setLoading(true)
    const [o, f] = await Promise.all([getPurchaseOrders(), getFacturas()])
    setOrders(o)
    setFacturas(f)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    const items = await getPurchaseOrderItems(id)
    setExpandedItems(items)
    setExpanded(id)
  }

  // ─── Send OC ─────────────────────────────────────────────────────────────

  const sendOC = async (po: PurchaseOrder) => {
    await updatePurchaseOrderStatus(po.id, 'enviada')
    logAudit({ order_id: po.id, action: 'status_changed', actor: po.created_by, details: { type: 'purchase_order', from: 'borrador', to: 'enviada' } })
    showToast(`OC enviada a ${po.supplier}`)
    fetchData()
  }

  // ─── Reception Modal ────────────────────────────────────────────────────

  const [receptionPO, setReceptionPO] = useState<PurchaseOrder | null>(null)
  const [receptionItems, setReceptionItems] = useState<(PurchaseOrderItem & { qty_received: number; discrepancy: string })[]>([])
  const [receptionBy, setReceptionBy] = useState('')
  const [receptionNotes, setReceptionNotes] = useState('')
  const [savingReception, setSavingReception] = useState(false)

  const openReception = async (po: PurchaseOrder) => {
    const items = await getPurchaseOrderItems(po.id)
    setReceptionItems(items.map(item => ({
      ...item,
      qty_received: item.quantity_ordered, // pre-fill with ordered qty
      discrepancy: '',
    })))
    setReceptionPO(po)
    setReceptionBy('')
    setReceptionNotes('')
  }

  const updateReceivedQty = (itemId: number, qty: number) => {
    setReceptionItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, qty_received: Math.max(0, qty) } : item
    ))
  }

  const updateDiscrepancy = (itemId: number, reason: string) => {
    setReceptionItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, discrepancy: reason } : item
    ))
  }

  const handleConfirmReception = async () => {
    if (!receptionPO || !receptionBy.trim()) return
    setSavingReception(true)

    // 1. Update quantity_received for each item
    await receiveOrderItems(
      receptionPO.id,
      receptionItems.map(item => ({ item_id: item.id, quantity_received: item.qty_received }))
    )

    // 2. Restock inventory ONLY with received quantities
    const restockItems = receptionItems.map(item => ({
      ...item,
      quantity_received: item.qty_received,
    }))
    await restockFromPurchaseOrder(receptionPO.id, restockItems, receptionBy)

    // 3. Calculate actual total based on received qty
    const actualSubtotal = receptionItems.reduce((sum, item) => sum + (item.qty_received * item.unit_cost), 0)
    const actualIva = actualSubtotal * 0.16
    const actualTotal = actualSubtotal + actualIva

    // 4. Update OC status
    await updatePurchaseOrderStatus(receptionPO.id, 'recibida', {
      received_by: receptionBy,
      subtotal: actualSubtotal,
      iva: actualIva,
      total: actualTotal,
    })

    // 5. Log discrepancies in audit
    const discrepancies = receptionItems.filter(item => item.qty_received !== item.quantity_ordered)
    logAudit({
      order_id: receptionPO.id,
      action: 'status_changed',
      actor: receptionBy,
      details: {
        type: 'oc_received',
        supplier: receptionPO.supplier,
        items_ordered: receptionItems.length,
        items_with_discrepancy: discrepancies.length,
        discrepancies: discrepancies.map(d => ({
          ingredient: d.ingredient_name,
          ordered: d.quantity_ordered,
          received: d.qty_received,
          reason: d.discrepancy || 'sin motivo',
        })),
        total_ordered: receptionPO.total,
        total_received: actualTotal,
        notes: receptionNotes,
      },
      reason: discrepancies.length > 0 ? `${discrepancies.length} discrepancia(s) en recepcion` : undefined,
    })

    setSavingReception(false)
    setReceptionPO(null)
    showToast(`Recepcion completa — ${discrepancies.length > 0 ? discrepancies.length + ' discrepancias registradas' : 'todo coincide'}`)
    fetchData()
  }

  // ─── Create Factura for OC ──────────────────────────────────────────────

  const [facturaModal, setFacturaModal] = useState<PurchaseOrder | null>(null)
  const [facturaFolio, setFacturaFolio] = useState('')
  const [facturaNotes, setFacturaNotes] = useState('')

  const handleCreateFactura = async () => {
    if (!facturaModal) return
    const id = generateId()
    // Factura uses RECEIVED totals, not ordered
    const ok = await createFactura({
      id, purchase_order_id: facturaModal.id, supplier: facturaModal.supplier,
      folio: facturaFolio, subtotal: facturaModal.subtotal, iva: facturaModal.iva,
      total: facturaModal.total, captured_by: 'Almacen', notes: facturaNotes,
    })
    if (ok) {
      await updatePurchaseOrderStatus(facturaModal.id, 'facturada')
      logAudit({ order_id: facturaModal.id, action: 'status_changed', actor: 'Almacen', details: { type: 'factura_created', folio: facturaFolio } })
      showToast('Factura capturada')
    }
    setFacturaModal(null)
    setFacturaFolio('')
    setFacturaNotes('')
    fetchData()
  }

  // ─── Approve/Pay factura ────────────────────────────────────────────────

  const advanceFactura = async (f: Factura) => {
    let newStatus = ''
    if (f.status === 'capturada') newStatus = 'aprobada'
    else if (f.status === 'aprobada') newStatus = 'pagada'
    if (!newStatus) return

    if (newStatus === 'pagada') {
      // Mark associated OC as pagada too
      if (f.purchase_order_id) {
        await updatePurchaseOrderStatus(f.purchase_order_id, 'pagada')
      }
    }

    await updateFacturaStatus(f.id, newStatus,
      newStatus === 'aprobada' ? { approved_by: 'Eduardo' } : undefined
    )
    showToast(`Factura → ${newStatus}`)
    fetchData()
  }

  return (
    <div className="h-screen flex flex-col text-white bg-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ShoppingCart size={24} className="text-purple-400" />
            <h1 className="text-xl font-bold">Compras</h1>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>{orders.length} OC</span>
          <span>·</span>
          <span>{facturas.length} facturas</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2 border-b border-slate-700">
        <button onClick={() => setTab('ordenes')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'ordenes' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Truck size={14} className="inline mr-1.5 -mt-0.5" />Ordenes de Compra
        </button>
        <button onClick={() => setTab('facturas')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'facturas' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Receipt size={14} className="inline mr-1.5 -mt-0.5" />Facturas
        </button>
        <button onClick={() => setTab('nueva')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'nueva' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          <Sparkles size={14} className="inline mr-1.5 -mt-0.5" />Nueva OC (IA)
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'ordenes' ? (
          /* ─── OC List ─── */
          orders.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <div className="text-center">
                <ShoppingCart size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-xl">Sin ordenes de compra</p>
                <button onClick={() => setTab('nueva')} className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm">
                  <Sparkles size={14} className="inline mr-1.5" />Crear con IA
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {orders.map(po => {
                const config = STATUS_CONFIG[po.status] || STATUS_CONFIG.borrador
                const isOpen = expanded === po.id
                return (
                  <div key={po.id}>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-800/50 transition-colors">
                      <button onClick={() => toggleExpand(po.id)} className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center">
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{po.supplier}</span>
                          <span className="text-slate-600 text-xs font-mono">{po.id.slice(0, 8)}</span>
                          {po.ai_suggested && <Sparkles size={12} className="text-amber-400" />}
                        </div>
                        <p className="text-slate-400 text-sm">Por: {po.created_by} · {new Date(po.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}</p>
                      </div>
                      <p className="font-semibold text-white">{formatMXN(po.total)}</p>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>{config.label}</span>

                      {/* Action buttons based on status */}
                      {po.status === 'borrador' && (
                        <button onClick={() => sendOC(po)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                          <Send size={14} />Enviar
                        </button>
                      )}
                      {po.status === 'enviada' && (
                        <button onClick={() => openReception(po)} className="px-3 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                          <PackageCheck size={14} />Recibir
                        </button>
                      )}
                      {po.status === 'recibida' && (
                        <button onClick={() => setFacturaModal(po)} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                          <Receipt size={14} />Factura
                        </button>
                      )}
                    </div>

                    {/* Expanded items */}
                    {isOpen && (
                      <div className="px-6 pb-4">
                        <div className="bg-slate-800/60 rounded-xl overflow-hidden ml-12">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-slate-400 border-b border-slate-700">
                                <th className="text-left px-4 py-2.5 font-medium">Ingrediente</th>
                                <th className="text-right px-4 py-2.5 font-medium">Pedido</th>
                                <th className="text-right px-4 py-2.5 font-medium">Recibido</th>
                                <th className="text-left px-4 py-2.5 font-medium">Unidad</th>
                                <th className="text-right px-4 py-2.5 font-medium">Costo/u</th>
                                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedItems.map(item => (
                                <tr key={item.id} className="border-b border-slate-700/50 last:border-0">
                                  <td className="px-4 py-2.5 text-white">{item.ingredient_name}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-300">{item.quantity_ordered}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-300">{item.quantity_received ?? '—'}</td>
                                  <td className="px-4 py-2.5 text-slate-400">{item.unit}</td>
                                  <td className="px-4 py-2.5 text-right text-slate-400">{formatMXN(item.unit_cost)}</td>
                                  <td className="px-4 py-2.5 text-right text-white font-medium">{formatMXN(item.total_cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : tab === 'facturas' ? (
          /* ─── Facturas List ─── */
          facturas.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <div className="text-center">
                <Receipt size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-xl">Sin facturas</p>
                <p className="text-sm mt-1">Las facturas se crean al recibir una OC</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {facturas.map(f => {
                const config = FACTURA_STATUS[f.status] || FACTURA_STATUS.capturada
                return (
                  <div key={f.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-800/50">
                    <div className="w-9 h-9 rounded-lg bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                      <Receipt size={16} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{f.supplier}</span>
                        {f.folio && <span className="text-slate-500 text-xs">Folio: {f.folio}</span>}
                      </div>
                      <p className="text-slate-400 text-sm">
                        Capturada por: {f.captured_by}
                        {f.approved_by && ` · Aprobada: ${f.approved_by}`}
                        {f.purchase_order_id && ` · OC: ${f.purchase_order_id.slice(0, 6)}`}
                      </p>
                    </div>
                    <p className="font-semibold text-white">{formatMXN(f.total)}</p>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>{config.label}</span>

                    {f.status === 'capturada' && (
                      <button onClick={() => advanceFactura(f)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                        <Check size={14} />Aprobar
                      </button>
                    )}
                    {f.status === 'aprobada' && (
                      <button onClick={() => advanceFactura(f)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                        <CreditCard size={14} />Pagar
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          /* ─── Nueva OC con IA ─── */
          <NewOCPanel onCreated={() => { setTab('ordenes'); fetchData() }} showToast={showToast} />
        )}
      </div>

      {/* Reception Modal — almacenista verifica item por item */}
      {receptionPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReceptionPO(null)} />
          <div className="relative bg-slate-800 border border-amber-700/40 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl mx-4">
            {/* Header */}
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 rounded-t-2xl z-10">
              <div className="flex items-center gap-3">
                <PackageCheck size={24} className="text-amber-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Recepcion de mercancia</h3>
                  <p className="text-amber-400 text-sm">{receptionPO.supplier} · OC {receptionPO.id.slice(0, 8)}</p>
                </div>
              </div>
              <p className="text-slate-400 text-sm mt-2">Verifica cada producto contra lo que llego fisicamente. Si algo no coincide, ajusta la cantidad y escribe el motivo.</p>
            </div>

            {/* Items table */}
            <div className="px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left px-3 py-2.5 font-medium">Ingrediente</th>
                    <th className="text-right px-3 py-2.5 font-medium">Pedido</th>
                    <th className="text-right px-3 py-2.5 font-medium">Recibido</th>
                    <th className="text-left px-3 py-2.5 font-medium">Unidad</th>
                    <th className="text-center px-3 py-2.5 font-medium">Estado</th>
                    <th className="text-left px-3 py-2.5 font-medium">Motivo discrepancia</th>
                  </tr>
                </thead>
                <tbody>
                  {receptionItems.map(item => {
                    const matches = item.qty_received === item.quantity_ordered
                    const isShort = item.qty_received < item.quantity_ordered
                    const isOver = item.qty_received > item.quantity_ordered
                    return (
                      <tr key={item.id} className={`border-b border-slate-700/50 ${!matches ? 'bg-amber-950/20' : ''}`}>
                        <td className="px-3 py-3 text-white font-medium">{item.ingredient_name}</td>
                        <td className="px-3 py-3 text-right text-slate-300">{item.quantity_ordered}</td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={item.qty_received}
                            onChange={e => updateReceivedQty(item.id, Number(e.target.value))}
                            className={`w-24 bg-slate-700 border rounded px-2 py-1.5 text-right text-sm focus:outline-none ${
                              matches ? 'border-slate-600 text-white focus:border-emerald-500' :
                              isShort ? 'border-red-600 text-red-400 focus:border-red-500' :
                              'border-amber-600 text-amber-400 focus:border-amber-500'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-3 text-slate-400">{item.unit}</td>
                        <td className="px-3 py-3 text-center">
                          {matches ? (
                            <span className="text-emerald-400 text-xs font-bold">OK</span>
                          ) : isShort ? (
                            <span className="text-red-400 text-xs font-bold">FALTA {(item.quantity_ordered - item.qty_received).toFixed(2)}</span>
                          ) : (
                            <span className="text-amber-400 text-xs font-bold">+{(item.qty_received - item.quantity_ordered).toFixed(2)} DE MAS</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {!matches && (
                            <select
                              value={item.discrepancy}
                              onChange={e => updateDiscrepancy(item.id, e.target.value)}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                            >
                              <option value="">Selecciona motivo</option>
                              <option value="Producto agotado con proveedor">Agotado con proveedor</option>
                              <option value="Producto en mal estado">Mal estado</option>
                              <option value="Cantidad incorrecta del proveedor">Cantidad incorrecta</option>
                              <option value="Producto equivocado">Producto equivocado</option>
                              <option value="Peso diferente al facturado">Peso diferente</option>
                              <option value="Proveedor envio de mas">Enviaron de mas</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Summary */}
              {(() => {
                const discrepancies = receptionItems.filter(i => i.qty_received !== i.quantity_ordered)
                const receivedTotal = receptionItems.reduce((sum, i) => sum + (i.qty_received * i.unit_cost), 0)
                return (
                  <div className="mt-4 p-4 bg-slate-700/50 rounded-xl">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Total OC original</span>
                      <span className="text-slate-300">{formatMXN(receptionPO.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Total recibido (+ IVA)</span>
                      <span className={`font-semibold ${receivedTotal * 1.16 < receptionPO.total ? 'text-amber-400' : 'text-white'}`}>
                        {formatMXN(receivedTotal * 1.16)}
                      </span>
                    </div>
                    {discrepancies.length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-red-400">Discrepancias</span>
                        <span className="text-red-400 font-semibold">{discrepancies.length} item(s)</span>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Who received */}
              <div className="mt-4">
                <label className="text-sm text-slate-400 block mb-1">Recibido por</label>
                <input
                  type="text"
                  value={receptionBy}
                  onChange={e => setReceptionBy(e.target.value)}
                  placeholder="Nombre del almacenista..."
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="mt-3">
                <label className="text-sm text-slate-400 block mb-1">Notas de recepcion</label>
                <input
                  type="text"
                  value={receptionNotes}
                  onChange={e => setReceptionNotes(e.target.value)}
                  placeholder="Notas opcionales..."
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-slate-800 border-t border-slate-700 px-6 py-4 flex gap-3 rounded-b-2xl">
              <button onClick={() => setReceptionPO(null)} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold">
                Cancelar
              </button>
              <button
                onClick={handleConfirmReception}
                disabled={!receptionBy.trim() || savingReception}
                className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold flex items-center justify-center gap-2"
              >
                <PackageCheck size={18} />
                {savingReception ? 'Guardando...' : 'Confirmar recepcion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factura capture modal */}
      {facturaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setFacturaModal(null)} />
          <div className="relative bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
            <div className="flex items-center gap-3 mb-4">
              <Receipt size={24} className="text-purple-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Capturar factura</h3>
                <p className="text-slate-400 text-sm">{facturaModal.supplier} · {formatMXN(facturaModal.total)}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400 block mb-1">Folio de factura</label>
                <input type="text" value={facturaFolio} onChange={e => setFacturaFolio(e.target.value)} placeholder="Ej. FAC-2024-001"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Notas</label>
                <input type="text" value={facturaNotes} onChange={e => setFacturaNotes(e.target.value)} placeholder="Notas opcionales..."
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFacturaModal(null)} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold">Cancelar</button>
              <button onClick={handleCreateFactura} className="flex-[2] py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center justify-center gap-2">
                <Receipt size={18} />Capturar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-700 border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── AI-Suggested Purchase Order Panel ──────────────────────────────────────

function NewOCPanel({ onCreated, showToast }: { onCreated: () => void; showToast: (msg: string) => void }) {
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof getSuggestedPurchaseItems>>>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  // Editable quantities per supplier
  const [editQty, setEditQty] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    (async () => {
      setLoading(true)
      const data = await getSuggestedPurchaseItems()
      setSuggestions(data)
      // Init editable quantities
      const init: Record<string, Record<string, number>> = {}
      for (const s of data) {
        init[s.supplier] = {}
        for (const item of s.items) {
          init[s.supplier][item.ingredient_id] = item.suggested_qty
        }
      }
      setEditQty(init)
      setLoading(false)
    })()
  }, [])

  const updateQty = (supplier: string, ingredientId: string, qty: number) => {
    setEditQty(prev => ({
      ...prev,
      [supplier]: { ...prev[supplier], [ingredientId]: Math.max(0, qty) },
    }))
  }

  const createOCForSupplier = async (supplier: string) => {
    const s = suggestions.find(s => s.supplier === supplier)
    if (!s) return
    setCreating(true)

    const items = s.items
      .filter(item => (editQty[supplier]?.[item.ingredient_id] ?? item.suggested_qty) > 0)
      .map(item => {
        const qty = editQty[supplier]?.[item.ingredient_id] ?? item.suggested_qty
        return {
          ingredient_id: item.ingredient_id,
          ingredient_name: item.name,
          quantity_ordered: qty,
          unit: item.unit,
          unit_cost: item.unit_cost,
          total_cost: qty * item.unit_cost,
        }
      })

    const subtotal = items.reduce((sum, i) => sum + i.total_cost, 0)
    const iva = subtotal * 0.16
    const total = subtotal + iva

    const ok = await createPurchaseOrder({
      id: generateId(),
      supplier,
      created_by: 'Chef (IA)',
      notes: 'Generada por sugerencia de IA',
      subtotal, iva, total,
      ai_suggested: true,
      items,
    })

    setCreating(false)
    if (ok) {
      showToast(`OC creada para ${supplier}`)
      onCreated()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Analizando inventario...</p>
        </div>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-center">
          <Check size={48} className="mx-auto mb-3 text-emerald-500 opacity-70" />
          <p className="text-xl text-emerald-400">Inventario OK</p>
          <p className="text-sm mt-1">Ningun ingrediente debajo del punto de reorden</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Sparkles size={20} className="text-amber-400" />
        <h2 className="text-lg font-bold">Sugerencias de compra</h2>
        <span className="text-slate-400 text-sm">Basado en punto de reorden — ajusta cantidades antes de enviar</span>
      </div>

      {suggestions.map(s => {
        const items = s.items.filter(item => (editQty[s.supplier]?.[item.ingredient_id] ?? item.suggested_qty) > 0)
        const totalCost = items.reduce((sum, item) => {
          const qty = editQty[s.supplier]?.[item.ingredient_id] ?? item.suggested_qty
          return sum + qty * item.unit_cost
        }, 0)

        return (
          <div key={s.supplier} className="bg-slate-800/60 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div>
                <h3 className="font-bold text-white text-lg">{s.supplier}</h3>
                <p className="text-slate-400 text-sm">{s.items.length} ingredientes bajo stock</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-semibold text-white">{formatMXN(totalCost)}</p>
                <button
                  onClick={() => createOCForSupplier(s.supplier)}
                  disabled={creating}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg text-sm text-white font-semibold flex items-center gap-1.5"
                >
                  <Plus size={14} />Crear OC
                </button>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left px-5 py-2.5 font-medium">Ingrediente</th>
                  <th className="text-right px-3 py-2.5 font-medium">Stock actual</th>
                  <th className="text-right px-3 py-2.5 font-medium">Reorden</th>
                  <th className="text-right px-3 py-2.5 font-medium">Pedir</th>
                  <th className="text-left px-3 py-2.5 font-medium">Unidad</th>
                  <th className="text-right px-5 py-2.5 font-medium">Costo est.</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map(item => {
                  const qty = editQty[s.supplier]?.[item.ingredient_id] ?? item.suggested_qty
                  return (
                    <tr key={item.ingredient_id} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-5 py-2.5 text-white">{item.name}</td>
                      <td className="px-3 py-2.5 text-right text-red-400 font-medium">{item.current_stock.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-400">{item.reorder_point}</td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number"
                          value={qty}
                          onChange={e => updateQty(s.supplier, item.ingredient_id, Number(e.target.value))}
                          className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-right text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">{item.unit}</td>
                      <td className="px-5 py-2.5 text-right text-white">{formatMXN(qty * item.unit_cost)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
