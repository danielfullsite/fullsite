'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Search, Save, Trash2, Plus, AlertTriangle, Loader2, PackageX, ChevronDown, Clock, TrendingDown, DollarSign, BarChart3 } from 'lucide-react'
import { getActiveClientSlug } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'
import { sbPost } from '@/lib/supabase-helpers'
import { recordMovement, loadInventoryWithStock, makeIdempotencyKey } from '@/lib/inventory'
import type { MovementResult } from '@/lib/inventory'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  ingredient_id: string   // pos_ingredients.id — canonical identifier
  codigo: string          // same as ingredient_id for display
  producto: string        // pos_ingredients.name
  departamento: string    // pos_ingredients.category
  unit: string            // pos_ingredients.unit
  stock: number           // pos_inventory.stock (current)
  costo_promedio: number  // pos_ingredients.cost_per_unit
}

interface WasteLineItem {
  id: string
  ingredient_id: string   // pos_ingredients.id — for recordMovement()
  codigo: string
  producto: string
  unit: string
  cantidad: number
  motivo: string
  notas: string
  costo_unitario: number
  costo_total: number
}

interface WasteEntry {
  data_key: string
  fecha: string
  data: {
    warehouse: string
    items: {
      codigo: string
      producto: string
      cantidad: number
      motivo: string
      notas: string
      costo_unitario: number
      costo_total: number
    }[]
    total: number
    created_at: string
  }
}

// ── Constants ───────────────────────────────────────────────────────

const WAREHOUSES = [
  { key: 'cocina', label: 'Cocina' },
  { key: 'barra', label: 'Barra' },
  { key: 'panaderia', label: 'Panaderia' },
  { key: 'market', label: 'Market' },
  { key: 'venta_terceros', label: 'Venta Terceros' },
]

const MOTIVOS = [
  'Caducado',
  'Danado',
  'Merma de preparacion',
  'Error de cocina',
  'Robo/Faltante',
  'Otro',
]

function matchWarehouse(almacen: string, tab: string): boolean {
  const normalized = almacen.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (tab === 'cocina') return normalized.includes('cocina')
  if (tab === 'barra') return normalized.includes('barra')
  if (tab === 'panaderia') return normalized.includes('panaderia') || normalized.includes('panadería')
  if (tab === 'market') return normalized.includes('market')
  if (tab === 'venta_terceros') return normalized.includes('venta') && normalized.includes('tercero')
  return false
}

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

