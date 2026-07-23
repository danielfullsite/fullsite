'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Factory, DollarSign, Package, Clock, Search, Plus, Save,
  Trash2, CheckCircle, AlertTriangle, Loader2, ChevronDown,
} from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import { sbPost, sbGet } from '@/lib/supabase-helpers'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

// ── Types ──────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  inv_final_qty: number
  costo_promedio: number
}

interface RecipeLine {
  ingredient_id: string
  ingredient_name?: string
  quantity: number
  unit?: string
  costo_unitario?: number
}

interface ProductOption {
  id: string
  nombre: string
  tipo: 'subproducto' | 'receta'
  receta: RecipeLine[]
  costo_unitario: number
}

interface ProductionLine {
  id: string
  producto: string
  productoId: string
  cantidad: number
  almacenDestino: string
  receta: RecipeLine[]
  costoUnitario: number
  costoTotal: number
  notas: string
  ingredientesOk: boolean
}

interface ProductionLog {
  data_key: string
  fecha: string
  data: {
    producto: string
    cantidad: number
    almacen: string
    costo_total: number
    status: string
    created_at: string
    notas?: string
    ingredientes?: RecipeLine[]
  }
}

type ProductionStatus = 'completada' | 'en_proceso' | 'cancelada'

// ── Constants ──────────────────────────────────────────────────────

const ALMACENES = ['Cocina', 'Barra', 'Panaderia', 'Market']

