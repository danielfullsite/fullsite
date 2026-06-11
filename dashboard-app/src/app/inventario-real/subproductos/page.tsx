'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  Search, Plus, Trash2, Save, Loader2, X, ChevronDown, ChevronUp,
  Package, DollarSign, BarChart3, Layers, Edit3, Check, Soup,
} from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'
import { sbPost } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  critico: boolean
  inv_final_qty: number
  inv_final_val: number
  costo_promedio: number
}

interface SubproductoIngrediente {
  codigo: string
  producto: string
  cantidad: number
  unidad: string
  costo: number
}

interface Subproducto {
  id: string
  nombre: string
  categoria: string
  ingredientes: SubproductoIngrediente[]
  rendimiento_qty: number
  rendimiento_unit: string
  costo_total: number
  costo_unitario: number
  // Solo para subproductos importados de Wansoft (inventory_parsed)
  wansoft?: boolean
  codigo?: string
  departamento?: string
  stock_qty?: number
  stock_val?: number
}

// ── Constants ───────────────────────────────────────────────────────

const CATEGORIAS = ['Salsa', 'Masa', 'Base', 'Caldo', 'Aderezo', 'Otro']

const UNIDADES = ['KG', 'G', 'L', 'ML', 'PZ', 'TAZA', 'CUCHDA', 'MANOJO']

const CATEGORIA_COLORS: Record<string, string> = {
  Salsa: 'bg-red-500/15 text-red-400 border-red-500/30',
  Masa: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Base: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Caldo: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Aderezo: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  Otro: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

// ── Helpers ─────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function deepParse(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return deepParse(JSON.parse(val)) } catch { return val }
  }
  return val
}

function inferCategoria(nombre: string): string {
  const n = nombre.toUpperCase()
  if (n.includes('SALSA') || n.includes('PURE') || n.includes('PESTO')) return 'Salsa'
  if (n.includes('MASA') || n.includes('PAN ') || n.startsWith('PAN') || n.includes('ROL') || n.includes('CROISSANT') || n.includes('CRUFFIN') || n.includes('CONCHA')) return 'Masa'
  if (n.includes('BASE') || n.includes('MEZCLA') || n.includes('MIX')) return 'Base'
  if (n.includes('CONSOME') || n.includes('CALDO') || n.includes('FONDO')) return 'Caldo'
  if (n.includes('ADEREZO') || n.includes('VINAGRETA') || n.includes('GLASS') || n.includes('JARABE')) return 'Aderezo'
  return 'Otro'
}

// Receta de subproducto scrapeada de Wansoft (Production/GetSubProductRecipe)
interface WansoftSubRecipe {
  name: string
  ingredientes: SubproductoIngrediente[]
}

// Convierte ingredientes crudos de Wansoft a nuestro formato, costeando con inventario
function parseSubRecipes(parsed: unknown, inventory: InventoryItem[]): Map<string, WansoftSubRecipe> {
  const map = new Map<string, WansoftSubRecipe>()
  if (!Array.isArray(parsed)) return map
  const invByCode = new Map<string, InventoryItem>()
  for (const item of inventory) {
    if (item.codigo && !invByCode.has(item.codigo)) invByCode.set(item.codigo, item)
  }
  for (const r of parsed as Record<string, unknown>[]) {
    const name = String(r.name || '').trim()
    const rawIngs = Array.isArray(r.ingredients) ? r.ingredients as Record<string, unknown>[] : []
    if (!name || rawIngs.length === 0) continue
    const ingredientes: SubproductoIngrediente[] = rawIngs.map(ing => {
      const codigo = String(ing.InternalCode || '')
      const cantidad = Number(ing.Quantity) || 0
      let costo = Number(ing.Cost) || 0
      if (!costo) {
        const inv = invByCode.get(codigo)
        if (inv) costo = inv.costo_promedio * cantidad
      }
      return {
        codigo,
        producto: String(ing.RawMaterialName || ''),
        cantidad,
        unidad: String(ing.UnitOfMeasureDescription || ''),
        costo,
      }
    })
    map.set(name.toUpperCase(), { name, ingredientes })
  }
  return map
}

