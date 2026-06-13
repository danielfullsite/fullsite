'use client'

// Inventario Market — stock por unidad de productos retail (categorías mkt-*).
// A diferencia de cocina/barra (recetas → insumos), aquí 1 venta = -1 unidad.
// El descuento automático ocurre al cobrar (pos/page.tsx → deductMarketStockForOrder).

import { useState, useEffect, useCallback } from 'react'
import { Search, ArrowLeft, Check, PackagePlus, Trash2, SlidersHorizontal, ScanBarcode } from 'lucide-react'
import BarcodeScanner from '@/components/BarcodeScanner'
import Link from 'next/link'
import {
  getMarketMenuItems,
  getMarketStock,
  getMarketMovements,
  registerMarketMovement,
  upsertMarketStock,
  logAudit,
  type MarketMenuItemLite,
  type MarketMovement,
} from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'

const MOTIVOS_MERMA = ['Caducado', 'Dañado', 'Robo / faltante', 'Degustación', 'Otro']

interface Row extends MarketMenuItemLite {
  stock: number
  reorder_point: number
  hasStockRow: boolean
}

type ModalType = 'entrada' | 'merma' | 'ajuste'

export default function InventarioMarketPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [movements, setMovements] = useState<MarketMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyAlerts, setOnlyAlerts] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [toast, setToast] = useState('')

  // Modal state
  const [modal, setModal] = useState<{ type: ModalType; item: Row } | null>(null)
  const [qty, setQty] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS_MERMA[0])
  const [reorderPoint, setReorderPoint] = useState('')
  const [saving, setSaving] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const load = useCallback(async () => {
    const [items, stock, movs] = await Promise.all([
      getMarketMenuItems(),
      getMarketStock(),
      getMarketMovements(30),
    ])
    const stockMap = new Map(stock.map(s => [s.menu_item_id, s]))
    const nameById = new Map(items.map(i => [i.id, i.name]))
    setRows(items.map(i => {
      const s = stockMap.get(i.id)
      return {
        ...i,
        stock: s?.stock ?? 0,
        reorder_point: s?.reorder_point ?? 0,
        hasStockRow: !!s,
      }
    }))
    setMovements(movs.map(m => ({ ...m, item_name: nameById.get(m.menu_item_id) ?? m.menu_item_id })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (onlyAlerts && !(r.hasStockRow && r.stock <= r.reorder_point)) return false
    if (!q) return true
    // Barcode scan: match exacto primero, luego nombre parcial
    return (r.barcode ?? '').toLowerCase() === q || r.name.toLowerCase().includes(q)
  })

  const alerts = rows.filter(r => r.hasStockRow && r.stock <= r.reorder_point)
  const conStock = rows.filter(r => r.stock > 0)
  const valorStock = rows.reduce((s, r) => s + r.stock * r.price, 0)

  const openModal = (type: ModalType, item: Row) => {
    setModal({ type, item })
    setQty(type === 'ajuste' ? String(item.stock) : '')
    setMotivo(MOTIVOS_MERMA[0])
    setReorderPoint(String(item.reorder_point))
  }

  const handleSubmit = async () => {
    if (!modal || saving) return
    const n = Number(qty)
    if (!Number.isFinite(n) || n < 0 || (modal.type !== 'ajuste' && n === 0)) return
    setSaving(true)
    try {
      const notes = modal.type === 'merma' ? motivo
        : modal.type === 'ajuste' ? 'Ajuste manual de stock'
        : 'Entrada de mercancía'
      const { ok, newStock } = await registerMarketMovement(modal.item.id, modal.type, n, 'almacén', notes)

      // Punto de reorden (si cambió)
      const rp = Number(reorderPoint)
      if (ok && Number.isFinite(rp) && rp >= 0 && rp !== modal.item.reorder_point) {
        await upsertMarketStock(modal.item.id, { stock: newStock, reorder_point: rp })
      }

      if (ok) {
        logAudit({
          action: 'inventory_adjusted',
          actor: 'almacén',
          details: { scope: 'market', type: modal.type, item: modal.item.name, qty: n, newStock, motivo: modal.type === 'merma' ? motivo : undefined },
        })
        showToast(`${modal.item.name}: stock ${newStock}`)
        setModal(null)
        await load()
      } else {
        showToast('Error al guardar — ¿existe la tabla pos_market_stock?')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Inventario Market</h2>
          <p className="text-sm text-[var(--text-3)]">Stock por unidad — se descuenta solo al cobrar</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Productos Market</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{rows.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Con stock</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{conStock.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Valor a precio venta</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(valorStock)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">En punto de reorden</p>
          <p className={`text-2xl font-bold ${alerts.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{alerts.length}</p>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="Buscar producto o escanear barcode..."
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500" />
        </div>
        <button onClick={() => setShowScanner(true)}
          className="px-4 py-2 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--line)] flex items-center gap-1.5"
          title="Escanear código de barras">
          <ScanBarcode size={16} /> Scan
        </button>
        <button onClick={() => setOnlyAlerts(!onlyAlerts)}
          className={`px-4 py-2 rounded-lg text-xs font-medium ${onlyAlerts ? 'bg-amber-500 text-black' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
          {onlyAlerts ? `Reorden (${alerts.length})` : 'Solo reorden'}
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Producto</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Precio</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Stock</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Reorden</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {filtered.slice(0, 100).map(r => {
              const low = r.hasStockRow && r.stock <= r.reorder_point
              return (
                <tr key={r.id} className={low ? 'bg-amber-500/5' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm text-[var(--text-1)]">{r.name}</p>
                    <p className="text-[11px] text-[var(--text-3)]">{r.category_id}{r.barcode ? ` · ${r.barcode}` : ''}</p>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-[var(--text-2)] text-right tabular-nums">{formatCurrency(r.price)}</td>
                  <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-semibold ${low ? 'text-amber-400' : r.stock > 0 ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}>
                    {r.hasStockRow || r.stock > 0 ? r.stock : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-[var(--text-3)] text-right tabular-nums">{r.reorder_point || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => openModal('entrada', r)} title="Entrada"
                        className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"><PackagePlus size={14} /></button>
                      <button onClick={() => openModal('merma', r)} title="Merma"
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"><Trash2 size={14} /></button>
                      <button onClick={() => openModal('ajuste', r)} title="Ajustar"
                        className="p-1.5 rounded-lg bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)]"><SlidersHorizontal size={14} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--text-3)]">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Movimientos recientes */}
      <h3 className="text-sm font-semibold text-[var(--text-2)] mb-2">Movimientos recientes</h3>
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <tbody className="divide-y divide-[var(--line-soft)]">
            {movements.map(m => (
              <tr key={m.id}>
                <td className="px-4 py-2 text-xs text-[var(--text-3)] whitespace-nowrap">{new Date(m.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-4 py-2 text-sm text-[var(--text-1)]">{m.item_name}</td>
                <td className="px-4 py-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${
                    m.movement_type === 'venta' ? 'bg-blue-500/10 text-blue-400'
                    : m.movement_type === 'entrada' ? 'bg-emerald-500/10 text-emerald-400'
                    : m.movement_type === 'merma' ? 'bg-red-500/10 text-red-400'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)]'
                  }`}>{m.movement_type}</span>
                </td>
                <td className={`px-4 py-2 text-sm text-right tabular-nums font-semibold ${m.quantity < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {m.quantity > 0 ? '+' : ''}{m.quantity}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--text-3)]">{m.notes ?? ''}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-sm text-[var(--text-3)]">Sin movimientos aún</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal entrada / merma / ajuste */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !saving && setModal(null)}>
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-1 capitalize">{modal.type}</h3>
            <p className="text-sm text-[var(--text-3)] mb-4">{modal.item.name} — stock actual: {modal.item.stock}</p>

            <label className="block text-xs text-[var(--text-3)] mb-1">
              {modal.type === 'entrada' ? 'Unidades que entran' : modal.type === 'merma' ? 'Unidades de merma' : 'Stock final (conteo real)'}
            </label>
            <input type="number" inputMode="numeric" min="0" value={qty} onChange={e => setQty(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 mb-3 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500" />

            {modal.type === 'merma' && (
              <>
                <label className="block text-xs text-[var(--text-3)] mb-1">Motivo</label>
                <select value={motivo} onChange={e => setMotivo(e.target.value)}
                  className="w-full px-3 py-2.5 mb-3 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none">
                  {MOTIVOS_MERMA.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </>
            )}

            <label className="block text-xs text-[var(--text-3)] mb-1">Punto de reorden</label>
            <input type="number" inputMode="numeric" min="0" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)}
              className="w-full px-3 py-2.5 mb-5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500" />

            <div className="flex gap-3">
              <button onClick={() => setModal(null)} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[var(--surface-2)] text-[var(--text-2)] text-sm font-medium">Cancelar</button>
              <button onClick={handleSubmit} disabled={saving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 ${
                  modal.type === 'merma' ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
                }`}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-1)] shadow-lg flex items-center gap-2 z-50">
          <Check size={14} className="text-emerald-400" /> {toast}
        </div>
      )}

      {showScanner && (
        <BarcodeScanner
          onScan={(code) => {
            setSearch(code)
            setShowScanner(false)
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