const STATUS_CONFIG: Record<ProductionStatus, { label: string; bg: string; text: string }> = {
  completada: { label: 'Completada', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  en_proceso: { label: 'En proceso', bg: 'bg-amber-500/15', text: 'text-amber-400' },
  cancelada: { label: 'Cancelada', bg: 'bg-red-500/15', text: 'text-red-400' },
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ────────────────────────────────────────────────────────

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

function deepParse(val: unknown): unknown {
  if (typeof val !== 'string') return val
  try {
    const parsed = JSON.parse(val)
    if (typeof parsed === 'string') return deepParse(parsed)
    return parsed
  } catch {
    return val
  }
}

// ── Component ──────────────────────────────────────────────────────

export default function ProduccionPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [lines, setLines] = useState<ProductionLine[]>([])
  const [logs, setLogs] = useState<ProductionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [logSearch, setLogSearch] = useState('')

  // Form state
  const [formSearch, setFormSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null)
  const [formQty, setFormQty] = useState(1)
  const [formAlmacen, setFormAlmacen] = useState('Cocina')
  const [formNotas, setFormNotas] = useState('')

  // ── Load data ────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()

        // Load inventory, recipes, and production logs in parallel
        const [invResult, recipesResult, logsResult] = await Promise.all([
          getWansoftDataLatest('inventory_parsed'),
          // Fetch pos_recipes with ingredient details
          fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${clientId}&select=menu_item_id,menu_item_name,ingredient_id,quantity&limit=5000`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          }).then(r => r.ok ? r.json() : []).catch(() => []),
          // Fetch production logs
          fetch(`${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=like.production_order_*&order=fecha.desc,data_key.desc&limit=50`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          }).then(r => r.ok ? r.json() : []).catch(() => []),
        ])

        // Parse inventory
        let invItems: InventoryItem[] = []
        if (invResult?.data) {
          const raw = Array.isArray(invResult.data) ? invResult.data : (invResult.data as Record<string, unknown>)?.items || []
          invItems = (raw as Record<string, unknown>[]).map((r) => ({
            almacen: String(r.almacen || ''),
            codigo: String(r.codigo || ''),
            producto: String(r.producto || ''),
            departamento: String(r.departamento || ''),
            inv_final_qty: Number(r.inv_final_qty) || 0,
            costo_promedio: Number(r.costo_promedio) || 0,
          }))
        }
        setInventory(invItems)

        // Build product options from recipes
        const recipeMap = new Map<string, { name: string; lines: RecipeLine[] }>()
        if (Array.isArray(recipesResult)) {
          for (const r of recipesResult as Record<string, unknown>[]) {
            const itemId = String(r.menu_item_id || '')
            const itemName = String(r.menu_item_name || '')
            if (!itemId) continue
            if (!recipeMap.has(itemId)) {
              recipeMap.set(itemId, { name: itemName, lines: [] })
            }
            recipeMap.get(itemId)!.lines.push({
              ingredient_id: String(r.ingredient_id || ''),
              quantity: Number(r.quantity) || 0,
            })
          }
        }

        // Also fetch ingredient names/costs for display
        const ingredientIds = new Set<string>()
        recipeMap.forEach(v => v.lines.forEach(l => ingredientIds.add(l.ingredient_id)))

        let ingredientMap = new Map<string, { name: string; unit: string; cost: number }>()
        if (ingredientIds.size > 0) {
          try {
            const ingResult = await fetch(
              `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${clientId}&select=id,name,unit,cost_per_unit&limit=2000`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
            )
            if (ingResult.ok) {
              const ings = await ingResult.json() as Record<string, unknown>[]
              for (const ing of ings) {
                ingredientMap.set(String(ing.id), {
                  name: String(ing.name || ''),
                  unit: String(ing.unit || 'pz'),
                  cost: Number(ing.cost_per_unit) || 0,
                })
              }
            }
          } catch { /* ignore */ }
        }

        // Build product options
        const opts: ProductOption[] = []
        recipeMap.forEach((val, key) => {
          const enrichedLines = val.lines.map(l => {
            const ing = ingredientMap.get(l.ingredient_id)
            return {
              ...l,
              ingredient_name: ing?.name || l.ingredient_id,
              unit: ing?.unit || 'pz',
              costo_unitario: ing?.cost || 0,
            }
          })
          const costoUnit = enrichedLines.reduce((s, l) => s + l.quantity * (l.costo_unitario || 0), 0)
          opts.push({
            id: key,
            nombre: val.name,
            tipo: 'receta',
            receta: enrichedLines,
            costo_unitario: costoUnit,
          })
        })

        // Also add subproductos from inventory that look like produced items
        const producedKeywords = ['salsa', 'masa', 'pan ', 'base ', 'mezcla', 'aderezo', 'dough', 'bread', 'crema de', 'prep ']
        invItems.forEach(item => {
          const lower = item.producto.toLowerCase()
          const isProduced = producedKeywords.some(kw => lower.includes(kw))
          if (isProduced && !opts.some(o => o.nombre.toLowerCase() === lower)) {
            opts.push({
              id: `inv-${item.codigo}`,
              nombre: item.producto,
              tipo: 'subproducto',
              receta: [],
              costo_unitario: item.costo_promedio,
            })
          }
        })

        setProducts(opts.sort((a, b) => a.nombre.localeCompare(b.nombre)))

        // Parse production logs
        const parsedLogs: ProductionLog[] = (logsResult as Record<string, unknown>[]).map(row => {
          const data = deepParse(row.data) as Record<string, unknown>
          return {
            data_key: String(row.data_key || ''),
            fecha: String(row.fecha || ''),
            data: {
              producto: String(data?.producto || ''),
              cantidad: Number(data?.cantidad) || 0,
              almacen: String(data?.almacen || ''),
              costo_total: Number(data?.costo_total) || 0,
              status: String(data?.status || 'completada'),
              created_at: String(data?.created_at || ''),
              notas: String(data?.notas || ''),
              ingredientes: Array.isArray(data?.ingredientes) ? data.ingredientes as RecipeLine[] : [],
            },
          }
        })
        setLogs(parsedLogs)
      } catch (e) {
        console.error('[produccion] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Ingredient availability check ────────────────────────────────

  const checkIngredients = useCallback((receta: RecipeLine[], qty: number): boolean => {
    if (receta.length === 0) return true
    for (const line of receta) {
      const needed = line.quantity * qty
      const available = inventory
        .filter(i => i.codigo === line.ingredient_id || i.producto.toLowerCase() === (line.ingredient_name || '').toLowerCase())
        .reduce((sum, i) => sum + i.inv_final_qty, 0)
      if (available < needed) return false
    }
    return true
  }, [inventory])

  // ── Add production line ──────────────────────────────────────────

  const addLine = useCallback(() => {
    if (!selectedProduct) return

    const ingredientesOk = checkIngredients(selectedProduct.receta, formQty)

    const newLine: ProductionLine = {
      id: uid(),
      producto: selectedProduct.nombre,
      productoId: selectedProduct.id,
      cantidad: formQty,
      almacenDestino: formAlmacen,
      receta: selectedProduct.receta,
      costoUnitario: selectedProduct.costo_unitario,
      costoTotal: selectedProduct.costo_unitario * formQty,
      notas: formNotas,
      ingredientesOk,
    }

    setLines(prev => [...prev, newLine])
    setSelectedProduct(null)
    setFormQty(1)
    setFormNotas('')
    setFormSearch('')
    setSaved(false)
  }, [selectedProduct, formQty, formAlmacen, formNotas, checkIngredients])

  // ── Remove line ──────────────────────────────────────────────────

  const removeLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id))
    setSaved(false)
  }, [])

  // ── Update quantity ──────────────────────────────────────────────

  const updateQty = useCallback((id: string, qty: number) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      return {
        ...l,
        cantidad: qty,
        costoTotal: l.costoUnitario * qty,
        ingredientesOk: checkIngredients(l.receta, qty),
      }
    }))
    setSaved(false)
  }, [checkIngredients])

  // ── Save production orders ───────────────────────────────────────

  const saveOrders = useCallback(async () => {
    if (lines.length === 0) return
    setSaving(true)
    try {
      const clientId = getActiveClientSlug()
      const ts = nowKey()
      let allOk = true

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const dataKey = `production_order_${ts}_${String(i).padStart(2, '0')}`

        const ok = await sbPost('wansoft_data', clientId, {
          data_key: dataKey,
          fecha: todayISO(),
          data: {
            producto: line.producto,
            producto_id: line.productoId,
            cantidad: line.cantidad,
            almacen: line.almacenDestino,
            costo_unitario: line.costoUnitario,
            costo_total: line.costoTotal,
            ingredientes: line.receta.map(r => ({
              ingredient_id: r.ingredient_id,
              ingredient_name: r.ingredient_name,
              cantidad_necesaria: r.quantity * line.cantidad,
              costo_unitario: r.costo_unitario,
            })),
            notas: line.notas,
            status: 'completada',
            created_at: new Date().toISOString(),
          },
        }, { upsert: true })

        if (!ok) allOk = false
      }

      if (allOk) {
        setSaved(true)
        // Add to local logs
        const newLogs: ProductionLog[] = lines.map((line, i) => ({
          data_key: `production_order_${ts}_${String(i).padStart(2, '0')}`,
          fecha: todayISO(),
          data: {
            producto: line.producto,
            cantidad: line.cantidad,
            almacen: line.almacenDestino,
            costo_total: line.costoTotal,
            status: 'completada',
            created_at: new Date().toISOString(),
            notas: line.notas,
          },
        }))
        setLogs(prev => [...newLogs, ...prev])
        setLines([])
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (e) {
      console.error('[produccion] Save error:', e)
    }
    setSaving(false)
  }, [lines])

  // ── Filtered products for search ─────────────────────────────────

  const filteredProducts = useMemo(() => {
    const sorted = [...products].sort((a, b) => a.nombre.localeCompare(b.nombre))
    if (!formSearch) return sorted.slice(0, 15)
    const q = formSearch.toLowerCase()
    return sorted.filter(p => p.nombre.toLowerCase().includes(q)).slice(0, 15)
  }, [products, formSearch])

  // ── Filtered log entries ─────────────────────────────────────────

  const filteredLogs = useMemo(() => {
    if (!logSearch) return logs
    const q = logSearch.toLowerCase()
    return logs.filter(l =>
      l.data.producto.toLowerCase().includes(q) ||
      l.data.almacen.toLowerCase().includes(q)
    )
  }, [logs, logSearch])

  // ── KPIs ─────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const today = todayISO()
    const todayLogs = logs.filter(l => l.fecha === today)
    const completadas = todayLogs.filter(l => l.data.status === 'completada')
    const pendientes = todayLogs.filter(l => l.data.status === 'en_proceso')

    return {
      produccionesHoy: todayLogs.length,
      costoTotal: completadas.reduce((s, l) => s + l.data.costo_total, 0),
      itemsProducidos: completadas.reduce((s, l) => s + l.data.cantidad, 0),
      pendientes: pendientes.length + lines.length,
    }
  }, [logs, lines])

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Ordenes de Produccion"
        subtitle="Produccion interna (panaderia, salsas, bases)"
        action={
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 active:scale-95 transition-all min-h-[44px]"
            >
              <Plus size={16} />
              Nueva Produccion
            </button>
            <button
              onClick={saveOrders}
              disabled={saving || lines.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500/15 text-blue-400 font-semibold text-sm hover:bg-blue-500/25 active:scale-95 transition-all disabled:opacity-50 min-h-[44px]"
            >
              {saving ? (
                <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
              ) : (
                <Save size={16} />
              )}
              {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar todo'}
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Producciones hoy"
          value={String(kpis.produccionesHoy)}
          icon={Factory}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Costo total producido"
          value={formatCurrency(kpis.costoTotal)}
          icon={DollarSign}
          accentClass="kpi-accent-amber"
          index={1}
        />
        <KPICard
          label="Items producidos"
          value={String(kpis.itemsProducidos)}
          icon={Package}
          accentClass="kpi-accent-green"
          index={2}
        />
        <KPICard
          label="Pendientes"
          value={String(kpis.pendientes)}
          icon={Clock}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* New production form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--surface-1)] rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-[var(--border)] shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-lg font-semibold text-[var(--text-1)]">Nueva produccion</h3>
              <button
                onClick={() => { setShowForm(false); setSelectedProduct(null); setFormSearch('') }}
                className="p-2 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)] transition-all min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Product search */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                  Producto a producir
                </label>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                  <input
                    type="text"
                    placeholder="Buscar producto o subproducto..."
                    value={selectedProduct ? selectedProduct.nombre : formSearch}
                    onChange={e => {
                      setFormSearch(e.target.value)
                      if (selectedProduct) setSelectedProduct(null)
                    }}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
                  />
                </div>

                {/* Search results dropdown */}
                {!selectedProduct && filteredProducts.length > 0 && (
                  <div className="mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] max-h-48 overflow-y-auto">
                    {filteredProducts.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProduct(p); setFormSearch('') }}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--surface-1)] transition-colors text-sm min-h-[44px]"
                      >
                        <div>
                          <span className="text-[var(--text-1)] font-medium">{p.nombre}</span>
                          {p.receta.length > 0 ? (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                              Receta · {p.receta.length} ing.
                            </span>
                          ) : (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400">
                              Sin receta · Solo aumenta inventario
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[var(--text-3)]">{formatCurrency(p.costo_unitario)}/u</span>
                      </button>
                    ))}
                  </div>
                )}

                {!selectedProduct && !formSearch && filteredProducts.length === 0 && (
                  <p className="text-xs text-[var(--text-3)] mt-2 text-center py-4">
                    No hay productos disponibles para producción. Verifica que existan recetas de producción o productos configurados para producir internamente.
                  </p>
                )}
                {!selectedProduct && formSearch && filteredProducts.length === 0 && (
                  <p className="text-xs text-[var(--text-3)] mt-1">No se encontraron productos o subproductos.</p>
                )}
              </div>

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                    Cantidad a producir
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0.5"
                    value={formQty}
                    onChange={e => setFormQty(parseFloat(e.target.value) || 1)}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px] tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                    Almacen destino
                  </label>
                  <div className="relative">
                    <select
                      value={formAlmacen}
                      onChange={e => setFormAlmacen(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px] appearance-none"
                    >
                      {ALMACENES.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Ingredients needed (from recipe) */}
              {selectedProduct && selectedProduct.receta.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                    Ingredientes necesarios (x{formQty})
                  </label>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Ingrediente</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Necesario</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Disponible</th>
                          <th className="text-center px-3 py-2 text-xs font-semibold text-[var(--text-3)]">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProduct.receta.map((r, idx) => {
                          const needed = r.quantity * formQty
                          const available = inventory
                            .filter(i => i.codigo === r.ingredient_id || i.producto.toLowerCase() === (r.ingredient_name || '').toLowerCase())
                            .reduce((sum, i) => sum + i.inv_final_qty, 0)
                          const ok = available >= needed

                          return (
                            <tr key={idx} className="border-b border-[var(--border)] last:border-0">
                              <td className="px-3 py-2 text-[var(--text-1)]">
                                {r.ingredient_name || r.ingredient_id}
                                {r.unit && <span className="text-[var(--text-3)] ml-1">({r.unit})</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--text-1)]">
                                {needed.toFixed(2)}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
                                {available.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {ok ? (
                                  <CheckCircle size={16} className="inline text-emerald-400" />
                                ) : (
                                  <AlertTriangle size={16} className="inline text-red-400" />
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Cost summary */}
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-[var(--text-3)]">Costo estimado:</span>
                    <span className="font-semibold text-[var(--text-1)] tabular-nums">
                      {formatCurrency(selectedProduct.costo_unitario * formQty)}
                    </span>
                  </div>
                </div>
              )}

              {selectedProduct && selectedProduct.receta.length === 0 && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
                  Este producto no tiene receta registrada. Se agregara sin deduccion de ingredientes.
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
                  Notas (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: doble batch para evento..."
                  value={formNotas}
                  onChange={e => setFormNotas(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-[var(--border)] flex gap-3 justify-end">
              <button
                onClick={() => { setShowForm(false); setSelectedProduct(null); setFormSearch('') }}
                className="px-4 py-2.5 rounded-xl text-[var(--text-2)] font-semibold text-sm hover:bg-[var(--surface-2)] transition-all min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                onClick={() => { addLine(); setShowForm(false) }}
                disabled={!selectedProduct}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 active:scale-95 transition-all disabled:opacity-50 min-h-[44px]"
              >
                <Plus size={16} />
                Agregar a lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current production lines (pending save) */}
      {lines.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <h3 className="font-semibold text-[var(--text-1)]">Producciones pendientes de guardar</h3>
            <span className="text-xs text-[var(--text-3)]">{lines.length} items</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Producto</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Cantidad</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Almacen</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider hidden md:table-cell">Costo Unit.</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Costo Total</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Ingredientes</th>
                  <th className="px-2 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
                  <tr key={line.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-[var(--text-1)] font-medium">{line.producto}</div>
                      {line.notas && <div className="text-xs text-[var(--text-3)] mt-0.5">{line.notas}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0.5"
                        value={line.cantidad}
                        onChange={e => updateQty(line.id, parseFloat(e.target.value) || 1)}
                        className="w-20 px-2 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-right text-[var(--text-1)] text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[40px]"
                      />
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{line.almacenDestino}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)] hidden md:table-cell">
                      {formatCurrency(line.costoUnitario)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-[var(--text-1)]">
                      {formatCurrency(line.costoTotal)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {line.receta.length === 0 ? (
                        <span className="text-xs text-[var(--text-3)]">Sin receta</span>
                      ) : line.ingredientesOk ? (
                        <CheckCircle size={16} className="inline text-emerald-400" />
                      ) : (
                        <AlertTriangle size={16} className="inline text-red-400" />
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => removeLine(line.id)}
                        className="p-2 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all min-h-[36px] min-w-[36px]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total bar */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]/50">
            <span className="text-sm text-[var(--text-3)]">{lines.length} ordenes de produccion</span>
            <div>
              <span className="text-xs text-[var(--text-3)] mr-2">Costo total:</span>
              <span className="font-bold text-[var(--text-1)] tabular-nums">
                {formatCurrency(lines.reduce((s, l) => s + l.costoTotal, 0))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Empty state (no pending lines, no logs) */}
      {lines.length === 0 && logs.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center">
          <Factory size={48} className="mx-auto mb-4 text-[var(--text-3)] opacity-50" />
          <p className="text-[var(--text-2)] font-medium text-lg mb-2">Produccion interna</p>
          <p className="text-[var(--text-3)] text-sm mb-2 max-w-md mx-auto">
            Registra las preparaciones elaboradas en tu negocio. Al producir, Fullsite:
          </p>
          <ul className="text-[var(--text-3)] text-sm mb-6 max-w-xs mx-auto text-left space-y-1">
            <li>· Calcula los ingredientes necesarios</li>
            <li>· Descuenta las materias primas del inventario</li>
            <li>· Incrementa el stock del producto terminado en el almacen seleccionado</li>
            <li>· Registra el costo de produccion automaticamente</li>
          </ul>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/15 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 active:scale-95 transition-all min-h-[48px] mx-auto"
          >
            <Plus size={18} />
            Nueva produccion
          </button>
        </div>
      )}

      {/* Production log */}
      {logs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--text-1)]">Historial de produccion</h3>
            <span className="text-xs text-[var(--text-3)]">{logs.length} registros</span>
          </div>

          {/* Log search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              placeholder="Buscar en historial..."
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
            />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Fecha</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Producto</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Cantidad</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider hidden md:table-cell">Almacen</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Costo</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, idx) => {
                    const status = (log.data.status || 'completada') as ProductionStatus
                    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.completada

                    return (
                      <tr key={`${log.data_key}-${idx}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 text-[var(--text-2)] tabular-nums whitespace-nowrap">{log.fecha}</td>
                        <td className="px-4 py-3">
                          <div className="text-[var(--text-1)] font-medium">{log.data.producto}</div>
                          {log.data.notas && <div className="text-xs text-[var(--text-3)] mt-0.5">{log.data.notas}</div>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)] font-semibold">
                          {log.data.cantidad}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-2)] hidden md:table-cell">{log.data.almacen}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">
                          {formatCurrency(log.data.costo_total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Footer count */}
      {(lines.length > 0 || logs.length > 0) && (
        <p className="text-xs text-[var(--text-3)] text-right">
          {lines.length > 0 && `${lines.length} pendientes de guardar`}
          {lines.length > 0 && logs.length > 0 && ' | '}
          {logs.length > 0 && `${logs.length} en historial`}
        </p>
      )}
    </div>
  )
}