// Construye subproductos a partir del inventario Wansoft (departamentos SUBS%)
// + recetas scrapeadas (subproduct_recipes)
function buildWansoftSubs(
  inventory: InventoryItem[],
  recipes: Map<string, WansoftSubRecipe>,
): Subproducto[] {
  const map = new Map<string, Subproducto>()
  for (const item of inventory) {
    if (!item.departamento.toUpperCase().startsWith('SUBS')) continue
    if (!item.producto) continue
    const key = item.codigo || item.producto
    const prev = map.get(key)
    if (prev) {
      prev.stock_qty = (prev.stock_qty || 0) + item.inv_final_qty
      prev.stock_val = (prev.stock_val || 0) + item.inv_final_val
      if (!prev.costo_unitario && item.costo_promedio) {
        prev.costo_unitario = item.costo_promedio
        prev.costo_total = item.costo_promedio
      }
    } else {
      map.set(key, {
        id: `ws_${key}`,
        nombre: item.producto,
        categoria: inferCategoria(item.producto),
        ingredientes: [],
        rendimiento_qty: 1,
        rendimiento_unit: 'PZ',
        costo_total: item.costo_promedio,
        costo_unitario: item.costo_promedio,
        wansoft: true,
        codigo: item.codigo,
        departamento: item.departamento,
        stock_qty: item.inv_final_qty,
        stock_val: item.inv_final_val,
      })
    }
  }
  // Adjuntar recetas por nombre
  const usedRecipes = new Set<string>()
  for (const sp of map.values()) {
    const rec = recipes.get(sp.nombre.toUpperCase())
    if (rec) {
      sp.ingredientes = rec.ingredientes
      const recipeCost = rec.ingredientes.reduce((s, i) => s + i.costo, 0)
      if (recipeCost > 0) sp.costo_total = recipeCost
      usedRecipes.add(sp.nombre.toUpperCase())
    }
  }
  // Recetas de Wansoft sin item de inventario SUBS (ej. productos MARCA PROPIA)
  for (const [key, rec] of recipes) {
    if (usedRecipes.has(key)) continue
    const recipeCost = rec.ingredientes.reduce((s, i) => s + i.costo, 0)
    map.set(`rec_${key}`, {
      id: `wsr_${key}`,
      nombre: rec.name,
      categoria: inferCategoria(rec.name),
      ingredientes: rec.ingredientes,
      rendimiento_qty: 1,
      rendimiento_unit: 'PZ',
      costo_total: recipeCost,
      costo_unitario: recipeCost,
      wansoft: true,
    })
  }
  return Array.from(map.values())
}

// ── Component ───────────────────────────────────────────────────────

