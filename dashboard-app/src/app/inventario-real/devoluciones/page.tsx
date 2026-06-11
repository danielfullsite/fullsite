'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { Search, Save, Trash2, Plus, Loader2, PackageX, ChevronDown, AlertTriangle, RotateCcw, Clock, DollarSign } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface Supplier {
  id: string
  name: string
  rfc: string
  phone: string
  email: string
  giro: string
}

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  inv_final_qty: number
  inv_final_val: number
  costo_promedio: number
}

interface ReturnLineItem {
  id: string
  codigo: string
  producto: string
  almacen: string
  cantidad: number
  motivo: string
  referencia: string
  costo_unitario: number
  costo_total: number
}

interface ReturnEntry {
  data_key: string
  fecha: string
  data: {
    supplier: { id: string; name: string }
    items: {
      codigo: string
      producto: string
      cantidad: number
      motivo: string
      referencia: string
      costo_unitario: number
      costo_total: number
    }[]
    total: number
    notes: string
    created_at: string
  }
}

// ── Constants ───────────────────────────────────────────────────────

const MOTIVOS = [
  'Producto dañado',
  'Entrega incorrecta',
  'Caducado',
  'Calidad deficiente',
  'Error de pedido',
  'Otro',
]

// ── Helpers ─────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function nowKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

// ── Component ───────────────────────────────────────────────────────

