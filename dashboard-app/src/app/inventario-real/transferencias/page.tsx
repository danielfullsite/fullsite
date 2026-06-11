'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Trash2, Save, ArrowRight, Loader2, PackageCheck, Plus, Clock } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost, sbGet } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  inv_final_qty: number
  costo_promedio: number
}

interface TransferLine {
  id: string
  codigo: string
  producto: string
  departamento: string
  stockDisponible: number
  cantidad: number
  costoPromedio: number
}

interface RecentTransfer {
  data_key: string
  fecha: string
  data: {
    source: string
    destination: string
    items: { codigo: string; producto: string; cantidad: number; costoPromedio: number }[]
    createdAt: string
  }
}

// ── Constants ───────────────────────────────────────────────────────

const WAREHOUSES = ['Cocina', 'Barra', 'Panaderia', 'Market', 'Venta Terceros']

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

function nowKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function TransferenciasPage() {
  // Data
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [recentTransfers, setRecentTransfers] = useState<RecentTransfer[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  // Form state
  const [source, setSource] = useState('')
  const [destination, setDestination] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [items, setItems] = useState<TransferLine[]>([])
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null)

  const productRef = useRef<HTMLDivElement>(null)

  // ── Load inventory ──────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const result = await getWansoftDataLatest('inventory_parsed')
        if (result?.data) {
          const parsed = deepParse(result.data)
          const arr = Array.isArray(parsed) ? parsed : []
          setInventory(arr.map((item: any) => ({
            almacen: item.almacen || '',
            codigo: item.codigo || '',
            producto: item.producto || '',
            departamento: item.departamento || '',
            inv_final_qty: parseFloat(item.inv_final_qty) || 0,
            costo_promedio: parseFloat(item.costo_promedio) || 0,
          })))
        }
      } catch (err) {
        console.error('[Transferencias] Error loading inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Load recent transfers ──────────────────────────────────────

  const loadRecentTransfers = useCallback(async () => {
    setLoadingRecent(true)
    try {
      const clientId = getActiveClientSlug()
      const rows = await sbGet<RecentTransfer[]>('wansoft_data', clientId, {
        select: 'data_key,fecha,data',
        'data_key': 'like.inventory_transfer_%',
        order: 'created_at.desc',
        limit: '10',
      })
      const parsed = (rows || []).map((r: any) => ({
        data_key: r.data_key,
        fecha: r.fecha,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      }))
      setRecentTransfers(parsed)
    } catch (err) {
      console.error('[Transferencias] Error loading recent:', err)
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    loadRecentTransfers()
  }, [loadRecentTransfers])

  // ── Click outside ──────────────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (productRef.current && !productRef.current.contains(e.target as Node)) {
        setProductDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Derived data ───────────────────────────────────────────────

  const sourceProducts = inventory.filter(
    p => p.almacen.toLowerCase() === source.toLowerCase() && p.inv_final_qty > 0
  )

  const addedCodes = new Set(items.map(i => i.codigo))
  const filteredProducts = sourceProducts.filter(p => {
    if (addedCodes.has(p.codigo)) return false
    const q = productSearch.toLowerCase()
    if (!q) return true
    return (
      p.producto.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q) ||
      p.departamento.toLowerCase().includes(q)
    )
  }).slice(0, 50)

  const destinationOptions = WAREHOUSES.filter(w => w !== source)
  const canSave = source && destination && items.length > 0 && items.every(i => i.cantidad > 0 && i.cantidad <= i.stockDisponible)

  const totalCost = items.reduce((sum, i) => sum + i.cantidad * i.costoPromedio, 0)

  // ── Actions ────────────────────────────────────────────────────

  const handleSourceChange = (val: string) => {
    setSource(val)
    setItems([]) // clear items when source changes
    setProductSearch('')
    if (val === destination) setDestination('')
  }

  const addProduct = useCallback((p: InventoryItem) => {
    setItems(prev => [...prev, {
      id: uid(),
      codigo: p.codigo,
      producto: p.producto,
      departamento: p.departamento,
      stockDisponible: p.inv_final_qty,
      cantidad: 1,
      costoPromedio: p.costo_promedio,
    }])
    setProductSearch('')
    setProductDropdownOpen(false)
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateQuantity = useCallback((id: string, value: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, cantidad: value } : i))
  }, [])

  // ── Save ───────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveResult(null)

    const payload = {
      source,
      destination,
      items: items.map(i => ({
        codigo: i.codigo,
        producto: i.producto,
        departamento: i.departamento,
        cantidad: i.cantidad,
        costoPromedio: i.costoPromedio,
        costoTotal: i.cantidad * i.costoPromedio,
      })),
      totalCost,
      createdAt: new Date().toISOString(),
    }

    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: `inventory_transfer_${nowKey()}`,
        fecha: todayStr(),
        data: payload,
      })
      setSaveResult(ok ? 'ok' : 'error')
      if (ok) {
        setItems([])
        setSource('')
        setDestination('')
        setProductSearch('')
        loadRecentTransfers()
      }
    } catch {
      setSaveResult('error')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-3)]">
        <Loader2 className="animate-spin" size={20} />
        Cargando inventario...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Transferencias"
        subtitle="Mover producto entre almacenes"
        eyebrow="Inventario"
      />

      {/* ── Warehouse Selection ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_48px_1fr] gap-4 items-end">
        {/* Source */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
            Desde (origen)
          </label>
          <select
            value={source}
            onChange={e => handleSourceChange(e.target.value)}
            className="w-full h-12 px-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 appearance-none cursor-pointer"
          >
            <option value="">Seleccionar almacen...</option>
            {WAREHOUSES.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>

        {/* Arrow */}
        <div className="hidden md:flex items-center justify-center h-12">
          <ArrowRight size={24} className="text-[var(--text-3)]" />
        </div>
        <div className="flex md:hidden items-center justify-center">
          <ArrowRight size={20} className="text-[var(--text-3)] rotate-90" />
        </div>

        {/* Destination */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
            Hacia (destino)
          </label>
          <select
            value={destination}
            onChange={e => setDestination(e.target.value)}
            disabled={!source}
            className="w-full h-12 px-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">Seleccionar almacen...</option>
            {destinationOptions.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Product Search ────────────────────────────────────────── */}
      {source && destination && (
        <div ref={productRef} className="relative">
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
            Agregar producto de {source}
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
              placeholder="Buscar por nombre, codigo o departamento..."
              className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length > 0 && (
            <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
              {filteredProducts.map(p => (
                <button
                  key={p.codigo}
                  onClick={() => addProduct(p)}
                  className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 flex items-center gap-3"
                >
                  <Plus size={16} className="text-blue-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--text-1)] truncate">{p.producto}</div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">
                      {p.codigo} | Stock: {p.inv_final_qty} | {p.departamento}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length === 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl px-4 py-3">
              <span className="text-sm text-[var(--text-3)]">Sin resultados en {source}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Transfer Items Table ──────────────────────────────────── */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-[100px_1fr_120px_160px_140px_48px] gap-2 px-4 py-2.5 bg-[var(--surface)] border-b border-[var(--border)] text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
            <div>Codigo</div>
            <div>Producto</div>
            <div className="text-right">Stock Disp.</div>
            <div className="text-right">Cantidad</div>
            <div className="text-right">Costo</div>
            <div />
          </div>

          {items.map(item => {
            const overStock = item.cantidad > item.stockDisponible
            const lineCost = item.cantidad * item.costoPromedio
            return (
              <div key={item.id}>
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[100px_1fr_120px_160px_140px_48px] gap-2 items-center px-4 py-3 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)]">
                  <div className="text-xs font-mono text-[var(--text-3)]">{item.codigo}</div>
                  <div className="text-sm text-[var(--text-1)] truncate">{item.producto}</div>
                  <div className="text-sm text-[var(--text-3)] text-right tabular-nums">{item.stockDisponible}</div>
                  <div>
                    <input
                      type="number"
                      min={1}
                      max={item.stockDisponible}
                      step={1}
                      value={item.cantidad || ''}
                      onChange={e => updateQuantity(item.id, parseFloat(e.target.value) || 0)}
                      className={`h-10 w-full text-right px-3 rounded-lg bg-[var(--bg)] border text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                        overStock ? 'border-red-500' : 'border-[var(--border)]'
                      }`}
                    />
                    {overStock && (
                      <div className="text-[10px] text-red-400 text-right mt-0.5">
                        Excede stock disponible
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-medium text-[var(--text-1)] text-right tabular-nums">
                    {formatCurrency(lineCost)}
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
                      <div className="text-sm font-medium text-[var(--text-1)]">{item.producto}</div>
                      <div className="text-xs font-mono text-[var(--text-3)] mt-0.5">{item.codigo}</div>
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
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Stock Disp.</label>
                      <div className="h-11 flex items-center justify-center text-sm text-[var(--text-3)] tabular-nums">
                        {item.stockDisponible}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Cantidad</label>
                      <input
                        type="number"
                        min={1}
                        max={item.stockDisponible}
                        step={1}
                        value={item.cantidad || ''}
                        onChange={e => updateQuantity(item.id, parseFloat(e.target.value) || 0)}
                        className={`h-11 w-full text-center px-2 rounded-lg bg-[var(--bg)] border text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                          overStock ? 'border-red-500' : 'border-[var(--border)]'
                        }`}
                      />
                      {overStock && (
                        <div className="text-[10px] text-red-400 text-center mt-0.5">
                          Excede stock
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-3)] mb-1">Costo</label>
                      <div className="h-11 flex items-center justify-center text-sm font-medium text-[var(--text-1)] tabular-nums">
                        {formatCurrency(lineCost)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Total row */}
          <div className="flex items-center justify-between px-4 py-4 bg-[var(--surface)] border-t-2 border-blue-500/30">
            <div className="text-sm font-semibold text-[var(--text-1)]">
              Total ({items.length} {items.length === 1 ? 'producto' : 'productos'})
            </div>
            <div className="text-lg font-bold text-[var(--text-1)] tabular-nums">
              {formatCurrency(totalCost)}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && source && destination && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <PackageCheck size={40} strokeWidth={1.2} />
          <p className="text-sm">Busca y agrega productos para transferir de {source} a {destination}</p>
        </div>
      )}

      {!source && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <PackageCheck size={40} strokeWidth={1.2} />
          <p className="text-sm">Selecciona almacen origen y destino para comenzar</p>
        </div>
      )}

      {/* ── Save Button ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 transition-colors"
        >
          {saving ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Save size={18} />
          )}
          {saving ? 'Guardando...' : 'Guardar Transferencia'}
        </button>

        {saveResult === 'ok' && (
          <span className="text-sm text-emerald-400 font-medium">
            Transferencia registrada correctamente
          </span>
        )}
        {saveResult === 'error' && (
          <span className="text-sm text-red-400 font-medium">
            Error al guardar. Intenta de nuevo.
          </span>
        )}
      </div>

      {/* ── Recent Transfers ──────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-[var(--text-3)]" />
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Transferencias recientes</h3>
        </div>

        {loadingRecent ? (
          <div className="flex items-center gap-2 text-[var(--text-3)] text-sm py-4">
            <Loader2 size={16} className="animate-spin" />
            Cargando...
          </div>
        ) : recentTransfers.length === 0 ? (
          <p className="text-sm text-[var(--text-3)] py-4">No hay transferencias registradas</p>
        ) : (
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            {recentTransfers.map((t, idx) => {
              const d = t.data
              const itemCount = d?.items?.length || 0
              const total = d?.items?.reduce((s: number, i: any) => s + (i.cantidad || 0) * (i.costoPromedio || 0), 0) || 0
              return (
                <div
                  key={t.data_key || idx}
                  className="px-4 py-3 border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-[var(--text-1)] font-medium">
                        <span>{d?.source || '?'}</span>
                        <ArrowRight size={14} className="text-[var(--text-3)] shrink-0" />
                        <span>{d?.destination || '?'}</span>
                      </div>
                      <div className="text-xs text-[var(--text-3)] mt-1">
                        {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
                        {d?.createdAt ? ` | ${formatDateTime(d.createdAt)}` : ''}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-[var(--text-1)] tabular-nums shrink-0">
                      {formatCurrency(total)}
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