export default function SubproductosPage() {
  // ── State ─────────────────────────────────────────────────────────
  const [subproductos, setSubproductos] = useState<Subproducto[]>([])
  const [wansoftSubs, setWansoftSubs] = useState<Subproducto[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formNombre, setFormNombre] = useState('')
  const [formCategoria, setFormCategoria] = useState('Salsa')
  const [formIngredientes, setFormIngredientes] = useState<SubproductoIngrediente[]>([])
  const [formRendimientoQty, setFormRendimientoQty] = useState<number>(1)
  const [formRendimientoUnit, setFormRendimientoUnit] = useState('KG')

  // Ingredient search
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [showIngredientDropdown, setShowIngredientDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // List filter
  const [filterCategoria, setFilterCategoria] = useState<string>('Todas')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Load data ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        // Load subproductos
        const spResult = await getWansoftDataLatest('subproductos')
        if (spResult) {
          const parsed = deepParse(spResult.data)
          if (Array.isArray(parsed)) {
            setSubproductos(parsed as Subproducto[])
          }
        }

        // Load inventory + recetas de subproductos Wansoft en paralelo
        const [invResult, recResult] = await Promise.all([
          getWansoftDataLatest('inventory_parsed'),
          getWansoftDataLatest('subproduct_recipes'),
        ])
        if (invResult) {
          const parsed = deepParse(invResult.data)
          const arr = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.items
          if (Array.isArray(arr)) {
            const inv = arr.map((r: Record<string, unknown>) => ({
              almacen: String(r.almacen || ''),
              codigo: String(r.codigo || ''),
              producto: String(r.producto || ''),
              departamento: String(r.departamento || ''),
              critico: Boolean(r.critico),
              inv_final_qty: Number(r.inv_final_qty) || 0,
              inv_final_val: Number(r.inv_final_val) || 0,
              costo_promedio: Number(r.costo_promedio) || 0,
            }))
            setInventory(inv)
            const recipes = recResult
              ? parseSubRecipes(deepParse(recResult.data), inv)
              : new Map<string, WansoftSubRecipe>()
            setWansoftSubs(buildWansoftSubs(inv, recipes))
          }
        }
      } catch (e) {
        console.error('[subproductos] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowIngredientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Save to Supabase ──────────────────────────────────────────────
  const saveSubproductos = useCallback(async (data: Subproducto[]) => {
    setSaving(true)
    setSaveMessage(null)
    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: 'subproductos',
        fecha: todayISO(),
        data: JSON.stringify(data),
      }, { upsert: true })
      if (ok) {
        setSaveMessage({ type: 'success', text: 'Subproductos guardados' })
      } else {
        setSaveMessage({ type: 'error', text: 'Error al guardar' })
      }
    } catch {
      setSaveMessage({ type: 'error', text: 'Error de red' })
    }
    setSaving(false)
    setTimeout(() => setSaveMessage(null), 3000)
  }, [])

  // ── Form helpers ──────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setFormNombre('')
    setFormCategoria('Salsa')
    setFormIngredientes([])
    setFormRendimientoQty(1)
    setFormRendimientoUnit('KG')
    setEditingId(null)
    setShowForm(false)
  }, [])

  const openEdit = useCallback((sp: Subproducto) => {
    setFormNombre(sp.nombre)
    setFormCategoria(sp.categoria)
    setFormIngredientes([...sp.ingredientes])
    setFormRendimientoQty(sp.rendimiento_qty)
    setFormRendimientoUnit(sp.rendimiento_unit)
    setEditingId(sp.id)
    setShowForm(true)
  }, [])

  const addIngredient = useCallback((item: InventoryItem) => {
    const already = formIngredientes.find(i => i.codigo === item.codigo)
    if (already) return
    setFormIngredientes(prev => [...prev, {
      codigo: item.codigo,
      producto: item.producto,
      cantidad: 1,
      unidad: 'KG',
      costo: item.costo_promedio,
    }])
    setIngredientSearch('')
    setShowIngredientDropdown(false)
  }, [formIngredientes])

  const updateIngredient = useCallback((idx: number, field: string, value: string | number) => {
    setFormIngredientes(prev => prev.map((ing, i) => {
      if (i !== idx) return ing
      const updated = { ...ing, [field]: value }
      // Recalculate cost if quantity changes
      if (field === 'cantidad') {
        const invItem = inventory.find(inv => inv.codigo === ing.codigo)
        if (invItem) {
          updated.costo = invItem.costo_promedio * Number(value)
        }
      }
      return updated
    }))
  }, [inventory])

  const removeIngredient = useCallback((idx: number) => {
    setFormIngredientes(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // ── Calculate costs ───────────────────────────────────────────────
  const formCostoTotal = useMemo(() =>
    formIngredientes.reduce((s, i) => s + i.costo, 0)
  , [formIngredientes])

  const formCostoUnitario = useMemo(() =>
    formRendimientoQty > 0 ? formCostoTotal / formRendimientoQty : 0
  , [formCostoTotal, formRendimientoQty])

  // ── Submit form ───────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!formNombre.trim()) return
    if (formIngredientes.length === 0) return

    const sp: Subproducto = {
      id: editingId || uid(),
      nombre: formNombre.trim(),
      categoria: formCategoria,
      ingredientes: formIngredientes,
      rendimiento_qty: formRendimientoQty,
      rendimiento_unit: formRendimientoUnit,
      costo_total: formCostoTotal,
      costo_unitario: formCostoUnitario,
    }

    let updated: Subproducto[]
    if (editingId) {
      updated = subproductos.map(s => s.id === editingId ? sp : s)
    } else {
      updated = [...subproductos, sp]
    }

    setSubproductos(updated)
    await saveSubproductos(updated)
    resetForm()
  }, [
    formNombre, formCategoria, formIngredientes, formRendimientoQty,
    formRendimientoUnit, formCostoTotal, formCostoUnitario,
    editingId, subproductos, saveSubproductos, resetForm,
  ])

  const handleDelete = useCallback(async (id: string) => {
    const updated = subproductos.filter(s => s.id !== id)
    setSubproductos(updated)
    await saveSubproductos(updated)
  }, [subproductos, saveSubproductos])

  // ── Filtered search for ingredients ───────────────────────────────
  const filteredInventory = useMemo(() => {
    if (!ingredientSearch.trim()) return []
    const q = ingredientSearch.toLowerCase()
    return inventory
      .filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q)
      )
      .slice(0, 15)
  }, [ingredientSearch, inventory])

  // ── Combined list: manuales + importados de Wansoft ──────────────
  const allSubproductos = useMemo(() => {
    // Si un manual tiene el mismo nombre que uno de Wansoft, gana el manual
    const manualNames = new Set(subproductos.map(s => s.nombre.toUpperCase()))
    return [...subproductos, ...wansoftSubs.filter(w => !manualNames.has(w.nombre.toUpperCase()))]
  }, [subproductos, wansoftSubs])

  // ── Filtered subproductos list ────────────────────────────────────
  const filteredSubproductos = useMemo(() => {
    let list = allSubproductos
    if (filterCategoria !== 'Todas') {
      list = list.filter(s => s.categoria === filterCategoria)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(s => s.nombre.toLowerCase().includes(q))
    }
    return list.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [allSubproductos, filterCategoria, searchQuery])

  // ── KPIs ──────────────────────────────────────────────────────────
  const kpiTotal = allSubproductos.length
  const conCosto = allSubproductos.filter(sp => sp.costo_unitario > 0)
  const kpiCostoPromedio = conCosto.length > 0
    ? conCosto.reduce((s, sp) => s + sp.costo_unitario, 0) / conCosto.length
    : 0
  const kpiMasUsado = useMemo(() => {
    const withIng = allSubproductos.filter(sp => sp.ingredientes.length > 0)
    if (withIng.length === 0) return 'N/A'
    return withIng.reduce((best, sp) =>
      sp.ingredientes.length > best.ingredientes.length ? sp : best
    , withIng[0]).nombre
  }, [allSubproductos])
  const kpiSinReceta = allSubproductos.filter(s => s.ingredientes.length === 0).length

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subproductos"
        subtitle="Recetas intermedias (bases, salsas, masas)"
        action={
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <Plus size={16} /> Nuevo subproducto
          </button>
        }
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Total subproductos"
          value={String(kpiTotal)}
          icon={Layers}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Costo promedio"
          value={formatCurrency(kpiCostoPromedio)}
          subtitle="por unidad de rendimiento"
          icon={DollarSign}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Mas complejo"
          value={kpiMasUsado.length > 18 ? kpiMasUsado.slice(0, 18) + '...' : kpiMasUsado}
          subtitle="mas ingredientes"
          icon={Soup}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Sin receta"
          value={String(kpiSinReceta)}
          subtitle="sin ingredientes asignados"
          icon={Package}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* ── Save message ── */}
      {saveMessage && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          saveMessage.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {saveMessage.text}
        </div>
      )}

      {/* ── Create / Edit form ── */}
      {showForm && (
        <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
              {editingId ? <Edit3 size={16} className="text-amber-400" /> : <Plus size={16} className="text-blue-400" />}
              {editingId ? 'Editar subproducto' : 'Nuevo subproducto'}
            </h3>
            <button onClick={resetForm} className="text-[var(--text-4)] hover:text-[var(--text-2)] transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Name + Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Nombre
              </label>
              <input
                type="text"
                value={formNombre}
                onChange={e => setFormNombre(e.target.value)}
                placeholder="Ej. Salsa Mamarosa"
                className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] px-3 py-2.5
                  text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Categoria
              </label>
              <select
                value={formCategoria}
                onChange={e => setFormCategoria(e.target.value)}
                className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] px-3 py-2.5
                  text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500/50"
              >
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Rendimiento */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Rendimiento (cantidad producida)
              </label>
              <input
                type="number"
                value={formRendimientoQty}
                onChange={e => setFormRendimientoQty(Number(e.target.value) || 0)}
                min={0.01}
                step={0.1}
                className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] px-3 py-2.5
                  text-sm text-[var(--text-1)] font-mono focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Unidad de rendimiento
              </label>
              <select
                value={formRendimientoUnit}
                onChange={e => setFormRendimientoUnit(e.target.value)}
                className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] px-3 py-2.5
                  text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500/50"
              >
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Ingredient search */}
          <div className="mb-4">
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
              Agregar ingrediente del inventario
            </label>
            <div ref={searchRef} className="relative">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
                <input
                  type="text"
                  value={ingredientSearch}
                  onChange={e => { setIngredientSearch(e.target.value); setShowIngredientDropdown(true) }}
                  onFocus={() => ingredientSearch.trim() && setShowIngredientDropdown(true)}
                  placeholder="Buscar producto por nombre o codigo..."
                  className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] pl-9 pr-3 py-2.5
                    text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500/50"
                />
              </div>
              {showIngredientDropdown && filteredInventory.length > 0 && (
                <div className="absolute z-50 w-full mt-1 rounded-xl border border-[var(--accent-line)] bg-[var(--surface-1)] shadow-2xl max-h-60 overflow-y-auto">
                  {filteredInventory.map(item => (
                    <button
                      key={item.codigo}
                      onClick={() => addIngredient(item)}
                      className="w-full px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between gap-3
                        border-b border-[var(--accent-line)]/50 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-[var(--text-1)]">{item.producto}</p>
                        <p className="text-[11px] text-[var(--text-4)]">{item.codigo} - {item.almacen}</p>
                      </div>
                      <span className="text-xs font-mono text-[var(--text-3)] shrink-0">
                        {formatCurrency(item.costo_promedio)}/u
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Ingredients list */}
          {formIngredientes.length > 0 && (
            <div className="mb-5">
              <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--accent-line)]">
                      <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Producto</th>
                      <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] w-24">Cantidad</th>
                      <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] w-20">Unidad</th>
                      <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] w-24">Costo</th>
                      <th className="px-3 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {formIngredientes.map((ing, idx) => (
                      <tr key={ing.codigo} className="border-b border-[var(--accent-line)]/50">
                        <td className="px-3 py-2 text-[var(--text-1)] font-medium">
                          <p className="text-sm">{ing.producto}</p>
                          <p className="text-[10px] text-[var(--text-4)]">{ing.codigo}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={ing.cantidad}
                            onChange={e => updateIngredient(idx, 'cantidad', Number(e.target.value) || 0)}
                            min={0.01}
                            step={0.1}
                            className="w-full text-right rounded-lg border border-[var(--accent-line)] bg-[var(--surface-2)] px-2 py-1.5
                              text-xs font-mono text-[var(--text-1)] focus:outline-none focus:border-blue-500/50"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={ing.unidad}
                            onChange={e => updateIngredient(idx, 'unidad', e.target.value)}
                            className="w-full rounded-lg border border-[var(--accent-line)] bg-[var(--surface-2)] px-1.5 py-1.5
                              text-xs text-center text-[var(--text-1)] focus:outline-none focus:border-blue-500/50"
                          >
                            {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-[var(--text-1)] tnum">
                          {formatCurrency(ing.costo)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeIngredient(idx)}
                            className="text-[var(--text-4)] hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cost summary */}
          <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--accent-line)] p-4 mb-5">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Costo total</p>
                <p className="text-lg font-bold font-mono text-[var(--text-1)] tnum">{formatCurrency(formCostoTotal)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Rendimiento</p>
                <p className="text-lg font-bold font-mono text-[var(--text-1)] tnum">
                  {formRendimientoQty} {formRendimientoUnit}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Costo unitario</p>
                <p className="text-lg font-bold font-mono text-emerald-400 tnum">
                  {formatCurrency(formCostoUnitario)}/{formRendimientoUnit}
                </p>
              </div>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={resetForm}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--text-3)] hover:text-[var(--text-1)]
                border border-[var(--accent-line)] hover:border-[var(--text-4)] transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!formNombre.trim() || formIngredientes.length === 0 || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                bg-blue-600 hover:bg-blue-500 text-white transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Guardar cambios' : 'Crear subproducto'}
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar subproducto..."
            className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--surface-2)] pl-9 pr-3 py-2
              text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {['Todas', ...CATEGORIAS].map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategoria(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterCategoria === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] border border-[var(--accent-line)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Subproductos list ── */}
      {filteredSubproductos.length === 0 ? (
        <div className="rounded-2xl border border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
          <Soup size={40} className="mx-auto text-[var(--text-4)] mb-3" />
          <p className="text-[var(--text-3)]">
            {allSubproductos.length === 0
              ? 'No hay subproductos registrados.'
              : 'No hay subproductos que coincidan con el filtro.'}
          </p>
          <p className="text-[var(--text-4)] text-sm mt-1">
            {allSubproductos.length === 0
              ? 'Crea tu primera receta intermedia con el boton de arriba.'
              : 'Prueba con otro termino de busqueda o categoria.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSubproductos.map(sp => {
            const isExpanded = expandedId === sp.id
            return (
              <div
                key={sp.id}
                className="rounded-2xl border border-[var(--accent-line)] overflow-hidden transition-colors"
                style={{ background: 'var(--bento-card)' }}
              >
                {/* Row header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : sp.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <h4 className="text-sm font-bold text-[var(--text-1)] truncate">{sp.nombre}</h4>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                        CATEGORIA_COLORS[sp.categoria] || CATEGORIA_COLORS.Otro
                      }`}>
                        {sp.categoria}
                      </span>
                      {sp.wansoft && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold border bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
                          Wansoft
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
                      {sp.wansoft ? (
                        <>
                          <span className="font-mono">{sp.codigo}</span>
                          <span>{sp.departamento}</span>
                          <span>Stock: {Math.round((sp.stock_qty || 0) * 100) / 100}</span>
                        </>
                      ) : (
                        <>
                          <span>{sp.ingredientes.length} ingredientes</span>
                          <span>Rinde {sp.rendimiento_qty} {sp.rendimiento_unit}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--text-4)]">Costo unitario</p>
                    <p className="text-sm font-bold font-mono text-emerald-400 tnum">
                      {formatCurrency(sp.costo_unitario)}/{sp.rendimiento_unit}
                    </p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-[var(--text-4)]">Costo total</p>
                    <p className="text-sm font-bold font-mono text-[var(--text-1)] tnum">
                      {formatCurrency(sp.costo_total)}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronUp size={16} className="text-[var(--text-4)] shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-[var(--text-4)] shrink-0" />
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[var(--accent-line)] px-5 py-4">
                    {/* Wansoft sub: stock detail */}
                    {sp.wansoft && (
                      <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--accent-line)] p-4 mb-4">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Stock actual</p>
                            <p className="text-base font-bold font-mono text-[var(--text-1)] tnum">{Math.round((sp.stock_qty || 0) * 100) / 100}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Valor en inventario</p>
                            <p className="text-base font-bold font-mono text-[var(--text-1)] tnum">{formatCurrency(sp.stock_val || 0)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Costo promedio</p>
                            <p className="text-base font-bold font-mono text-emerald-400 tnum">{formatCurrency(sp.costo_unitario)}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {sp.wansoft && sp.ingredientes.length === 0 && (
                      <p className="text-xs text-[var(--text-4)] mb-2">
                        Receta importada de Wansoft sin ingredientes detallados. Puedes crear un subproducto manual con el mismo nombre para definir su receta.
                      </p>
                    )}
                    {/* Ingredients table */}
                    {!(sp.wansoft && sp.ingredientes.length === 0) && (
                    <h5 className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-3">
                      Ingredientes
                    </h5>
                    )}
                    {!(sp.wansoft && sp.ingredientes.length === 0) && (
                    <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden mb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--accent-line)]">
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Producto</th>
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Codigo</th>
                            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Cantidad</th>
                            <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Unidad</th>
                            <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sp.ingredientes.map((ing, idx) => (
                            <tr key={`${ing.codigo}-${idx}`} className="border-b border-[var(--accent-line)]/50">
                              <td className="px-3 py-2 text-[var(--text-1)] font-medium">{ing.producto}</td>
                              <td className="px-3 py-2 text-[var(--text-4)] font-mono text-xs">{ing.codigo}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs tnum text-[var(--text-2)]">{ing.cantidad}</td>
                              <td className="px-3 py-2 text-center text-xs text-[var(--text-3)]">{ing.unidad}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs font-semibold tnum text-[var(--text-1)]">{formatCurrency(ing.costo)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                            <td colSpan={4} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--text-1)]">
                              Total receta
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                              {formatCurrency(sp.costo_total)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    )}

                    {/* Cost breakdown */}
                    {!sp.wansoft && (
                    <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--accent-line)] p-4 mb-4">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Costo total</p>
                          <p className="text-base font-bold font-mono text-[var(--text-1)] tnum">{formatCurrency(sp.costo_total)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Rendimiento</p>
                          <p className="text-base font-bold font-mono text-[var(--text-1)] tnum">{sp.rendimiento_qty} {sp.rendimiento_unit}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-1">Costo unitario</p>
                          <p className="text-base font-bold font-mono text-emerald-400 tnum">
                            {formatCurrency(sp.costo_unitario)}/{sp.rendimiento_unit}
                          </p>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Action buttons */}
                    {!sp.wansoft && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openEdit(sp)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold
                          bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                      >
                        <Edit3 size={13} /> Editar
                      </button>
                      <button
                        onClick={() => handleDelete(sp.id)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold
                          bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                      >
                        <Trash2 size={13} /> Eliminar
                      </button>
                    </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Category breakdown chart ── */}
      {allSubproductos.length > 0 && (
        <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-400" />
            Subproductos por categoria
          </h3>
          <div className="space-y-2.5">
            {(() => {
              const catMap = new Map<string, { count: number; costoTotal: number }>()
              allSubproductos.forEach(sp => {
                const prev = catMap.get(sp.categoria) || { count: 0, costoTotal: 0 }
                catMap.set(sp.categoria, { count: prev.count + 1, costoTotal: prev.costoTotal + sp.costo_total })
              })
              const arr = Array.from(catMap.entries())
                .map(([cat, data]) => ({ cat, ...data }))
                .sort((a, b) => b.count - a.count)
              const max = arr.length > 0 ? arr[0].count : 1
              return arr.map(({ cat, count, costoTotal }) => (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                        CATEGORIA_COLORS[cat] || CATEGORIA_COLORS.Otro
                      }`}>
                        {cat}
                      </span>
                      <span className="text-xs text-[var(--text-3)]">{count} subproductos</span>
                    </div>
                    <span className="text-xs font-mono font-semibold text-[var(--text-1)] tnum">
                      {formatCurrency(costoTotal)}
                    </span>
                  </div>
                  <div className="h-5 rounded-lg bg-[var(--surface-2)] overflow-hidden">
                    <div
                      className="h-full rounded-lg"
                      style={{
                        width: `${max > 0 ? (count / max) * 100 : 0}%`,
                        background: 'linear-gradient(90deg, rgba(59,130,246,0.25), rgba(59,130,246,0.5))',
                      }}
                    />
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
