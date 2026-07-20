'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Plus, Trash2, Search, Save, PackageCheck, Loader2 } from 'lucide-react'
import { getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost, sbGet } from '@/lib/supabase-helpers'
import { recordMovement, loadInventoryWithStock, makeIdempotencyKey } from '@/lib/inventory'
import type { MovementResult } from '@/lib/inventory'

// ── Types ───────────────────────────────────────────────────────────

interface Supplier {
  id: string
  name: string
  rfc: string | null
  phone: string | null
  giro: string | null
}

interface InventoryProduct {
  ingredient_id: string
  name: string
  unit: string
  cost_per_unit: number
  stock: number
  category: string | null
}

interface LineItem {
  id: string
  ingredient_id: string
  name: string
  unit: string
  current_cost: number
  current_stock: number
  quantity: number
  unitCost: number
}

// ── Helpers ─────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function nowKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

// ── Component ───────────────────────────────────────────────────────

export default function EntradasPage() {
  // Data sources
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false)
  const [fecha, setFecha] = useState(todayStr())
  const [productSearch, setProductSearch] = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [items, setItems] = useState<LineItem[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'duplicate'; text: string } | null>(null)

  const supplierRef = useRef<HTMLDivElement>(null)
  const productRef = useRef<HTMLDivElement>(null)

  // ── Load catalogs from canonical sources ─────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()

        const [invData, suppData] = await Promise.all([
          loadInventoryWithStock(clientId),
          sbGet<Supplier[]>('pos_suppliers', clientId, {
            select: 'id,name,rfc,phone,giro',
            order: 'name.asc',
            limit: '500',
          }),
        ])

        setProducts(invData.map(r => ({
          ingredient_id: r.ingredient_id,
          name: r.name,
          unit: r.unit,
          cost_per_unit: r.cost_per_unit,
          stock: r.stock,
          category: r.category,
        })))

        if (Array.isArray(suppData)) {
          setSuppliers(suppData)
        }
      } catch (err) {
        console.error('[Entradas] Error loading catalogs:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Click outside handlers ──────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false)
      }
      if (productRef.current && !productRef.current.contains(e.target as Node)) {
        setProductDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Filtered lists ──────────────────────────────────────────────

  const filteredSuppliers = suppliers.filter(s => {
    const q = supplierSearch.toLowerCase()
    if (!q) return true
    return (s.name || '').toLowerCase().includes(q) ||
           (s.rfc || '').toLowerCase().includes(q) ||
           (s.giro || '').toLowerCase().includes(q)
  }).slice(0, 50)

  const addedIds = new Set(items.map(i => i.ingredient_id))
  const filteredProducts = products.filter(p => {
    if (addedIds.has(p.ingredient_id)) return false
    const q = productSearch.toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) ||
           p.ingredient_id.toLowerCase().includes(q) ||
           (p.category || '').toLowerCase().includes(q)
  }).slice(0, 50)

  // ── Actions ─────────────────────────────────────────────────────

  const selectSupplier = useCallback((s: Supplier) => {
    setSelectedSupplier(s)
    setSupplierSearch(s.name)
    setSupplierDropdownOpen(false)
  }, [])

  const addProduct = useCallback((p: InventoryProduct) => {
    setItems(prev => [...prev, {
      id: uid(),
      ingredient_id: p.ingredient_id,
      name: p.name,
      unit: p.unit,
      current_cost: p.cost_per_unit,
      current_stock: p.stock,
      quantity: 1,
      unitCost: p.cost_per_unit, // pre-fill with current cost
    }])
    setProductSearch('')
    setProductDropdownOpen(false)
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateItem = useCallback((id: string, field: 'quantity' | 'unitCost', value: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }, [])

  const grandTotal = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0)

  // ── Save ────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedSupplier || items.length === 0) return
    setSaving(true)
    setSaveMessage(null)

    const clientId = getActiveClientSlug()
    const timestamp = nowKey()
    const supplierKey = selectedSupplier.id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
    const idempotencyKey = makeIdempotencyKey('entry', 'dashboard', timestamp, supplierKey)

    try {
      // ── 1. Record movements (updates pos_inventory + cost + ledger) ──
      const movResult: MovementResult = await recordMovement({
        client_id: clientId,
        movement_type: 'entry',
        actor: 'dashboard',
        idempotency_key: idempotencyKey,
        metadata: {
          supplier_id: selectedSupplier.id,
          supplier_name: selectedSupplier.name,
          supplier_rfc: selectedSupplier.rfc,
          fecha,
        },
        lines: items.map(i => ({
          ingredient_id: i.ingredient_id,
          quantity: Math.abs(i.quantity),   // entries are always positive
          unit_cost: i.unitCost,
          notes: `Proveedor: ${selectedSupplier!.name}${notes ? ' | ' + notes : ''}`,
        })),
      })

      if (movResult.was_duplicate) {
        setSaveMessage({ type: 'duplicate', text: 'Esta entrada ya fue registrada anteriormente.' })
        setItems([])
        setSaving(false)
        return
      }

      if (!movResult.success) {
        setSaveMessage({ type: 'error', text: `Error: ${movResult.errors.join(', ')}` })
        setSaving(false)
        return
      }

      // ── 2. Save historical blob (wansoft_data, for traceability) ──
      const payload = {
        supplier: {
          id: selectedSupplier.id,
          name: selectedSupplier.name,
          rfc: selectedSupplier.rfc,
        },
        fecha,
        items: items.map((i, idx) => ({
          ingredient_id: i.ingredient_id,
          name: i.name,
          unit: i.unit,
          quantity: i.quantity,
          unitCost: i.unitCost,
          total: i.quantity * i.unitCost,
          cost_before: i.current_cost,
          cost_after: movResult.details[idx]?.cost_after ?? i.current_cost,
          stock_before: i.current_stock,
          stock_after: movResult.details[idx]?.stock_after ?? i.current_stock + i.quantity,
        })),
        grandTotal,
        notes,
        idempotency_key: idempotencyKey,
        movements_created: movResult.movements_created,
        stock_updates: movResult.stock_updates,
        cost_updates: movResult.cost_updates,
        created_at: new Date().toISOString(),
      }

      await sbPost('wansoft_data', clientId, {
        data_key: `inventory_entry_${timestamp}`,
        fecha,
        data: payload,
      })

      const costNote = movResult.cost_updates > 0
        ? ` ${movResult.cost_updates} costos actualizados.`
        : ''

      setSaveMessage({
        type: 'success',
        text: `Entrada registrada: ${items.length} productos por ${formatCurrency(grandTotal)}. Stock actualizado.${costNote}`,
      })

      // Reset form
      setItems([])
      setNotes('')
      setSelectedSupplier(null)
      setSupplierSearch('')
      setFecha(todayStr())
    } catch {
      setSaveMessage({ type: 'error', text: 'Error de red. Verifica tu conexion.' })
    }
    setSaving(false)
  }

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-3)]">
        <Loader2 className="animate-spin" size={20} />
        Cargando catalogos...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Entrada de Mercancia"
        subtitle={`${products.length} productos disponibles · ${suppliers.length} proveedores`}
        eyebrow="Inventario"
      />

      {/* ── Supplier + Date Row ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4">
        {/* Supplier searchable dropdown */}
        <div ref={supplierRef} className="relative">
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
            Proveedor
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={16} />
            <input
              type="text"
              value={supplierSearch}
              onChange={e => {
                setSupplierSearch(e.target.value)
                setSupplierDropdownOpen(true)
                if (selectedSupplier && e.target.value !== selectedSupplier.name) {
                  setSelectedSupplier(null)
                }
              }}
              onFocus={() => setSupplierDropdownOpen(true)}
              placeholder="Buscar proveedor por nombre, RFC o giro..."
              className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {supplierDropdownOpen && filteredSuppliers.length > 0 && (
            <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
              {filteredSuppliers.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectSupplier(s)}
                  className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0"
                >
                  <div className="text-sm font-medium text-[var(--text-1)]">{s.name}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {s.rfc || ''} {s.giro ? `| ${s.giro}` : ''} {s.phone ? `| ${s.phone}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
            Fecha
          </label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="w-full h-12 px-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
      </div>

      {/* ── Product Search ─────────────────────────────────────── */}
      <div ref={productRef} className="relative">
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
          Agregar producto
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={16} />
          <input
            type="text"
            value={productSearch}
            onChange={e => {
              setProductSearch(e.target.value)
              setProductDropdownOpen(true)
            }}
            onFocus={() => setProductDropdownOpen(true)}
            placeholder="Buscar producto por nombre, codigo o categoria..."
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
            {filteredProducts.map(p => (
              <button
                key={p.ingredient_id}
                onClick={() => addProduct(p)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 flex items-center gap-3"
              >
                <Plus size={16} className="text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-[var(--text-1)] truncate">{p.name}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {p.category || 'Sin categoría'} | Stock: {p.stock.toFixed(1)} {p.unit} | Costo: {formatCurrency(p.cost_per_unit)}/{p.unit}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length === 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl px-4 py-3">
            <span className="text-sm text-[var(--text-3)]">Sin resultados</span>
          </div>
        )}
      </div>

      {/* ── Items Table ────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          {/* Desktop table header */}
          <div className="hidden md:grid grid-cols-[1fr_80px_120px_160px_140px_48px] gap-2 px-4 py-2.5 bg-[var(--surface)] border-b border-[var(--border)] text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
            <div>Producto</div>
            <div>Unidad</div>
            <div className="text-right">Cantidad</div>
            <div className="text-right">Costo Unitario</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {items.map(item => {
            const lineTotal = item.quantity * item.unitCost
            return (
              <div key={item.id}>
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[1fr_80px_120px_160px_140px_48px] gap-2 items-center px-4 py-3 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)]">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text-1)] truncate">{item.name}</div>
                    <div className="text-xs text-[var(--text-3)]">
                      Stock: {item.current_stock.toFixed(1)} | Costo actual: {formatCurrency(item.current_cost)}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--text-2)]">{item.unit}</div>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={item.quantity || ''}
                    onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                    className="h-10 w-full text-right px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitCost || ''}
                      onChange={e => updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)}
                      className="h-10 w-full text-right px-3 pl-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="text-sm font-medium text-[var(--text-1)] text-right tabular-nums">
                    {formatCurrency(lineTotal)}
                  </div>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Mobile card */}
                <div className="md:hidden px-4 py-3 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)] space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-1)]">{item.name}</div>
                      <div className="text-xs text-[var(--text-3)] mt-0.5">{item.unit} | Stock: {item.current_stock.toFixed(1)}</div>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Cantidad</label>
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={item.quantity || ''}
                        onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="h-11 w-full text-center px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Costo Unit.</label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">$</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.unitCost || ''}
                          onChange={e => updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)}
                          className="h-11 w-full text-center px-2 pl-5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Total</label>
                      <div className="h-11 flex items-center justify-center text-sm font-medium text-[var(--text-1)] tabular-nums">
                        {formatCurrency(lineTotal)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Grand total */}
          <div className="flex items-center justify-between px-4 py-4 bg-[var(--surface)] border-t-2 border-blue-500/30">
            <div className="text-sm font-semibold text-[var(--text-1)]">
              Total ({items.length} {items.length === 1 ? 'producto' : 'productos'})
            </div>
            <div className="text-lg font-bold text-[var(--text-1)] tabular-nums">
              {formatCurrency(grandTotal)}
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <PackageCheck size={40} strokeWidth={1.2} />
          <p className="text-sm">Busca y agrega productos para registrar la entrada</p>
        </div>
      )}

      {/* ── Notes ──────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
          Notas (opcional)
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Observaciones sobre la entrega, condiciones, faltantes..."
          className="w-full px-4 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
        />
      </div>

      {/* ── Save message ──────────────────────────────────────── */}
      {saveMessage && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
          saveMessage.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : saveMessage.type === 'duplicate'
            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {saveMessage.text}
        </div>
      )}

      {/* ── Save Button ────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-10">
        {(items.length > 0 || saving) && (
          <div className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 shadow-lg">
            <span className="text-sm text-[var(--text-2)]">
              {items.length} {items.length === 1 ? 'producto' : 'productos'} — {formatCurrency(grandTotal)}
            </span>
            <button
              onClick={handleSave}
              disabled={saving || !selectedSupplier || items.length === 0}
              className="h-11 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 transition-colors"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              {saving ? 'Guardando...' : 'Guardar Entrada'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