export default function DevolucionesPage() {
  // Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [returnHistory, setReturnHistory] = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [items, setItems] = useState<ReturnLineItem[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supplierRef = useRef<HTMLDivElement>(null)
  const productRef = useRef<HTMLDivElement>(null)

  // ── Load data ───────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

        const promises: Promise<void>[] = []

        // Load suppliers from pos_suppliers
        if (SUPABASE_URL && SUPABASE_KEY) {
          promises.push(
            fetch(
              `${SUPABASE_URL}/rest/v1/pos_suppliers?client_id=eq.${clientId}&select=id,name,rfc,phone,email,giro&order=name.asc&limit=500`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
            ).then(async res => {
              if (res.ok) {
                const rows = await res.json()
                setSuppliers(rows.map((r: any) => ({
                  id: r.id || '',
                  name: r.name || '',
                  rfc: r.rfc || '',
                  phone: r.phone || '',
                  email: r.email || '',
                  giro: r.giro || '',
                })))
              }
            })
          )

          // Load return history
          promises.push(
            fetch(
              `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.inventory_return_*&order=fecha.desc&limit=60`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
            ).then(async res => {
              if (res.ok) {
                const rows = await res.json()
                setReturnHistory(rows.map((r: any) => {
                  let data = r.data
                  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { /* ignore */ } }
                  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { /* ignore */ } }
                  return { data_key: r.data_key, fecha: r.fecha, data }
                }))
              }
            })
          )
        }

        // Load inventory
        promises.push(
          getWansoftDataLatest('inventory_parsed').then(invResult => {
            if (invResult?.data) {
              const raw = Array.isArray(invResult.data) ? invResult.data : (invResult.data as any)?.items || []
              setInventoryItems(raw.map((r: any) => ({
                almacen: r.almacen || '',
                codigo: r.codigo || '',
                producto: r.producto || '',
                departamento: r.departamento || '',
                inv_final_qty: Number(r.inv_final_qty) || 0,
                inv_final_val: Number(r.inv_final_val) || 0,
                costo_promedio: Number(r.costo_promedio) || 0,
              })))
            }
          })
        )

        await Promise.all(promises)
      } catch (err) {
        console.error('[devoluciones] Error loading:', err)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Click outside handlers ────────────────────────────────────────

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

  // ── KPI calculations ─────────────────────────────────────────────

  const kpis = useMemo(() => {
    const today = todayISO()
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

    let devHoy = 0
    let devMes = 0
    let countMes = 0

    for (const entry of returnHistory) {
      const entryTotal = entry.data?.total || 0
      if (entry.fecha === today) devHoy += entryTotal
      if (entry.fecha >= firstOfMonth) {
        devMes += entryTotal
        countMes++
      }
    }

    return { devHoy, devMes, countMes }
  }, [returnHistory])

  // ── Filtered suppliers ────────────────────────────────────────────

  const filteredSuppliers = suppliers.filter(s => {
    const q = supplierSearch.toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.rfc.toLowerCase().includes(q) || s.giro.toLowerCase().includes(q)
  }).slice(0, 50)

  // ── Filtered products ─────────────────────────────────────────────

  const addedCodes = new Set(items.map(i => `${i.almacen}::${i.codigo}`))

  const filteredProducts = useMemo(() => {
    let list = inventoryItems.filter(i => !addedCodes.has(`${i.almacen}::${i.codigo}`))
    if (productSearch.length >= 2) {
      const q = productSearch.toLowerCase()
      list = list.filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.departamento.toLowerCase().includes(q)
      )
    } else {
      list = []
    }
    return list.sort((a, b) => a.producto.localeCompare(b.producto, 'es')).slice(0, 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryItems, productSearch, items.length])

  // ── Actions ───────────────────────────────────────────────────────

  const selectSupplier = useCallback((s: Supplier) => {
    setSelectedSupplier(s)
    setSupplierSearch(s.name)
    setSupplierDropdownOpen(false)
  }, [])

  const addProduct = useCallback((item: InventoryItem) => {
    setItems(prev => [...prev, {
      id: uid(),
      codigo: item.codigo,
      producto: item.producto,
      almacen: item.almacen,
      cantidad: 1,
      motivo: MOTIVOS[0],
      referencia: '',
      costo_unitario: item.costo_promedio,
      costo_total: item.costo_promedio,
    }])
    setProductSearch('')
    setProductDropdownOpen(false)
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateItem = useCallback((id: string, field: keyof ReturnLineItem, value: string | number) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      const updated = { ...i, [field]: value }
      if (field === 'cantidad') {
        updated.costo_total = (value as number) * updated.costo_unitario
      }
      return updated
    }))
  }, [])

  const grandTotal = items.reduce((sum, i) => sum + i.costo_total, 0)

  // ── Save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedSupplier || items.length === 0) return
    setSaving(true)
    setSaveMessage(null)

    const payload = {
      supplier: {
        id: selectedSupplier.id,
        name: selectedSupplier.name,
        rfc: selectedSupplier.rfc,
      },
      items: items.map(i => ({
        codigo: i.codigo,
        producto: i.producto,
        almacen: i.almacen,
        cantidad: i.cantidad,
        motivo: i.motivo,
        referencia: i.referencia,
        costo_unitario: i.costo_unitario,
        costo_total: i.costo_total,
      })),
      total: grandTotal,
      notes,
      created_at: new Date().toISOString(),
    }

    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: `inventory_return_${nowKey()}`,
        fecha: todayISO(),
        data: payload,
      })
      if (ok) {
        setSaveMessage({ type: 'success', text: `Devolucion registrada: ${items.length} productos por ${formatCurrency(grandTotal)}` })
        setReturnHistory(prev => [{
          data_key: `inventory_return_${nowKey()}`,
          fecha: todayISO(),
          data: payload,
        }, ...prev])
        setItems([])
        setNotes('')
        setSelectedSupplier(null)
        setSupplierSearch('')
      } else {
        setSaveMessage({ type: 'error', text: 'Error al guardar. Intenta de nuevo.' })
      }
    } catch {
      setSaveMessage({ type: 'error', text: 'Error de red. Verifica tu conexion.' })
    }
    setSaving(false)
  }

  // ── Recent log ────────────────────────────────────────────────────

  const recentLog = returnHistory.slice(0, 20)

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-3)]">
        <Loader2 className="animate-spin" size={20} />
        Cargando datos...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Devoluciones"
        subtitle="Devolver producto a proveedor"
        eyebrow="Inventario"
      />

      {/* ── KPI Summary ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="rounded-xl border border-[var(--accent-line)] px-4 py-3" style={{ background: 'var(--bento-card)' }}>
          <div className="flex items-center gap-2 text-[var(--text-3)] mb-1">
            <DollarSign size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Hoy</span>
          </div>
          <div className="text-lg font-bold text-orange-400 tabular-nums">{formatCurrency(kpis.devHoy)}</div>
        </div>
        <div className="rounded-xl border border-[var(--accent-line)] px-4 py-3" style={{ background: 'var(--bento-card)' }}>
          <div className="flex items-center gap-2 text-[var(--text-3)] mb-1">
            <RotateCcw size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Mes</span>
          </div>
          <div className="text-lg font-bold text-orange-400 tabular-nums">{formatCurrency(kpis.devMes)}</div>
        </div>
        <div className="rounded-xl border border-[var(--accent-line)] px-4 py-3" style={{ background: 'var(--bento-card)' }}>
          <div className="flex items-center gap-2 text-[var(--text-3)] mb-1">
            <Clock size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Registros mes</span>
          </div>
          <div className="text-lg font-bold text-[var(--text-1)] tabular-nums">{kpis.countMes}</div>
        </div>
      </div>

      {/* ── Supplier Selector ────────────────────────────────── */}
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
                  {s.rfc ? `RFC: ${s.rfc}` : ''}{s.giro ? ` | ${s.giro}` : ''}{s.phone ? ` | ${s.phone}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Product Search ────────────────────────────────────── */}
      <div ref={productRef} className="relative">
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
          Agregar producto a devolver
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
            placeholder="Buscar producto por nombre, codigo o departamento..."
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        {productDropdownOpen && productSearch.length >= 2 && filteredProducts.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
            {filteredProducts.map(p => (
              <button
                key={`${p.almacen}::${p.codigo}`}
                onClick={() => addProduct(p)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 flex items-center gap-3"
              >
                <Plus size={16} className="text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-[var(--text-1)] truncate">{p.producto}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {p.codigo} | {p.departamento} | Stock: {p.inv_final_qty.toFixed(1)} | {formatCurrency(p.costo_promedio)}/u
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

      {/* ── Save message ─────────────────────────────────────── */}
      {saveMessage && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
          saveMessage.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {saveMessage.type === 'success' ? <RotateCcw size={16} /> : <AlertTriangle size={16} />}
          {saveMessage.text}
        </div>
      )}

      {/* ── Return Items List ────────────────────────────────── */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-[1fr_90px_170px_1fr_110px_48px] gap-2 px-4 py-2.5 border-b border-[var(--accent-line)] text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
            <div>Producto</div>
            <div className="text-right">Cantidad</div>
            <div>Motivo</div>
            <div>Referencia</div>
            <div className="text-right">Costo</div>
            <div />
          </div>

          {items.map(item => (
            <div key={item.id}>
              {/* Desktop row */}
              <div className="hidden md:grid grid-cols-[1fr_90px_170px_1fr_110px_48px] gap-2 items-center px-4 py-3 border-b border-[var(--accent-line)] last:border-b-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text-1)] truncate">{item.producto}</div>
                  <div className="text-xs text-[var(--text-3)] font-mono">{item.codigo}</div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  value={item.cantidad || ''}
                  onChange={e => updateItem(item.id, 'cantidad', parseFloat(e.target.value) || 0)}
                  className="h-10 w-full text-right px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="relative">
                  <select
                    value={item.motivo}
                    onChange={e => updateItem(item.id, 'motivo', e.target.value)}
                    className="h-10 w-full px-3 pr-8 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 appearance-none cursor-pointer"
                  >
                    {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
                </div>
                <input
                  type="text"
                  placeholder="Factura / entrada original..."
                  value={item.referencia}
                  onChange={e => updateItem(item.id, 'referencia', e.target.value)}
                  className="h-10 w-full px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <div className="text-sm font-medium text-[var(--text-1)] text-right tabular-nums">
                  {formatCurrency(item.costo_total)}
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Mobile card */}
              <div className="md:hidden px-4 py-3 border-b border-[var(--accent-line)] last:border-b-0 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-[var(--text-3)] mb-1">Cantidad</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      step="0.01"
                      value={item.cantidad || ''}
                      onChange={e => updateItem(item.id, 'cantidad', parseFloat(e.target.value) || 0)}
                      className="h-11 w-full text-center px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[var(--text-3)] mb-1">Motivo</label>
                    <div className="relative">
                      <select
                        value={item.motivo}
                        onChange={e => updateItem(item.id, 'motivo', e.target.value)}
                        className="h-11 w-full px-2 pr-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 appearance-none cursor-pointer"
                      >
                        {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-3)] mb-1">Referencia</label>
                  <input
                    type="text"
                    placeholder="Factura / entrada original..."
                    value={item.referencia}
                    onChange={e => updateItem(item.id, 'referencia', e.target.value)}
                    className="h-11 w-full px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-[var(--text-3)]">Costo: {formatCurrency(item.costo_unitario)}/u</span>
                  <span className="text-sm font-semibold text-[var(--text-1)] tabular-nums">{formatCurrency(item.costo_total)}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div className="flex items-center justify-between px-4 py-4 border-t-2 border-orange-500/30">
            <div className="text-sm font-semibold text-[var(--text-1)]">
              Total devolucion ({items.length} {items.length === 1 ? 'producto' : 'productos'})
            </div>
            <div className="text-lg font-bold text-orange-400 tabular-nums">
              {formatCurrency(grandTotal)}
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <PackageX size={40} strokeWidth={1.2} />
          <p className="text-sm">Selecciona un proveedor y agrega productos para devolver</p>
        </div>
      )}

      {/* ── Notes ─────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
          Notas (opcional)
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Observaciones sobre la devolucion, condiciones, acuerdos con proveedor..."
          className="w-full px-4 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
        />
      </div>

      {/* ── Save Button ───────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-[var(--accent-line)] shadow-2xl" style={{ background: 'var(--bento-card)' }}>
          <div className="text-sm text-[var(--text-2)]">
            {selectedSupplier && (
              <span className="text-[var(--text-3)] mr-2">{selectedSupplier.name} —</span>
            )}
            <span className="font-semibold text-[var(--text-1)]">{items.length}</span> producto{items.length !== 1 ? 's' : ''} — <span className="font-bold text-orange-400">{formatCurrency(grandTotal)}</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !selectedSupplier || items.length === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-500/20"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {saving ? 'Guardando...' : 'Registrar devolucion'}
          </button>
        </div>
      )}

      {/* ── Recent Returns Log ────────────────────────────────── */}
      {recentLog.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wider">
            Devoluciones recientes
          </h3>
          <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--accent-line)]">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Fecha</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Proveedor</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Items</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Total</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] hidden md:table-cell">Motivos</th>
                </tr>
              </thead>
              <tbody>
                {recentLog.map((entry, idx) => {
                  const itemCount = entry.data?.items?.length || 0
                  const total = entry.data?.total || 0
                  const supplierName = entry.data?.supplier?.name || '--'
                  const motivos = [...new Set((entry.data?.items || []).map((i: any) => i.motivo).filter(Boolean))].slice(0, 3)
                  const createdAt = entry.data?.created_at
                  const time = createdAt ? new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''

                  return (
                    <tr key={entry.data_key || idx} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 text-[var(--text-1)] whitespace-nowrap">
                        <div className="text-sm">{entry.fecha}</div>
                        {time && <div className="text-xs text-[var(--text-3)]">{time}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-2)] max-w-[200px] truncate">{supplierName}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-2)] tabular-nums">{itemCount}</td>
                      <td className="px-4 py-3 text-right font-semibold text-orange-400 tabular-nums">{formatCurrency(total)}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-3)] hidden md:table-cell max-w-[300px]">
                        <span className="truncate block">{motivos.join(', ')}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
