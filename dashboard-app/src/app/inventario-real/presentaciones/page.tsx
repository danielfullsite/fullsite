'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Search, Plus, Trash2, Pencil, Loader2, Package, Layers, X, Check, DollarSign, ChevronDown } from 'lucide-react'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

// ── Types ───────────────────────────────────────────────────────────

interface Presentation {
  id: string
  unit: string
  factor: number       // factor vs base unit (e.g., 1 KG = 1000 G → factor=1000 if base is G)
  default_cost: number // cost per this presentation unit
}

interface ProductPresentations {
  product_id: string
  product_name: string
  base_unit: string
  presentations: Presentation[]
}

// Catálogo plano de presentaciones de Wansoft (Inventory/Presentations)
interface WansoftPresentation {
  id: string
  clave: string
  presentacion: string
}

// ── Constants ───────────────────────────────────────────────────────

const UNITS = [
  'KG', 'G', 'L', 'ML', 'PZ', 'CAJA', 'BOLSA', 'BOTE',
  'MANOJO', 'DOCENA', 'GALON', 'ONZA', 'LIBRA',
] as const

const UNIT_LABELS: Record<string, string> = {
  KG: 'Kilogramo',
  G: 'Gramo',
  L: 'Litro',
  ML: 'Mililitro',
  PZ: 'Pieza',
  CAJA: 'Caja',
  BOLSA: 'Bolsa',
  BOTE: 'Bote',
  MANOJO: 'Manojo',
  DOCENA: 'Docena',
  GALON: 'Galon',
  ONZA: 'Onza',
  LIBRA: 'Libra',
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ── Component ───────────────────────────────────────────────────────

export default function PresentacionesPage() {
  const [products, setProducts] = useState<ProductPresentations[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [wsCatalog, setWsCatalog] = useState<WansoftPresentation[]>([])
  const [catSearch, setCatSearch] = useState('')

  // New product form
  const [newProductName, setNewProductName] = useState('')
  const [newBaseUnit, setNewBaseUnit] = useState('KG')
  const [showAddProduct, setShowAddProduct] = useState(false)

  // New presentation form (for selected product)
  const [presUnit, setPresUnit] = useState('CAJA')
  const [presFactor, setPresFactor] = useState('1')
  const [presCost, setPresCost] = useState('0')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFactor, setEditFactor] = useState('')
  const [editCost, setEditCost] = useState('')

  // ── Load ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        const [res, catRes, presCatRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=eq.product_presentations&order=fecha.desc&limit=1&select=data`,
            { headers }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=eq.products_catalog&order=fecha.desc&limit=1&select=data`,
            { headers }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=eq.presentations_catalog&order=fecha.desc&limit=1&select=data`,
            { headers }
          ),
        ])

        let saved: ProductPresentations[] = []
        if (res.ok) {
          const rows = await res.json()
          if (rows.length > 0) {
            let raw = rows[0].data
            for (let i = 0; i < 3 && typeof raw === 'string'; i++) {
              try { raw = JSON.parse(raw) } catch { break }
            }
            if (Array.isArray(raw)) {
              saved = raw.map((p: ProductPresentations) => ({
                ...p,
                product_id: p.product_id || uid(),
                presentations: (p.presentations || []).map((pr: Presentation) => ({
                  ...pr,
                  id: pr.id || uid(),
                })),
              }))
            }
          }
        }

        // Catálogo de productos Wansoft: Text = "NOMBRE (CODIGO)"
        let catalog: ProductPresentations[] = []
        if (catRes.ok) {
          const rows = await catRes.json()
          if (rows.length > 0) {
            let raw = rows[0].data
            for (let i = 0; i < 3 && typeof raw === 'string'; i++) {
              try { raw = JSON.parse(raw) } catch { break }
            }
            const list = Array.isArray((raw as Record<string, unknown>)?.products)
              ? (raw as { products: Array<{ Text?: string; Value?: string }> }).products
              : Array.isArray(raw) ? raw as Array<{ Text?: string; Value?: string }> : []
            const savedNames = new Set(saved.map(p => p.product_name.toUpperCase()))
            catalog = list
              .filter(p => p.Text && p.Value)
              .map(p => {
                const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(p.Text!)
                return {
                  product_id: `cat_${p.Value}`,
                  product_name: m ? m[1].trim() : p.Text!.trim(),
                  base_unit: 'PZ',
                  presentations: [],
                }
              })
              .filter(p => p.product_name && !savedNames.has(p.product_name.toUpperCase()))
          }
        }

        // Catálogo plano de presentaciones Wansoft: {id, cell: [clave, presentacion, ...]}
        if (presCatRes.ok) {
          const rows = await presCatRes.json()
          if (rows.length > 0) {
            let raw = rows[0].data
            for (let i = 0; i < 3 && typeof raw === 'string'; i++) {
              try { raw = JSON.parse(raw) } catch { break }
            }
            if (Array.isArray(raw)) {
              const items = (raw as Array<{ id?: unknown; cell?: unknown[] }>)
                .filter(r => Array.isArray(r.cell) && r.cell.length >= 2)
                .map(r => ({
                  id: String(r.id ?? ''),
                  clave: String(r.cell![0] ?? ''),
                  presentacion: String(r.cell![1] ?? ''),
                }))
                .filter(r => r.clave || r.presentacion)
              setWsCatalog(items)
            }
          }
        }

        setProducts([...saved, ...catalog])
      } catch (e) {
        console.error('[presentaciones] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Save ─────────────────────────────────────────────────────────
  const save = useCallback(async (data: ProductPresentations[]) => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const clientId = getActiveClientSlug()
      // Solo persistir productos manuales o de catálogo que ya tengan presentaciones
      const toPersist = data.filter(p => !p.product_id.startsWith('cat_') || p.presentations.length > 0)
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: 'product_presentations',
        fecha: todayISO(),
        data: toPersist,
      }, { upsert: true })
      if (ok) {
        setSaveMsg({ type: 'success', text: 'Presentaciones guardadas' })
      } else {
        setSaveMsg({ type: 'error', text: 'Error al guardar' })
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Error de conexion' })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 3000)
  }, [])

  // ── Product actions ──────────────────────────────────────────────
  const addProduct = useCallback(() => {
    if (!newProductName.trim()) return
    const exists = products.some(p => p.product_name.toLowerCase() === newProductName.trim().toLowerCase())
    if (exists) {
      setSaveMsg({ type: 'error', text: 'Este producto ya existe' })
      setTimeout(() => setSaveMsg(null), 3000)
      return
    }
    const newP: ProductPresentations = {
      product_id: uid(),
      product_name: newProductName.trim(),
      base_unit: newBaseUnit,
      presentations: [],
    }
    const updated = [...products, newP]
    setProducts(updated)
    save(updated)
    setSelectedProduct(newP.product_id)
    setNewProductName('')
    setShowAddProduct(false)
  }, [products, newProductName, newBaseUnit, save])

  const deleteProduct = useCallback((productId: string) => {
    const updated = products.filter(p => p.product_id !== productId)
    setProducts(updated)
    save(updated)
    if (selectedProduct === productId) setSelectedProduct(null)
  }, [products, selectedProduct, save])

  // ── Presentation actions ─────────────────────────────────────────
  const addPresentation = useCallback(() => {
    if (!selectedProduct) return
    const factor = parseFloat(presFactor)
    const cost = parseFloat(presCost)
    if (isNaN(factor) || factor <= 0) return

    const updated = products.map(p => {
      if (p.product_id !== selectedProduct) return p
      const exists = p.presentations.some(pr => pr.unit === presUnit)
      if (exists) {
        setSaveMsg({ type: 'error', text: `La presentacion ${presUnit} ya existe para este producto` })
        setTimeout(() => setSaveMsg(null), 3000)
        return p
      }
      return {
        ...p,
        presentations: [...p.presentations, {
          id: uid(),
          unit: presUnit,
          factor,
          default_cost: isNaN(cost) ? 0 : cost,
        }],
      }
    })
    setProducts(updated)
    save(updated)
  }, [selectedProduct, presUnit, presFactor, presCost, products, save])

  const deletePresentation = useCallback((productId: string, presId: string) => {
    const updated = products.map(p => {
      if (p.product_id !== productId) return p
      return { ...p, presentations: p.presentations.filter(pr => pr.id !== presId) }
    })
    setProducts(updated)
    save(updated)
  }, [products, save])

  const startEditPres = useCallback((pr: Presentation) => {
    setEditingId(pr.id)
    setEditFactor(pr.factor.toString())
    setEditCost(pr.default_cost.toString())
  }, [])

  const confirmEditPres = useCallback((productId: string, presId: string) => {
    const factor = parseFloat(editFactor)
    const cost = parseFloat(editCost)
    if (isNaN(factor) || factor <= 0) return

    const updated = products.map(p => {
      if (p.product_id !== productId) return p
      return {
        ...p,
        presentations: p.presentations.map(pr =>
          pr.id === presId ? { ...pr, factor, default_cost: isNaN(cost) ? 0 : cost } : pr
        ),
      }
    })
    setProducts(updated)
    save(updated)
    setEditingId(null)
  }, [products, editFactor, editCost, save])

  // ── Filtered products ────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter(p =>
      p.product_name.toLowerCase().includes(q) ||
      p.base_unit.toLowerCase().includes(q) ||
      p.presentations.some(pr => pr.unit.toLowerCase().includes(q))
    )
  }, [products, search])

  const selectedProd = products.find(p => p.product_id === selectedProduct)

  // ── Render ───────────────────────────────────────────────────────

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
        title="Presentaciones"
        subtitle="Variantes de presentacion por producto"
      />

      {/* ── Toast ── */}
      {saveMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${
          saveMsg.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {saveMsg.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {saveMsg.text}
        </div>
      )}

      {/* ── Search + Add product ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] pl-9 pr-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={() => setShowAddProduct(!showAddProduct)}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          Nuevo producto
        </button>
        <div className="text-xs text-[var(--text-4)] font-mono">
          {products.length} producto{products.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Add product form ── */}
      {showAddProduct && (
        <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <Plus size={16} className="text-blue-400" />
            Nuevo producto
          </h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Nombre del producto
              </label>
              <input
                type="text"
                placeholder="Ej. Cebolla blanca"
                value={newProductName}
                onChange={e => setNewProductName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addProduct()}
                className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="w-40">
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Unidad base
              </label>
              <select
                value={newBaseUnit}
                onChange={e => setNewBaseUnit(e.target.value)}
                className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
              >
                {UNITS.map(u => (
                  <option key={u} value={u}>{u} — {UNIT_LABELS[u]}</option>
                ))}
              </select>
            </div>
            <button
              onClick={addProduct}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Plus size={14} />
              Crear
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Product list (left) ── */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
            <div className="px-5 py-4 border-b border-[var(--accent-line)]">
              <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
                <Package size={16} className="text-purple-400" />
                Productos
              </h3>
            </div>
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Package size={32} className="mx-auto text-[var(--text-4)] mb-3" />
                <p className="text-sm text-[var(--text-3)]">No hay productos</p>
                <p className="text-xs text-[var(--text-4)] mt-1">Agrega un producto para comenzar</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--accent-line)]/50 max-h-[600px] overflow-y-auto">
                {filtered.map(p => (
                  <button
                    key={p.product_id}
                    onClick={() => setSelectedProduct(p.product_id === selectedProduct ? null : p.product_id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedProduct === p.product_id
                        ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                        : 'hover:bg-[var(--surface-2)] border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-[var(--text-1)]">{p.product_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px] font-mono font-semibold">
                            {p.base_unit}
                          </span>
                          <span className="text-[10px] text-[var(--text-4)]">
                            {p.presentations.length} presentacion{p.presentations.length !== 1 ? 'es' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); deleteProduct(p.product_id) }}
                          className="p-1 rounded-lg hover:bg-red-500/10 text-[var(--text-4)] hover:text-red-400 transition-colors"
                          title="Eliminar producto"
                        >
                          <Trash2 size={12} />
                        </button>
                        <ChevronDown
                          size={14}
                          className={`text-[var(--text-4)] transition-transform ${
                            selectedProduct === p.product_id ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Presentations detail (right) ── */}
        <div className="lg:col-span-2">
          {!selectedProd ? (
            <div className="rounded-2xl border border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
              <Layers size={40} className="mx-auto text-[var(--text-4)] mb-3" />
              <p className="text-sm text-[var(--text-3)]">Selecciona un producto para ver sus presentaciones</p>
              <p className="text-xs text-[var(--text-4)] mt-1">O agrega un nuevo producto para comenzar</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Product header */}
              <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-[var(--text-1)]">{selectedProd.product_name}</h3>
                  <span className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 text-xs font-mono font-semibold">
                    Base: {selectedProd.base_unit}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-4)]">
                  {selectedProd.presentations.length} presentacion{selectedProd.presentations.length !== 1 ? 'es' : ''} configurada{selectedProd.presentations.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Add presentation form */}
              <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
                <h4 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
                  <Plus size={16} className="text-emerald-400" />
                  Agregar presentacion
                </h4>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                      Unidad
                    </label>
                    <select
                      value={presUnit}
                      onChange={e => setPresUnit(e.target.value)}
                      className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
                    >
                      {UNITS.map(u => (
                        <option key={u} value={u}>{u} — {UNIT_LABELS[u]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                      Factor vs {selectedProd.base_unit}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      value={presFactor}
                      onChange={e => setPresFactor(e.target.value)}
                      className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="w-32">
                    <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                      Costo default
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={presCost}
                      onChange={e => setPresCost(e.target.value)}
                      className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] font-mono focus:outline-none focus:border-blue-500"
                      placeholder="$0.00"
                    />
                  </div>
                  <button
                    onClick={addPresentation}
                    className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Agregar
                  </button>
                </div>
                {presFactor && parseFloat(presFactor) > 0 && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-xs text-[var(--text-3)]">
                    1 {presUnit} = {parseFloat(presFactor).toLocaleString('es-MX')} {selectedProd.base_unit}
                    {presCost && parseFloat(presCost) > 0 && (
                      <span className="text-emerald-400 ml-2">({formatCurrency(parseFloat(presCost))} por {presUnit})</span>
                    )}
                  </div>
                )}
              </div>

              {/* Presentations table */}
              <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
                <div className="px-5 py-4 border-b border-[var(--accent-line)]">
                  <h4 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
                    <Layers size={16} className="text-cyan-400" />
                    Presentaciones de {selectedProd.product_name}
                  </h4>
                </div>
                {selectedProd.presentations.length === 0 ? (
                  <div className="p-12 text-center">
                    <Layers size={32} className="mx-auto text-[var(--text-4)] mb-3" />
                    <p className="text-sm text-[var(--text-3)]">Sin presentaciones</p>
                    <p className="text-xs text-[var(--text-4)] mt-1">Agrega la primera presentacion arriba</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--accent-line)]">
                          <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Unidad</th>
                          <th className="px-4 py-3 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Factor vs {selectedProd.base_unit}</th>
                          <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Costo default</th>
                          <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Equivalencia</th>
                          <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProd.presentations.map(pr => (
                          <tr key={pr.id} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-xs font-mono font-semibold">{pr.unit}</span>
                                <span className="text-[var(--text-4)] text-xs">{UNIT_LABELS[pr.unit]}</span>
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {editingId === pr.id ? (
                                <input
                                  type="number"
                                  step="any"
                                  value={editFactor}
                                  onChange={e => setEditFactor(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && confirmEditPres(selectedProd.product_id, pr.id)}
                                  autoFocus
                                  className="w-24 h-8 rounded-lg bg-[var(--surface-2)] border border-blue-500 px-2 text-sm text-[var(--text-1)] font-mono text-center focus:outline-none"
                                />
                              ) : (
                                <span className="font-mono text-sm font-semibold text-[var(--text-1)] tnum">
                                  {pr.factor.toLocaleString('es-MX', { maximumFractionDigits: 6 })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {editingId === pr.id ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editCost}
                                  onChange={e => setEditCost(e.target.value)}
                                  className="w-28 h-8 rounded-lg bg-[var(--surface-2)] border border-blue-500 px-2 text-sm text-[var(--text-1)] font-mono text-right focus:outline-none"
                                />
                              ) : (
                                <span className="font-mono text-sm text-[var(--text-1)] tnum">
                                  {formatCurrency(pr.default_cost)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">
                              1 {pr.unit} = {pr.factor.toLocaleString('es-MX', { maximumFractionDigits: 6 })} {selectedProd.base_unit}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {editingId === pr.id ? (
                                  <>
                                    <button
                                      onClick={() => confirmEditPres(selectedProd.product_id, pr.id)}
                                      className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                                    >
                                      <Check size={14} />
                                    </button>
                                    <button
                                      onClick={() => setEditingId(null)}
                                      className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-4)] transition-colors"
                                    >
                                      <X size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => startEditPres(pr)}
                                      className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      onClick={() => deletePresentation(selectedProd.product_id, pr.id)}
                                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Catálogo Wansoft de presentaciones ── */}
      {wsCatalog.length > 0 && (
        <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
          <div className="px-5 py-4 border-b border-[var(--accent-line)] flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
              <Layers size={16} className="text-cyan-400" />
              Catalogo de presentaciones Wansoft
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold border bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
                {wsCatalog.length}
              </span>
            </h3>
            <div className="relative w-56">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <input
                type="text"
                placeholder="Filtrar catalogo..."
                value={catSearch}
                onChange={e => setCatSearch(e.target.value)}
                className="w-full h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] pl-8 pr-3 text-xs text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--bento-card)' }}>
                <tr className="border-b border-[var(--accent-line)]">
                  <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Clave</th>
                  <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Presentacion</th>
                </tr>
              </thead>
              <tbody>
                {wsCatalog
                  .filter(p => {
                    if (!catSearch.trim()) return true
                    const q = catSearch.toLowerCase()
                    return p.clave.toLowerCase().includes(q) || p.presentacion.toLowerCase().includes(q)
                  })
                  .map(p => (
                    <tr key={p.id} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-5 py-2 font-mono text-xs text-[var(--text-2)]">{p.clave}</td>
                      <td className="px-5 py-2 text-xs text-[var(--text-1)]">{p.presentacion}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Save indicator ── */}
      {saving && (
        <div className="fixed bottom-6 right-6 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 shadow-xl">
          <Loader2 size={14} className="animate-spin" />
          Guardando...
        </div>
      )}
    </div>
  )
}