export default function MermaPage() {
  // Data
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [wasteHistory, setWasteHistory] = useState<WasteEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [inventoryFecha, setInventoryFecha] = useState('')

  // Form state
  const [activeWarehouse, setActiveWarehouse] = useState('cocina')
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [items, setItems] = useState<WasteLineItem[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const searchRef = useRef<HTMLDivElement>(null)

  // ── Load data ───────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()

        // Load inventory from canonical source (pos_ingredients + pos_inventory)
        const invRows = await loadInventoryWithStock(clientId)
        setInventoryItems(invRows.map(r => ({
          ingredient_id: r.ingredient_id,
          codigo: r.ingredient_id,
          producto: r.name,
          departamento: r.category || 'Sin categoría',
          unit: r.unit,
          stock: r.stock,
          costo_promedio: r.cost_per_unit,
        })))
        setInventoryFecha(new Date().toISOString().split('T')[0])

        // Load waste history (last 60 entries with data_key starting with inventory_waste_)
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (SUPABASE_URL && SUPABASE_KEY) {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.inventory_waste_*&order=fecha.desc&limit=60`,
            {
              headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
              },
            }
          )
          if (res.ok) {
            const rows = await res.json()
            setWasteHistory(rows.map((r: any) => {
              let data = r.data
              if (typeof data === 'string') { try { data = JSON.parse(data) } catch {} }
              if (typeof data === 'string') { try { data = JSON.parse(data) } catch {} }
              return { data_key: r.data_key, fecha: r.fecha, data }
            }))
          }
        }
      } catch (err) {
        console.error('[merma] Error loading:', err)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Click outside ──────────────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── KPI calculations from waste history ────────────────────────

  const kpis = useMemo(() => {
    const today = todayISO()
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const daysInMonth = now.getDate()

    let mermaHoy = 0
    let mermaMes = 0
    const productTotals: Record<string, number> = {}

    for (const entry of wasteHistory) {
      const entryTotal = entry.data?.total || 0
      const entryItems = entry.data?.items || []

      if (entry.fecha === today) {
        mermaHoy += entryTotal
      }
      if (entry.fecha >= firstOfMonth) {
        mermaMes += entryTotal
        for (const item of entryItems) {
          const key = item.producto || 'Desconocido'
          productTotals[key] = (productTotals[key] || 0) + (item.costo_total || 0)
        }
      }
    }

    const topProducto = Object.entries(productTotals)
      .sort(([, a], [, b]) => b - a)[0]

    const promedioDiario = daysInMonth > 0 ? mermaMes / daysInMonth : 0

    return {
      mermaMes,
      mermaHoy,
      topProducto: topProducto ? topProducto[0] : '--',
      topProductoVal: topProducto ? topProducto[1] : 0,
      promedioDiario,
    }
  }, [wasteHistory])

  // ── Filtered products for selected warehouse ──────────────────

  const addedIds = new Set(items.map(i => i.ingredient_id))

  const filteredProducts = useMemo(() => {
    let list = inventoryItems.filter(i => !addedIds.has(i.ingredient_id))
    if (search.length >= 2) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.departamento.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.producto.localeCompare(b.producto, 'es')).slice(0, 50)
  }, [inventoryItems, search, addedIds])

  // ── Actions ────────────────────────────────────────────────────

  const addProduct = useCallback((item: InventoryItem) => {
    setItems(prev => [...prev, {
      id: uid(),
      ingredient_id: item.ingredient_id,
      codigo: item.codigo,
      producto: item.producto,
      unit: item.unit,
      cantidad: 1,
      motivo: MOTIVOS[0],
      notas: '',
      costo_unitario: item.costo_promedio,
      costo_total: item.costo_promedio,
    }])
    setSearch('')
    setDropdownOpen(false)
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateItem = useCallback((id: string, field: keyof WasteLineItem, value: string | number) => {
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

  // ── Save ───────────────────────────────────────────────────────

  const handleSave = async () => {
    if (items.length === 0) return
    setSaving(true)
    setSaveMessage(null)

    const clientId = getActiveClientSlug()
    const timestamp = nowKey()
    const idempotencyKey = makeIdempotencyKey('waste', 'dashboard', timestamp, activeWarehouse)

    try {
      // ── 1. Record movements (updates pos_inventory + ledger) ──
      const movResult: MovementResult = await recordMovement({
        client_id: clientId,
        movement_type: 'waste',
        actor: 'dashboard',
        idempotency_key: idempotencyKey,
        metadata: { warehouse: activeWarehouse },
        lines: items.map(i => ({
          ingredient_id: i.ingredient_id,
          quantity: -Math.abs(i.cantidad),  // waste = negative
          notes: `${i.motivo}${i.notas ? ': ' + i.notas : ''}`,
        })),
      })

      if (movResult.was_duplicate) {
        setSaveMessage({ type: 'success', text: 'Esta merma ya fue registrada anteriormente.' })
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
        warehouse: activeWarehouse,
        warehouse_label: WAREHOUSES.find(w => w.key === activeWarehouse)?.label,
        items: items.map(i => ({
          ingredient_id: i.ingredient_id,
          codigo: i.codigo,
          producto: i.producto,
          unit: i.unit,
          cantidad: i.cantidad,
          motivo: i.motivo,
          notas: i.notas,
          costo_unitario: i.costo_unitario,
          costo_total: i.costo_total,
        })),
        total: grandTotal,
        idempotency_key: idempotencyKey,
        movements_created: movResult.movements_created,
        stock_updates: movResult.stock_updates,
        created_at: new Date().toISOString(),
      }

      await sbPost('wansoft_data', clientId, {
        data_key: `inventory_waste_${timestamp}`,
        fecha: todayISO(),
        data: payload,
      })

      setSaveMessage({
        type: 'success',
        text: `Merma registrada: ${items.length} productos por ${formatCurrency(grandTotal)}. Stock actualizado.`,
      })
      setWasteHistory(prev => [{
        data_key: `inventory_waste_${timestamp}`,
        fecha: todayISO(),
        data: payload,
      }, ...prev])
      setItems([])
    } catch {
      setSaveMessage({ type: 'error', text: 'Error de red. Verifica tu conexion.' })
    }
    setSaving(false)
  }

  // ── Recent log (last 20) ───────────────────────────────────────

  const recentLog = wasteHistory.slice(0, 20)

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Merma y Desperdicios"
        subtitle="Registro de perdidas"
        eyebrow="Inventario"
      />

      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Merma del mes"
          value={formatCurrency(kpis.mermaMes)}
          icon={DollarSign}
          accentClass="kpi-accent-pink"
          index={0}
        />
        <KPICard
          label="Merma de hoy"
          value={formatCurrency(kpis.mermaHoy)}
          icon={TrendingDown}
          accentClass="kpi-accent-amber"
          index={1}
        />
        <KPICard
          label="Top producto merma"
          value={kpis.topProducto.length > 18 ? kpis.topProducto.slice(0, 18) + '...' : kpis.topProducto}
          subtitle={kpis.topProductoVal > 0 ? formatCurrency(kpis.topProductoVal) : undefined}
          icon={BarChart3}
          accentClass="kpi-accent-purple"
          index={2}
        />
        <KPICard
          label="Promedio diario"
          value={formatCurrency(kpis.promedioDiario)}
          icon={Clock}
          accentClass="kpi-accent-blue"
          index={3}
        />
      </div>

      {/* ── Warehouse Tabs ────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {WAREHOUSES.map(wh => (
          <button
            key={wh.key}
            onClick={() => {
              setActiveWarehouse(wh.key)
              setSearch('')
              setDropdownOpen(false)
            }}
            className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
              activeWarehouse === wh.key
                ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/40'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] border-2 border-transparent'
            }`}
          >
            {wh.label}
          </button>
        ))}
      </div>

      {/* ── Product Search ────────────────────────────────────── */}
      <div ref={searchRef} className="relative">
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1.5">
          Agregar producto
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={16} />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setDropdownOpen(true)
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Buscar producto por nombre, codigo o departamento..."
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        {dropdownOpen && search.length >= 2 && filteredProducts.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
            {filteredProducts.map(p => (
              <button
                key={p.ingredient_id}
                onClick={() => addProduct(p)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 flex items-center gap-3"
              >
                <Plus size={16} className="text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-[var(--text-1)] truncate">{p.producto}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {p.departamento} | Stock: {formatNumber(p.stock)} {p.unit} | {formatCurrency(p.costo_promedio)}/{p.unit}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        {dropdownOpen && search.length >= 2 && filteredProducts.length === 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl px-4 py-3">
            <span className="text-sm text-[var(--text-3)]">Sin resultados</span>
          </div>
        )}
      </div>

      {/* ── Save message ──────────────────────────────────────── */}
      {saveMessage && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
          saveMessage.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {saveMessage.type === 'success' ? <PackageX size={16} /> : <AlertTriangle size={16} />}
          {saveMessage.text}
        </div>
      )}

      {/* ── Items List ────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-[1fr_100px_180px_1fr_120px_48px] gap-2 px-4 py-2.5 border-b border-[var(--accent-line)] text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
            <div>Producto</div>
            <div className="text-right">Cantidad</div>
            <div>Motivo</div>
            <div>Notas</div>
            <div className="text-right">Costo</div>
            <div />
          </div>

          {items.map(item => (
            <div key={item.id}>
              {/* Desktop row */}
              <div className="hidden md:grid grid-cols-[1fr_100px_180px_1fr_120px_48px] gap-2 items-center px-4 py-3 border-b border-[var(--accent-line)] last:border-b-0">
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
                  placeholder="Notas..."
                  value={item.notas}
                  onChange={e => updateItem(item.id, 'notas', e.target.value)}
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
                  <label className="block text-[10px] text-[var(--text-3)] mb-1">Notas</label>
                  <input
                    type="text"
                    placeholder="Notas..."
                    value={item.notas}
                    onChange={e => updateItem(item.id, 'notas', e.target.value)}
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
          <div className="flex items-center justify-between px-4 py-4 border-t-2 border-red-500/30">
            <div className="text-sm font-semibold text-[var(--text-1)]">
              Total merma ({items.length} {items.length === 1 ? 'producto' : 'productos'})
            </div>
            <div className="text-lg font-bold text-red-400 tabular-nums">
              {formatCurrency(grandTotal)}
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <PackageX size={40} strokeWidth={1.2} />
          <p className="text-sm">Busca y agrega productos para registrar merma</p>
        </div>
      )}

      {/* ── Save Button ───────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-[var(--accent-line)] shadow-2xl" style={{ background: 'var(--bento-card)' }}>
          <div className="text-sm text-[var(--text-2)]">
            <span className="font-semibold text-[var(--text-1)]">{items.length}</span> producto{items.length !== 1 ? 's' : ''} — <span className="font-bold text-red-400">{formatCurrency(grandTotal)}</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || items.length === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {saving ? 'Guardando...' : 'Registrar merma'}
          </button>
        </div>
      )}

      {/* ── Recent Waste Log ──────────────────────────────────── */}
      {recentLog.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wider">
            Registros recientes de merma
          </h3>
          <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--accent-line)]">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Fecha</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] hidden sm:table-cell">Almacen</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Items</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Total</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] hidden md:table-cell">Productos</th>
                </tr>
              </thead>
              <tbody>
                {recentLog.map((entry, idx) => {
                  const itemCount = entry.data?.items?.length || 0
                  const total = entry.data?.total || 0
                  const warehouseLabel = (entry.data as Record<string, unknown>)?.warehouse_label as string || entry.data?.warehouse || '--'
                  const productNames = (entry.data?.items || []).map((i: any) => i.producto).filter(Boolean).slice(0, 3)
                  const createdAt = entry.data?.created_at
                  const time = createdAt ? new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''

                  return (
                    <tr key={entry.data_key || idx} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 text-[var(--text-1)] whitespace-nowrap">
                        <div className="text-sm">{entry.fecha}</div>
                        {time && <div className="text-xs text-[var(--text-3)]">{time}</div>}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-2)] text-sm hidden sm:table-cell">{warehouseLabel}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-2)] tabular-nums">{itemCount}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-400 tabular-nums">{formatCurrency(total)}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-3)] hidden md:table-cell max-w-[300px]">
                        <span className="truncate block">{productNames.join(', ')}{itemCount > 3 ? ` +${itemCount - 3} mas` : ''}</span>
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
