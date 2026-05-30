'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, ShoppingCart, RefreshCw, Plus, Send, PackageCheck, FileText, CreditCard,
  ChevronDown, ChevronRight, Sparkles, Check, X, Truck, Receipt, Ban, Trash2,
  DollarSign, Calendar, Building2, ClipboardList, AlertTriangle, Download,
} from 'lucide-react'
import {
  getPurchaseOrders, getPurchaseOrderItems, createPurchaseOrder, updatePurchaseOrderStatus,
  receiveOrderItems, restockFromPurchaseOrder,
  getFacturas, createFactura, updateFacturaStatus,
  getSuggestedPurchaseItems, getSuppliers,
  MANAGER_PINS, generateId, formatMXN, logAudit,
  type PurchaseOrder, type PurchaseOrderItem, type Factura,
} from '@/lib/pos-data'
import { IVA_RATE } from '@/lib/pos-constants'

// ─── OC Status Config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  borrador: { color: 'text-[var(--text-3)]', bg: 'bg-[var(--line)]', label: 'Borrador' },
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

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

type TabKey = 'ordenes' | 'recibir' | 'facturas' | 'nueva' | 'nueva-manual'

export default function ComprasPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('ordenes')
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

  // ─── KPI Summaries ──────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const borradores = orders.filter(o => o.status === 'borrador').length
    const enviadas = orders.filter(o => o.status === 'enviada').length
    const porRecibir = orders.filter(o => o.status === 'enviada')
    const porPagar = facturas.filter(f => f.status !== 'pagada')
    const totalPendiente = porPagar.reduce((s, f) => s + f.total, 0)
    return { borradores, enviadas, porRecibir: porRecibir.length, porPagar: porPagar.length, totalPendiente }
  }, [orders, facturas])

  // ─── Send OC ─────────────────────────────────────────────────────────────

  const sendOC = async (po: PurchaseOrder) => {
    await updatePurchaseOrderStatus(po.id, 'enviada')
    logAudit({ order_id: po.id, action: 'status_changed', actor: po.created_by, details: { type: 'purchase_order', from: 'borrador', to: 'enviada' } })
    showToast(`OC enviada a ${po.supplier}`)
    fetchData()
  }

  // ─── Cancel OC ──────────────────────────────────────────────────────────

  const cancelOC = async (po: PurchaseOrder) => {
    if (po.status !== 'borrador' && po.status !== 'enviada') return
    await updatePurchaseOrderStatus(po.id, 'cancelada')
    logAudit({ order_id: po.id, action: 'status_changed', actor: 'Gerente', details: { type: 'purchase_order', from: po.status, to: 'cancelada' } })
    showToast(`OC cancelada`)
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
    const actualIva = actualSubtotal * IVA_RATE
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

    const itemCount = receptionItems.reduce((s, i) => s + (i.qty_received > 0 ? 1 : 0), 0)

    setSavingReception(false)
    setReceptionPO(null)
    showToast(`Recepcion completa — ${itemCount} items dados de alta en inventario${discrepancies.length > 0 ? `, ${discrepancies.length} discrepancias` : ''}`)
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

  // ─── Payment Modal ──────────────────────────────────────────────────────

  const [paymentModal, setPaymentModal] = useState<Factura | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('transferencia')
  const [paymentRef, setPaymentRef] = useState('')
  const [paymentCFDI, setPaymentCFDI] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0])
  const [paymentNotes, setPaymentNotes] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)

  const openPaymentModal = (f: Factura) => {
    setPaymentModal(f)
    setPaymentMethod('transferencia')
    setPaymentRef('')
    setPaymentCFDI(f.folio || '')
    setPaymentDate(new Date().toISOString().split('T')[0])
    setPaymentNotes('')
  }

  const handlePayFactura = async () => {
    if (!paymentModal) return
    setSavingPayment(true)

    const staffName = (() => {
      try { const s = sessionStorage.getItem('pos_staff'); return s ? JSON.parse(s).name : 'Gerente' } catch { return 'Gerente' }
    })()

    // 1. Approve if still capturada
    if (paymentModal.status === 'capturada') {
      await updateFacturaStatus(paymentModal.id, 'aprobada', { approved_by: staffName })
    }

    // 2. Mark as paid
    await updateFacturaStatus(paymentModal.id, 'pagada', {
      paid_by: staffName,
      payment_method: paymentMethod,
      payment_reference: paymentRef || null,
      cfdi_folio: paymentCFDI || null,
      payment_date: paymentDate,
      payment_notes: paymentNotes || null,
    })

    // 3. Mark associated OC as pagada
    if (paymentModal.purchase_order_id) {
      await updatePurchaseOrderStatus(paymentModal.purchase_order_id, 'pagada')
    }

    logAudit({
      order_id: paymentModal.id,
      action: 'status_changed',
      actor: staffName,
      details: {
        type: 'factura_paid',
        supplier: paymentModal.supplier,
        total: paymentModal.total,
        method: paymentMethod,
        reference: paymentRef,
        cfdi: paymentCFDI,
      },
    })

    setSavingPayment(false)
    setPaymentModal(null)
    showToast(`Pago registrado — ${paymentModal.supplier} ${formatMXN(paymentModal.total)}`)
    fetchData()
  }

  // ─── Approve factura ────────────────────────────────────────────────────

  const approveFactura = async (f: Factura) => {
    const staffName = (() => {
      try { const s = sessionStorage.getItem('pos_staff'); return s ? JSON.parse(s).name : 'Gerente' } catch { return 'Gerente' }
    })()
    await updateFacturaStatus(f.id, 'aprobada', { approved_by: staffName })
    showToast('Factura aprobada')
    fetchData()
  }

  // ─── Filtered lists for tabs ──────────────────────────────────────────

  const pendingReception = useMemo(() => orders.filter(o => o.status === 'enviada'), [orders])
  const pendingPayment = useMemo(() => facturas.filter(f => f.status !== 'pagada'), [facturas])

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <ShoppingCart size={24} className="text-purple-400" />
            <h1 className="text-xl font-bold">Compras</h1>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--text-3)]">
          <span>{orders.length} OC</span>
          <span>·</span>
          <span>{facturas.length} facturas</span>
        </div>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 bg-[var(--surface-2)]/30 border-b border-slate-700">
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-2.5">
          <p className="text-blue-400 text-xl font-bold">{kpis.borradores}</p>
          <p className="text-blue-400/70 text-xs">Borradores</p>
        </div>
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-2.5">
          <p className="text-amber-400 text-xl font-bold">{kpis.porRecibir}</p>
          <p className="text-amber-400/70 text-xs">Por recibir</p>
        </div>
        <div className="bg-purple-900/20 border border-purple-700/30 rounded-xl px-4 py-2.5">
          <p className="text-purple-400 text-xl font-bold">{kpis.porPagar}</p>
          <p className="text-purple-400/70 text-xs">Facturas por pagar</p>
        </div>
        <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-2.5">
          <p className="text-red-400 text-xl font-bold">{formatMXN(kpis.totalPendiente)}</p>
          <p className="text-red-400/70 text-xs">Deuda pendiente</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2 border-b border-slate-700">
        <button onClick={() => setTab('ordenes')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'ordenes' ? 'bg-purple-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-slate-600'}`}>
          <Truck size={14} className="inline mr-1.5 -mt-0.5" />Ordenes de Compra
        </button>
        <button onClick={() => setTab('recibir')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors relative ${tab === 'recibir' ? 'bg-amber-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-slate-600'}`}>
          <PackageCheck size={14} className="inline mr-1.5 -mt-0.5" />Recibir
          {kpis.porRecibir > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{kpis.porRecibir}</span>
          )}
        </button>
        <button onClick={() => setTab('facturas')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors relative ${tab === 'facturas' ? 'bg-purple-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-slate-600'}`}>
          <Receipt size={14} className="inline mr-1.5 -mt-0.5" />Facturas por Pagar
          {kpis.porPagar > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-purple-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{kpis.porPagar}</span>
          )}
        </button>
        <div className="flex-1" />
        <button onClick={() => setTab('nueva-manual')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'nueva-manual' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-slate-600'}`}>
          <Plus size={14} className="inline mr-1.5 -mt-0.5" />Nueva Orden
        </button>
        <button onClick={() => setTab('nueva')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'nueva' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-slate-600'}`}>
          <Sparkles size={14} className="inline mr-1.5 -mt-0.5" />OC con IA
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
            <div className="flex items-center justify-center h-full text-[var(--text-2)]">
              <div className="text-center">
                <ShoppingCart size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-xl">Sin ordenes de compra</p>
                <div className="flex gap-3 mt-4 justify-center">
                  <button onClick={() => setTab('nueva-manual')} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm">
                    <Plus size={14} className="inline mr-1.5" />Nueva Orden
                  </button>
                  <button onClick={() => setTab('nueva')} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white text-sm">
                    <Sparkles size={14} className="inline mr-1.5" />Crear con IA
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {orders.map(po => {
                const config = STATUS_CONFIG[po.status] || STATUS_CONFIG.borrador
                const isOpen = expanded === po.id
                return (
                  <div key={po.id}>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-[var(--surface-2)]/50 transition-colors">
                      <button onClick={() => toggleExpand(po.id)} className="w-8 h-8 rounded-lg bg-[var(--line)] flex items-center justify-center">
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{po.supplier}</span>
                          <span className="text-[var(--text-2)] text-xs font-mono">{po.id.slice(0, 8)}</span>
                          {po.ai_suggested && <Sparkles size={12} className="text-amber-400" />}
                        </div>
                        <p className="text-[var(--text-3)] text-sm">
                          Por: {po.created_by} · {new Date(po.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
                          {po.received_by && ` · Recibido: ${po.received_by}`}
                        </p>
                      </div>
                      <p className="font-semibold text-white">{formatMXN(po.total)}</p>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>{config.label}</span>

                      {/* Action buttons based on status */}
                      <div className="flex items-center gap-2">
                        {po.status === 'borrador' && (
                          <>
                            <button onClick={() => sendOC(po)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                              <Send size={14} />Enviar
                            </button>
                            <button onClick={() => cancelOC(po)} className="w-8 h-8 bg-red-900/30 hover:bg-red-900/60 rounded-lg flex items-center justify-center text-red-400">
                              <X size={14} />
                            </button>
                          </>
                        )}
                        {po.status === 'enviada' && (
                          <>
                            <button onClick={() => openReception(po)} className="px-3 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                              <PackageCheck size={14} />Recibir
                            </button>
                            <button onClick={() => cancelOC(po)} className="w-8 h-8 bg-red-900/30 hover:bg-red-900/60 rounded-lg flex items-center justify-center text-red-400">
                              <X size={14} />
                            </button>
                          </>
                        )}
                        {po.status === 'recibida' && (
                          <button onClick={() => setFacturaModal(po)} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                            <Receipt size={14} />Factura
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded items */}
                    {isOpen && (
                      <div className="px-6 pb-4">
                        <div className="bg-[var(--surface-2)]/60 rounded-xl overflow-hidden ml-12">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-[var(--text-3)] border-b border-slate-700">
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
                                  <td className="px-4 py-2.5 text-right text-[var(--text-4)]">{item.quantity_ordered}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-4)]">{item.quantity_received ?? '---'}</td>
                                  <td className="px-4 py-2.5 text-[var(--text-3)]">{item.unit}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-3)]">{formatMXN(item.unit_cost)}</td>
                                  <td className="px-4 py-2.5 text-right text-white font-medium">{formatMXN(item.total_cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-slate-600">
                                <td colSpan={5} className="px-4 py-2.5 text-right text-[var(--text-3)] font-medium">Subtotal</td>
                                <td className="px-4 py-2.5 text-right text-white font-medium">{formatMXN(expandedItems.reduce((s, i) => s + i.total_cost, 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : tab === 'recibir' ? (
          /* ─── Recibir Tab ─── */
          pendingReception.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-2)]">
              <div className="text-center">
                <PackageCheck size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-xl">Sin ordenes por recibir</p>
                <p className="text-sm mt-1 text-[var(--text-3)]">Las ordenes con status &quot;Enviada&quot; aparecen aqui</p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <PackageCheck size={20} className="text-amber-400" />
                <h2 className="text-lg font-bold">Ordenes pendientes de recepcion</h2>
                <span className="text-[var(--text-3)] text-sm">{pendingReception.length} orden(es)</span>
              </div>
              {pendingReception.map(po => {
                const daysSinceSent = po.sent_at ? Math.floor((Date.now() - new Date(po.sent_at).getTime()) / 86400000) : null
                return (
                  <div key={po.id} className="bg-[var(--surface-2)]/60 border border-amber-700/30 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-amber-900/30 flex items-center justify-center">
                          <Truck size={24} className="text-amber-400" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white text-lg">{po.supplier}</h3>
                          <p className="text-[var(--text-3)] text-sm">
                            OC {po.id.slice(0, 8)} · {formatMXN(po.total)}
                            {daysSinceSent !== null && (
                              <span className={daysSinceSent > 3 ? 'text-red-400 ml-2' : 'ml-2'}>
                                · Enviada hace {daysSinceSent} dia{daysSinceSent !== 1 ? 's' : ''}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => openReception(po)}
                        className="px-5 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl text-white font-semibold flex items-center gap-2"
                      >
                        <PackageCheck size={18} />Recibir mercancia
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : tab === 'facturas' ? (
          /* ─── Facturas por Pagar ─── */
          pendingPayment.length === 0 && facturas.filter(f => f.status === 'pagada').length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-2)]">
              <div className="text-center">
                <Receipt size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-xl">Sin facturas</p>
                <p className="text-sm mt-1">Las facturas se crean al recibir una OC</p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Pending payment */}
              {pendingPayment.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <DollarSign size={20} className="text-red-400" />
                    <h2 className="text-lg font-bold">Por pagar</h2>
                    <span className="text-[var(--text-3)] text-sm">
                      {pendingPayment.length} factura(s) · {formatMXN(pendingPayment.reduce((s, f) => s + f.total, 0))}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {pendingPayment.map(f => {
                      const config = FACTURA_STATUS[f.status] || FACTURA_STATUS.capturada
                      const daysSince = Math.floor((Date.now() - new Date(f.created_at).getTime()) / 86400000)
                      return (
                        <div key={f.id} className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                              <Receipt size={18} className="text-purple-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white">{f.supplier}</span>
                                {f.folio && <span className="text-[var(--text-2)] text-xs font-mono">Folio: {f.folio}</span>}
                                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>{config.label}</span>
                              </div>
                              <p className="text-[var(--text-3)] text-sm">
                                Capturada: {f.captured_by}
                                {f.approved_by && ` · Aprobada: ${f.approved_by}`}
                                {f.purchase_order_id && ` · OC: ${f.purchase_order_id.slice(0, 6)}`}
                                <span className={daysSince > 15 ? 'text-red-400 ml-2' : daysSince > 7 ? 'text-amber-400 ml-2' : 'ml-2'}>
                                  · {daysSince} dia{daysSince !== 1 ? 's' : ''} desde captura
                                </span>
                              </p>
                            </div>
                            <p className="font-bold text-white text-lg">{formatMXN(f.total)}</p>
                            <div className="flex items-center gap-2">
                              {f.status === 'capturada' && (
                                <button onClick={() => approveFactura(f)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white flex items-center gap-1.5">
                                  <Check size={14} />Aprobar
                                </button>
                              )}
                              <button
                                onClick={() => openPaymentModal(f)}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-semibold flex items-center gap-1.5"
                              >
                                <CreditCard size={14} />Registrar Pago
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Paid history */}
              {facturas.filter(f => f.status === 'pagada').length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <Check size={20} className="text-emerald-400" />
                    <h2 className="text-lg font-bold text-[var(--text-3)]">Pagadas</h2>
                  </div>
                  <div className="space-y-2">
                    {facturas.filter(f => f.status === 'pagada').map(f => (
                      <div key={f.id} className="flex items-center gap-4 px-5 py-3 bg-[var(--surface-2)]/30 rounded-xl opacity-70">
                        <div className="w-8 h-8 rounded-lg bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <Check size={14} className="text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-white text-sm">{f.supplier}</span>
                          {f.folio && <span className="text-[var(--text-2)] text-xs ml-2">Folio: {f.folio}</span>}
                        </div>
                        <p className="text-emerald-400 text-sm font-medium">{formatMXN(f.total)}</p>
                        <span className="text-[var(--text-2)] text-xs">
                          {f.paid_at ? new Date(f.paid_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : tab === 'nueva-manual' ? (
          /* ─── Manual New OC ─── */
          <ManualOCPanel onCreated={() => { setTab('ordenes'); fetchData() }} showToast={showToast} />
        ) : (
          /* ─── Nueva OC con IA ─── */
          <NewOCPanel onCreated={() => { setTab('ordenes'); fetchData() }} showToast={showToast} />
        )}
      </div>

      {/* Reception Modal */}
      {receptionPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReceptionPO(null)} />
          <div className="relative bg-[var(--surface-2)] border border-amber-700/40 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl mx-4">
            {/* Header */}
            <div className="sticky top-0 bg-[var(--surface-2)] border-b border-slate-700 px-6 py-4 rounded-t-2xl z-10">
              <div className="flex items-center gap-3">
                <PackageCheck size={24} className="text-amber-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Recepcion de mercancia</h3>
                  <p className="text-amber-400 text-sm">{receptionPO.supplier} · OC {receptionPO.id.slice(0, 8)}</p>
                </div>
              </div>
              <p className="text-[var(--text-3)] text-sm mt-2">Verifica cada producto contra lo que llego fisicamente. Si algo no coincide, ajusta la cantidad y escribe el motivo.</p>
            </div>

            {/* Items table */}
            <div className="px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-3)] border-b border-slate-700">
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
                    return (
                      <tr key={item.id} className={`border-b border-slate-700/50 ${!matches ? 'bg-amber-950/20' : ''}`}>
                        <td className="px-3 py-3 text-white font-medium">{item.ingredient_name}</td>
                        <td className="px-3 py-3 text-right text-[var(--text-4)]">{item.quantity_ordered}</td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={item.qty_received}
                            onChange={e => updateReceivedQty(item.id, Number(e.target.value))}
                            className={`w-24 bg-[var(--line)] border rounded px-2 py-1.5 text-right text-sm focus:outline-none ${
                              matches ? 'border-slate-600 text-white focus:border-emerald-500' :
                              isShort ? 'border-red-600 text-red-400 focus:border-red-500' :
                              'border-amber-600 text-amber-400 focus:border-amber-500'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-3 text-[var(--text-3)]">{item.unit}</td>
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
                              className="w-full bg-[var(--line)] border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
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
                const itemCount = receptionItems.filter(i => i.qty_received > 0).length
                return (
                  <div className="mt-4 p-4 bg-[var(--line)]/50 rounded-xl">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-[var(--text-3)]">Total OC original</span>
                      <span className="text-[var(--text-4)]">{formatMXN(receptionPO.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-[var(--text-3)]">Total recibido (+ IVA)</span>
                      <span className={`font-semibold ${receivedTotal * 1.16 < receptionPO.total ? 'text-amber-400' : 'text-white'}`}>
                        {formatMXN(receivedTotal * 1.16)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-emerald-400">Items a dar de alta en inventario</span>
                      <span className="text-emerald-400 font-semibold">{itemCount} item(s)</span>
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
                <label className="text-sm text-[var(--text-3)] block mb-1">Recibido por</label>
                <input
                  type="text"
                  value={receptionBy}
                  onChange={e => setReceptionBy(e.target.value)}
                  placeholder="Nombre del almacenista..."
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="mt-3">
                <label className="text-sm text-[var(--text-3)] block mb-1">Notas de recepcion</label>
                <input
                  type="text"
                  value={receptionNotes}
                  onChange={e => setReceptionNotes(e.target.value)}
                  placeholder="Notas opcionales..."
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-[var(--surface-2)] border-t border-slate-700 px-6 py-4 flex gap-3 rounded-b-2xl">
              <button onClick={() => setReceptionPO(null)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-slate-600 text-[var(--text-4)] font-semibold">
                Cancelar
              </button>
              <button
                onClick={handleConfirmReception}
                disabled={!receptionBy.trim() || savingReception}
                className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold flex items-center justify-center gap-2"
              >
                <PackageCheck size={18} />
                {savingReception ? 'Guardando...' : 'Confirmar recepcion y dar de alta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factura capture modal */}
      {facturaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setFacturaModal(null)} />
          <div className="relative bg-[var(--surface-2)] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
            <div className="flex items-center gap-3 mb-4">
              <Receipt size={24} className="text-purple-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Capturar factura</h3>
                <p className="text-[var(--text-3)] text-sm">{facturaModal.supplier} · {formatMXN(facturaModal.total)}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Folio de factura / CFDI</label>
                <input type="text" value={facturaFolio} onChange={e => setFacturaFolio(e.target.value)} placeholder="Ej. FAC-2024-001 o UUID CFDI"
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500" />
              </div>
              <div className="bg-[var(--line)]/50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--text-3)]">Subtotal</span>
                  <span className="text-white">{formatMXN(facturaModal.subtotal)}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--text-3)]">IVA 16%</span>
                  <span className="text-white">{formatMXN(facturaModal.iva)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-white">Total</span>
                  <span className="text-white">{formatMXN(facturaModal.total)}</span>
                </div>
              </div>
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Notas</label>
                <input type="text" value={facturaNotes} onChange={e => setFacturaNotes(e.target.value)} placeholder="Notas opcionales..."
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFacturaModal(null)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-slate-600 text-[var(--text-4)] font-semibold">Cancelar</button>
              <button onClick={handleCreateFactura} className="flex-[2] py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center justify-center gap-2">
                <Receipt size={18} />Capturar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPaymentModal(null)} />
          <div className="relative bg-[var(--surface-2)] border border-emerald-700/40 rounded-2xl w-full max-w-lg shadow-2xl mx-4">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <CreditCard size={24} className="text-emerald-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Registrar pago</h3>
                  <p className="text-emerald-400 text-sm">{paymentModal.supplier}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Amount summary */}
              <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-4">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-3)]">Monto a pagar</span>
                  <span className="text-2xl font-bold text-emerald-400">{formatMXN(paymentModal.total)}</span>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-[var(--text-3)]">
                  <span>Subtotal: {formatMXN(paymentModal.subtotal)}</span>
                  <span>IVA: {formatMXN(paymentModal.iva)}</span>
                </div>
              </div>

              {/* Payment date */}
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Fecha de pago</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Metodo de pago</label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setPaymentMethod(m.value)}
                      className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors border ${
                        paymentMethod === m.value
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-[var(--line)] border-slate-600 text-[var(--text-4)] hover:bg-slate-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference number */}
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">
                  {paymentMethod === 'transferencia' ? 'No. de referencia' :
                   paymentMethod === 'cheque' ? 'No. de cheque' :
                   'Referencia de pago'}
                </label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={e => setPaymentRef(e.target.value)}
                  placeholder={
                    paymentMethod === 'transferencia' ? 'Ej. REF-123456' :
                    paymentMethod === 'cheque' ? 'Ej. CHQ-7890' :
                    'Referencia opcional'
                  }
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* CFDI folio */}
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Folio CFDI del proveedor</label>
                <input
                  type="text"
                  value={paymentCFDI}
                  onChange={e => setPaymentCFDI(e.target.value)}
                  placeholder="UUID de la factura del proveedor..."
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm text-[var(--text-3)] block mb-1">Notas</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  placeholder="Notas opcionales del pago..."
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-700 flex gap-3">
              <button onClick={() => setPaymentModal(null)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-slate-600 text-[var(--text-4)] font-semibold">
                Cancelar
              </button>
              <button
                onClick={handlePayFactura}
                disabled={savingPayment}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold flex items-center justify-center gap-2"
              >
                <CreditCard size={18} />
                {savingPayment ? 'Procesando...' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Manual Purchase Order Panel ─────────────────────────────────────────────

interface ManualLineItem {
  id: string
  name: string
  quantity: number
  unit: string
  unit_cost: number
}

function ManualOCPanel({ onCreated, showToast }: { onCreated: () => void; showToast: (msg: string) => void }) {
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // Form state
  const [supplier, setSupplier] = useState('')
  const [customSupplier, setCustomSupplier] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ManualLineItem[]>([
    { id: generateId(), name: '', quantity: 1, unit: 'kg', unit_cost: 0 },
  ])

  useEffect(() => {
    (async () => {
      setLoading(true)
      const s = await getSuppliers()
      setSuppliers(s)
      setLoading(false)
    })()
  }, [])

  const addItem = () => {
    setItems(prev => [...prev, { id: generateId(), name: '', quantity: 1, unit: 'kg', unit_cost: 0 }])
  }

  const removeItem = (id: string) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const updateItem = (id: string, field: keyof ManualLineItem, value: string | number) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ))
  }

  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_cost), 0)
  const iva = subtotal * IVA_RATE
  const total = subtotal + iva

  const effectiveSupplier = supplier === '__custom__' ? customSupplier.trim() : supplier

  const canSubmit = effectiveSupplier && createdBy.trim() && items.every(i => i.name.trim() && i.quantity > 0 && i.unit_cost > 0)

  const handleCreate = async () => {
    if (!canSubmit) return
    setCreating(true)

    const ocItems = items.map(item => ({
      ingredient_id: item.name.toLowerCase().replace(/\s+/g, '_').slice(0, 40),
      ingredient_name: item.name.trim(),
      quantity_ordered: item.quantity,
      unit: item.unit,
      unit_cost: item.unit_cost,
      total_cost: item.quantity * item.unit_cost,
    }))

    const ok = await createPurchaseOrder({
      id: generateId(),
      supplier: effectiveSupplier,
      created_by: createdBy.trim(),
      notes: notes.trim() || undefined,
      subtotal, iva, total,
      ai_suggested: false,
      items: ocItems,
    })

    setCreating(false)
    if (ok) {
      showToast(`OC creada para ${effectiveSupplier} — ${items.length} items`)
      onCreated()
    } else {
      showToast('Error al crear la orden de compra')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={20} className="text-emerald-400" />
        <h2 className="text-lg font-bold">Nueva orden de compra</h2>
      </div>

      <div className="space-y-5">
        {/* Supplier + Created by */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-[var(--text-3)] block mb-1">Proveedor *</label>
            <select
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Selecciona proveedor...</option>
              {suppliers.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="__custom__">+ Otro proveedor</option>
            </select>
            {supplier === '__custom__' && (
              <input
                type="text"
                value={customSupplier}
                onChange={e => setCustomSupplier(e.target.value)}
                placeholder="Nombre del proveedor..."
                className="w-full mt-2 bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>
          <div>
            <label className="text-sm text-[var(--text-3)] block mb-1">Creada por *</label>
            <input
              type="text"
              value={createdBy}
              onChange={e => setCreatedBy(e.target.value)}
              placeholder="Nombre del responsable..."
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm text-[var(--text-3)] block mb-1">Notas</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notas opcionales para el proveedor..."
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-[var(--text-3)] font-medium">Productos *</label>
            <button
              onClick={addItem}
              className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-600/30 rounded-lg text-sm text-emerald-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus size={14} />Agregar linea
            </button>
          </div>

          <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_100px_100px_100px_80px_40px] gap-2 px-4 py-2.5 text-xs text-[var(--text-3)] font-medium border-b border-slate-700">
              <span>Producto</span>
              <span className="text-right">Cantidad</span>
              <span>Unidad</span>
              <span className="text-right">Precio/u</span>
              <span className="text-right">Total</span>
              <span></span>
            </div>

            {/* Items */}
            {items.map((item, idx) => (
              <div key={item.id} className="grid grid-cols-[1fr_100px_100px_100px_80px_40px] gap-2 px-4 py-2 items-center border-b border-slate-700/50 last:border-0">
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateItem(item.id, 'name', e.target.value)}
                  placeholder="Nombre del producto..."
                  className="bg-[var(--line)] border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="number"
                  value={item.quantity || ''}
                  onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                  step="0.01"
                  min="0"
                  className="bg-[var(--line)] border border-slate-600 rounded px-3 py-2 text-white text-right text-sm focus:outline-none focus:border-emerald-500"
                />
                <select
                  value={item.unit}
                  onChange={e => updateItem(item.id, 'unit', e.target.value)}
                  className="bg-[var(--line)] border border-slate-600 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="kg">kg</option>
                  <option value="lt">lt</option>
                  <option value="pza">pza</option>
                  <option value="caja">caja</option>
                  <option value="paquete">paquete</option>
                  <option value="bolsa">bolsa</option>
                  <option value="galon">galon</option>
                  <option value="rollo">rollo</option>
                </select>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-xs">$</span>
                  <input
                    type="number"
                    value={item.unit_cost || ''}
                    onChange={e => updateItem(item.id, 'unit_cost', Number(e.target.value))}
                    step="0.01"
                    min="0"
                    className="w-full bg-[var(--line)] border border-slate-600 rounded pl-5 pr-2 py-2 text-white text-right text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <span className="text-right text-white text-sm font-medium">
                  {formatMXN(item.quantity * item.unit_cost)}
                </span>
                <button
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-900/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-xl p-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[var(--text-3)]">Subtotal ({items.filter(i => i.name.trim()).length} items)</span>
            <span className="text-white font-medium">{formatMXN(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[var(--text-3)]">IVA 16%</span>
            <span className="text-white font-medium">{formatMXN(iva)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-slate-700">
            <span className="text-white">Total</span>
            <span className="text-emerald-400">{formatMXN(total)}</span>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            disabled={!canSubmit || creating}
            className="flex-1 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold flex items-center justify-center gap-2 text-lg transition-colors"
          >
            {creating ? (
              <>
                <RefreshCw size={20} className="animate-spin" />Creando...
              </>
            ) : (
              <>
                <ClipboardList size={20} />Crear Orden de Compra
              </>
            )}
          </button>
        </div>
      </div>
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
    const iva = subtotal * IVA_RATE
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
          <p className="text-[var(--text-3)] text-sm">Analizando inventario...</p>
        </div>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-2)]">
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
        <span className="text-[var(--text-3)] text-sm">Basado en punto de reorden — ajusta cantidades antes de enviar</span>
      </div>

      {suggestions.map(s => {
        const items = s.items.filter(item => (editQty[s.supplier]?.[item.ingredient_id] ?? item.suggested_qty) > 0)
        const totalCost = items.reduce((sum, item) => {
          const qty = editQty[s.supplier]?.[item.ingredient_id] ?? item.suggested_qty
          return sum + qty * item.unit_cost
        }, 0)

        return (
          <div key={s.supplier} className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div>
                <h3 className="font-bold text-white text-lg">{s.supplier}</h3>
                <p className="text-[var(--text-3)] text-sm">{s.items.length} ingredientes bajo stock</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-semibold text-white">{formatMXN(totalCost)}</p>
                <button
                  onClick={() => createOCForSupplier(s.supplier)}
                  disabled={creating}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] rounded-lg text-sm text-white font-semibold flex items-center gap-1.5"
                >
                  <Plus size={14} />Crear OC
                </button>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-3)] border-b border-slate-700">
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
                      <td className="px-3 py-2.5 text-right text-[var(--text-3)]">{item.reorder_point}</td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number"
                          value={qty}
                          onChange={e => updateQty(s.supplier, item.ingredient_id, Number(e.target.value))}
                          className="w-20 bg-[var(--line)] border border-slate-600 rounded px-2 py-1 text-white text-right text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-3)]">{item.unit}</td>
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
