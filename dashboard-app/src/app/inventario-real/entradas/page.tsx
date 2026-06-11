'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Plus, Trash2, Search, Save, PackageCheck, Loader2 } from 'lucide-react'
import { getWansoftDataLatest } from '@/lib/data'
import { getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface Supplier {
  clave: string
  nombre: string
  rfc: string
  giro: string
}

interface ProductOption {
  Text: string
  Value: string
}

interface LineItem {
  id: string
  code: string
  name: string
  productValue: string
  quantity: number
  unitCost: number
}

// ── Helpers ─────────────────────────────────────────────────────────

function deepParse(raw: unknown): unknown {
  let parsed = raw
  for (let i = 0; i < 5; i++) {
    if (typeof parsed !== 'string') break
    try { parsed = JSON.parse(parsed) } catch { break }
  }
  return parsed
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function todayStr() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
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
  const [products, setProducts] = useState<ProductOption[]>([])
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
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null)

  const supplierRef = useRef<HTMLDivElement>(null)
  const productRef = useRef<HTMLDivElement>(null)

  // ── Load catalogs ───────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [suppResult, prodResult] = await Promise.all([
          getWansoftDataLatest('proveedores_catalog'),
          getWansoftDataLatest('products_catalog'),
        ])

        if (suppResult?.data) {
          const parsed = deepParse(suppResult.data)
          const arr = Array.isArray(parsed) ? parsed : []
          setSuppliers(arr.map((s: any) => ({
            clave: s.clave || '',
            nombre: s.nombre || '',
            rfc: s.rfc || '',
            giro: s.giro || '',
          })))
        }

        if (prodResult?.data) {
          const parsed = deepParse(prodResult.data)
          // Could be { products: [...] } or directly an array
          let arr: ProductOption[] = []
          if (Array.isArray(parsed)) {
            arr = parsed
          } else if (parsed && typeof parsed === 'object' && 'products' in (parsed as any)) {
            arr = (parsed as any).products || []
          }
          setProducts(arr.map((p: any) => ({
            Text: p.Text || p.text || '',
            Value: p.Value || p.value || '',
          })))
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
    return s.nombre.toLowerCase().includes(q) || s.clave.toLowerCase().includes(q) || s.rfc.toLowerCase().includes(q)
  }).slice(0, 50)

  const addedValues = new Set(items.map(i => i.productValue))
  const filteredProducts = products.filter(p => {
    if (addedValues.has(p.Value)) return false
    const q = productSearch.toLowerCase()
    if (!q) return true
    return p.Text.toLowerCase().includes(q)
  }).slice(0, 50)

  // ── Actions ─────────────────────────────────────────────────────

  const selectSupplier = useCallback((s: Supplier) => {
    setSelectedSupplier(s)
    setSupplierSearch(s.nombre)
    setSupplierDropdownOpen(false)
  }, [])

  const addProduct = useCallback((p: ProductOption) => {
    // Extract code from Text like "ACEITE VEGETAL (ABA001)"
    const match = p.Text.match(/\(([^)]+)\)/)
    const code = match ? match[1] : ''
    const name = p.Text.replace(/\s*\([^)]+\)\s*$/, '').trim()

    setItems(prev => [...prev, {
      id: uid(),
      code,
      name,
      productValue: p.Value,
      quantity: 1,
      unitCost: 0,
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
    setSaveResult(null)

    const payload = {
      supplier: {
        clave: selectedSupplier.clave,
        nombre: selectedSupplier.nombre,
        rfc: selectedSupplier.rfc,
      },
      fecha,
      items: items.map(i => ({
        code: i.code,
        name: i.name,
        productValue: i.productValue,
        quantity: i.quantity,
        unitCost: i.unitCost,
        total: i.quantity * i.unitCost,
      })),
      grandTotal,
      notes,
      createdAt: new Date().toISOString(),
    }

    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: `inventory_entry_${nowKey()}`,
        fecha,
        data: payload,
      })
      setSaveResult(ok ? 'ok' : 'error')
      if (ok) {
        // Reset form
        setItems([])
        setNotes('')
        setSelectedSupplier(null)
        setSupplierSearch('')
        setFecha(todayStr())
      }
    } catch {
      setSaveResult('error')
    } finally {
      setSaving(false)
    }
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
        subtitle="Registro de productos recibidos"
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
                if (selectedSupplier && e.target.value !== selectedSupplier.nombre) {
                  setSelectedSupplier(null)
                }
              }}
              onFocus={() => setSupplierDropdownOpen(true)}
              placeholder="Buscar proveedor por nombre, clave o RFC..."
              className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {supplierDropdownOpen && filteredSuppliers.length > 0 && (
            <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
              {filteredSuppliers.map(s => (
                <button
                  key={s.clave}
                  onClick={() => selectSupplier(s)}
                  className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0"
                >
                  <div className="text-sm font-medium text-[var(--text-1)]">{s.nombre}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {s.clave} {s.rfc ? `| ${s.rfc}` : ''} {s.giro ? `| ${s.giro}` : ''}
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
            placeholder="Buscar producto por nombre o codigo..."
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
            {filteredProducts.map(p => (
              <button
                key={p.Value}
                onClick={() => addProduct(p)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 flex items-center gap-3"
              >
                <Plus size={16} className="text-blue-400 shrink-0" />
                <span className="text-sm text-[var(--text-1)]">{p.Text}</span>
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
          <div className="hidden md:grid grid-cols-[100px_1fr_120px_160px_140px_48px] gap-2 px-4 py-2.5 bg-[var(--surface)] border-b border-[var(--border)] text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
            <div>Codigo</div>
            <div>Producto</div>
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
                <div className="hidden md:grid grid-cols-[100px_1fr_120px_160px_140px_48px] gap-2 items-center px-4 py-3 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)]">
                  <div className="text-xs font-mono text-[var(--text-3)]">{item.code}</div>
                  <div className="text-sm text-[var(--text-1)] truncate">{item.name}</div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.quantity || ''}
                    onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                    className="h-10 w-full text-right px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitCost || ''}
                      onChange={e => updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)}
                      className="h-10 w-full text-right px-3 pl-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
                      <div className="text-xs font-mono text-[var(--text-3)] mt-0.5">{item.code}</div>
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
                        min={0}
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

      {/* ── Save Button ────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !selectedSupplier || items.length === 0}
          className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 transition-colors"
        >
          {saving ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Save size={18} />
          )}
          {saving ? 'Guardando...' : 'Guardar Entrada'}
        </button>

        {saveResult === 'ok' && (
          <span className="text-sm text-emerald-400 font-medium">
            Entrada registrada correctamente
          </span>
        )}
        {saveResult === 'error' && (
          <span className="text-sm text-red-400 font-medium">
            Error al guardar. Intenta de nuevo.
          </span>
        )}
      </div>
    </div>
  )
}
