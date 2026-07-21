'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  FlaskConical, Plus, Trash2, Search, RefreshCw, ChevronDown, ChevronRight,
  Package, AlertTriangle, DollarSign, ArrowLeft, X, Check,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { getActiveClientSlug as _cid } from '@/lib/data'


interface SubRecipe {
  id: string
  name: string
  yield_quantity: number
  yield_unit: string
  notes: string | null
  active: boolean
}

interface SubRecipeDetail extends SubRecipe {
  ingredients: {
    id: number
    ingredient_id: string
    ingredient_type: 'ingredient' | 'sub_recipe'
    ingredient_name: string
    quantity: number
    unit: string
  }[]
}

interface CostResult {
  total_cost: number
  ingredients: {
    ingredient_id: string
    name: string
    type: string
    quantity: number
    unit: string
    line_cost: number
    yield_factor?: number
    warning?: string
    sub_breakdown?: CostResult
  }[]
  warnings: string[]
}

interface Ingredient {
  id: string
  name: string
  unit: string
}

function apiUrl(path: string) { return `${path}${path.includes('?') ? '&' : '?'}_cid=${_cid()}` }

export default function SubRecetasPage() {
  const [subRecipes, setSubRecipes] = useState<SubRecipe[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SubRecipeDetail | null>(null)
  const [cost, setCost] = useState<CostResult | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createYield, setCreateYield] = useState('1')
  const [createUnit, setCreateUnit] = useState('KG')
  const [createNotes, setCreateNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Edit header
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editYield, setEditYield] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Add ingredient form
  const [addingIngredient, setAddingIngredient] = useState(false)
  const [addIngId, setAddIngId] = useState('')
  const [addIngType, setAddIngType] = useState<'ingredient' | 'sub_recipe'>('ingredient')
  const [addIngQty, setAddIngQty] = useState('')
  const [addIngUnit, setAddIngUnit] = useState('KG')

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/sub-recipes'), { headers: { 'x-client-id': _cid() } })
      if (res.ok) setSubRecipes(await res.json())
    } catch { /* */ }
    setLoading(false)
  }, [])

  const loadIngredients = useCallback(async () => {
    try {
      const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${SB}/rest/v1/pos_ingredients?client_id=eq.${_cid()}&active=eq.true&select=id,name,unit&order=name.asc`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      })
      if (res.ok) setIngredients(await res.json())
    } catch { /* */ }
  }, [])

  useEffect(() => { loadList(); loadIngredients() }, [loadList, loadIngredients])

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    setCost(null)
    setDetail(null)
    try {
      const [detRes, costRes] = await Promise.all([
        fetch(apiUrl(`/api/sub-recipes/${id}`), { headers: { 'x-client-id': _cid() } }),
        fetch(apiUrl(`/api/food-cost/calculate?sub_recipe_id=${id}`), { headers: { 'x-client-id': _cid() } }),
      ])
      if (detRes.ok) setDetail(await detRes.json())
      if (costRes.ok) setCost(await costRes.json())
    } catch { /* */ }
    setLoadingDetail(false)
  }, [])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId, loadDetail])

  // ─── Create sub-recipe ────────────────────────────────────────────
  const handleCreate = async () => {
    setError('')
    if (!createName.trim()) { setError('Nombre obligatorio'); return }
    if (Number(createYield) <= 0) { setError('Rendimiento debe ser mayor a 0'); return }
    setSaving(true)
    const res = await fetch('/api/sub-recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': _cid() },
      body: JSON.stringify({ name: createName.trim(), yield_quantity: Number(createYield), yield_unit: createUnit.toUpperCase(), notes: createNotes || undefined }),
    })
    if (res.ok) {
      const created = await res.json()
      setShowCreate(false)
      setCreateName(''); setCreateYield('1'); setCreateUnit('KG'); setCreateNotes('')
      await loadList()
      setSelectedId(created.id)
    } else {
      const err = await res.json().catch(() => ({ message: 'Error' }))
      setError(err.message || 'Error al crear')
    }
    setSaving(false)
  }

  // ─── Add ingredient to sub-recipe ─────────────────────────────────
  const handleAddIngredient = async () => {
    if (!selectedId || !addIngId || Number(addIngQty) <= 0) return
    setError('')
    setSaving(true)
    const res = await fetch(`/api/sub-recipes/${selectedId}/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': _cid() },
      body: JSON.stringify({
        ingredient_id: addIngId,
        ingredient_type: addIngType,
        quantity: Number(addIngQty),
        unit: addIngUnit.toUpperCase(),
      }),
    })
    if (res.ok) {
      setAddingIngredient(false)
      setAddIngId(''); setAddIngQty(''); setAddIngUnit('KG')
      loadDetail(selectedId)
    } else {
      const err = await res.json().catch(() => ({ message: 'Error' }))
      setError(err.message || 'Error al agregar')
    }
    setSaving(false)
  }

  // ─── Remove ingredient ─────────────────────────────────────────────
  const handleRemoveIngredient = async (lineId: number) => {
    if (!selectedId) return
    await fetch(`/api/sub-recipes/${selectedId}/ingredients/${lineId}`, {
      method: 'DELETE',
      headers: { 'x-client-id': _cid() },
    })
    loadDetail(selectedId)
  }

  // ─── Duplicate sub-recipe ────────────────────────────────────────
  const handleDuplicate = async () => {
    if (!selectedId || !detail) return
    setError('')
    setSaving(true)
    // 1. Create copy with new name
    const newName = `${detail.name} (copia)`
    const res = await fetch('/api/sub-recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': _cid() },
      body: JSON.stringify({ name: newName, yield_quantity: detail.yield_quantity, yield_unit: detail.yield_unit, notes: detail.notes }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Error' }))
      setError(err.message || 'Error al duplicar')
      setSaving(false)
      return
    }
    const created = await res.json()
    // 2. Copy all ingredients
    for (const ing of detail.ingredients) {
      await fetch(`/api/sub-recipes/${created.id}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': _cid() },
        body: JSON.stringify({
          ingredient_id: ing.ingredient_id,
          ingredient_type: ing.ingredient_type,
          quantity: ing.quantity,
          unit: ing.unit,
        }),
      })
    }
    setSaving(false)
    await loadList()
    setSelectedId(created.id)
  }

  // ─── Edit sub-recipe header ──────────────────────────────────────
  const startEditing = () => {
    if (!detail) return
    setEditName(detail.name)
    setEditYield(String(detail.yield_quantity))
    setEditUnit(detail.yield_unit)
    setEditNotes(detail.notes || '')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!selectedId) return
    setError('')
    if (!editName.trim()) { setError('Nombre obligatorio'); return }
    if (Number(editYield) <= 0) { setError('Rendimiento debe ser mayor a 0'); return }
    setSaving(true)
    const res = await fetch(`/api/sub-recipes/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-client-id': _cid() },
      body: JSON.stringify({
        name: editName.trim(),
        yield_quantity: Number(editYield),
        yield_unit: editUnit.toUpperCase(),
        notes: editNotes || null,
      }),
    })
    if (res.ok) {
      setEditing(false)
      loadDetail(selectedId)
      loadList()
    } else {
      const err = await res.json().catch(() => ({ message: 'Error' }))
      setError(err.message || 'Error al guardar')
    }
    setSaving(false)
  }

  // ─── Delete (soft) sub-recipe with confirmation ────────────────────
  const handleDelete = async () => {
    if (!selectedId) return
    const res = await fetch(`/api/sub-recipes/${selectedId}`, {
      method: 'DELETE',
      headers: { 'x-client-id': _cid() },
    })
    if (res.ok) {
      setSelectedId(null)
      setDetail(null)
      setConfirmDelete(false)
      loadList()
    } else {
      const err = await res.json().catch(() => ({ message: 'Error' }))
      setError(err.message || 'No se puede eliminar')
      setConfirmDelete(false)
    }
  }

  const filtered = search
    ? subRecipes.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : subRecipes

  const formatCost = (n: number) => `$${n.toFixed(2)}`

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Sub-recetas"
        subtitle={`${subRecipes.length} sub-recetas configuradas`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/recetas" className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] px-3 py-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-2)]">
              Recetas de platillos
            </Link>
            <button onClick={loadList} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
              <RefreshCw size={14} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Left: List ───────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <input
                type="text" placeholder="Buscar sub-receta..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="p-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600"
            >
              <Plus size={16} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-3)]">
              <FlaskConical size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{search ? 'Sin resultados' : 'No hay sub-recetas'}</p>
              <p className="text-xs mt-1">Crea una para empezar a costear</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(sr => (
                <button
                  key={sr.id}
                  onClick={() => setSelectedId(sr.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm ${
                    selectedId === sr.id
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-[var(--text-1)]'
                      : 'hover:bg-[var(--surface-2)] border border-transparent text-[var(--text-2)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{sr.name}</span>
                    <span className="text-[10px] text-[var(--text-4)] flex-shrink-0 ml-2">
                      {sr.yield_quantity} {sr.yield_unit}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── Right: Detail ────────────────────────────────────── */}
        <div className="lg:col-span-2">
          {!selectedId ? (
            <div className="flex items-center justify-center h-64 text-[var(--text-3)]">
              <div className="text-center">
                <FlaskConical size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Selecciona una sub-receta</p>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-5">
                {editing ? (
                  <div className="space-y-3">
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-lg font-bold text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50" />
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-[var(--text-4)] uppercase block mb-1">Rendimiento</label>
                        <input type="number" step="0.1" min="0.01" value={editYield} onChange={e => setEditYield(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-1)]" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--text-4)] uppercase block mb-1">Unidad</label>
                        <select value={editUnit} onChange={e => setEditUnit(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-2)]">
                          <option value="KG">KG</option><option value="LT">LT</option><option value="PZ">PZ</option>
                          <option value="ML">ML</option><option value="GR">GR</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--text-4)] uppercase block mb-1">Notas</label>
                        <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Opcional"
                          className="w-full px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-1)]" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-[var(--text-3)] hover:bg-[var(--surface-2)] rounded-lg">Cancelar</button>
                      <button onClick={handleSaveEdit} disabled={saving} className="px-3 py-1.5 text-xs bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40">
                        {saving ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-bold text-[var(--text-1)] cursor-pointer hover:text-emerald-400" onClick={startEditing} title="Clic para editar">
                        {detail.name}
                      </h2>
                      <div className="flex items-center gap-2">
                        <button onClick={startEditing} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] px-2 py-1 rounded hover:bg-[var(--surface-2)]">
                          Editar
                        </button>
                        <button onClick={handleDuplicate} disabled={saving} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] px-2 py-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-40">
                          Duplicar
                        </button>
                        {confirmDelete ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-red-400">Confirmar?</span>
                            <button onClick={handleDelete} className="text-[10px] text-red-400 font-bold px-1.5 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20">Sí</button>
                            <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-[var(--text-3)] px-1.5 py-0.5 rounded hover:bg-[var(--surface-2)]">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10">
                            Desactivar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-[var(--text-1)]">{detail.yield_quantity} {detail.yield_unit}</p>
                        <p className="text-[10px] text-[var(--text-4)] uppercase">Rendimiento</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-emerald-400">{cost ? formatCost(cost.total_cost) : '--'}</p>
                        <p className="text-[10px] text-[var(--text-4)] uppercase">Costo total</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[var(--text-1)]">
                          {cost && detail.yield_quantity > 0 ? formatCost(cost.total_cost / detail.yield_quantity) : '--'}
                        </p>
                        <p className="text-[10px] text-[var(--text-4)] uppercase">Costo / {detail.yield_unit}</p>
                      </div>
                    </div>
                    {detail.notes && (
                      <p className="text-xs text-[var(--text-3)] mt-3 italic">{detail.notes}</p>
                    )}
                  </>
                )}
              </div>

              {/* Warnings */}
              {cost && cost.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  {cost.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle size={12} /> {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Ingredients */}
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-soft)]">
                  <h3 className="text-sm font-bold text-[var(--text-2)]">
                    Ingredientes ({detail.ingredients.length})
                  </h3>
                  <button
                    onClick={() => { setAddingIngredient(true); setError('') }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Plus size={12} /> Agregar
                  </button>
                </div>

                {/* Add ingredient form */}
                {addingIngredient && (
                  <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--bg)] space-y-3">
                    <div className="flex gap-2">
                      <select
                        value={addIngType} onChange={e => { setAddIngType(e.target.value as 'ingredient' | 'sub_recipe'); setAddIngId('') }}
                        className="px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--text-2)]"
                      >
                        <option value="ingredient">Materia prima</option>
                        <option value="sub_recipe">Sub-receta</option>
                      </select>
                      <select
                        value={addIngId} onChange={e => setAddIngId(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--text-2)]"
                      >
                        <option value="">Seleccionar...</option>
                        {addIngType === 'ingredient'
                          ? ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)
                          : subRecipes.filter(s => s.id !== selectedId).map(s => <option key={s.id} value={s.id}>{s.name} ({s.yield_quantity} {s.yield_unit})</option>)
                        }
                      </select>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number" step="0.001" min="0" placeholder="Cantidad"
                        value={addIngQty} onChange={e => setAddIngQty(e.target.value)}
                        className="w-24 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--text-1)]"
                      />
                      <input
                        type="text" placeholder="Unidad" value={addIngUnit}
                        onChange={e => setAddIngUnit(e.target.value)}
                        className="w-16 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--text-1)]"
                      />
                      <button onClick={handleAddIngredient} disabled={saving || !addIngId || !addIngQty}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium disabled:opacity-40 hover:bg-emerald-600">
                        <Check size={12} />
                      </button>
                      <button onClick={() => setAddingIngredient(false)}
                        className="px-2 py-1.5 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)] text-xs">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {detail.ingredients.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[var(--text-4)] text-sm">
                    Sin ingredientes. Agrega uno para calcular el costo.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--line-soft)]">
                    {detail.ingredients.map(ing => {
                      const costLine = cost?.ingredients.find(c => c.ingredient_id === ing.ingredient_id)
                      return (
                        <div key={ing.id} className="px-4 py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ing.ingredient_type === 'sub_recipe' ? 'bg-violet-500' : 'bg-emerald-500'}`} />
                            <div className="min-w-0">
                              <p className="text-sm text-[var(--text-1)] truncate">
                                {ing.ingredient_name}
                                {ing.ingredient_type === 'sub_recipe' && <span className="text-[10px] text-violet-400 ml-1">SUB</span>}
                              </p>
                              <p className="text-[10px] text-[var(--text-3)]">
                                {ing.quantity} {ing.unit}
                                {costLine?.yield_factor && costLine.yield_factor !== 1 && (
                                  <span className="ml-1 text-amber-400">
                                    (rend. {Math.round(costLine.yield_factor * 100)}%)
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-mono tabular-nums ${costLine?.warning ? 'text-amber-400' : 'text-[var(--text-1)]'}`}>
                              {costLine ? formatCost(costLine.line_cost) : '--'}
                            </span>
                            <button
                              onClick={() => handleRemoveIngredient(ing.id)}
                              className="p-1 rounded hover:bg-red-500/10 text-[var(--text-4)] hover:text-red-400"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ─── Create modal ───────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-4">Nueva sub-receta</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1 block">Nombre</label>
                <input
                  type="text" placeholder="Ej: SUB SALSA BOLOGNESA"
                  value={createName} onChange={e => setCreateName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1 block">Rendimiento</label>
                  <input
                    type="number" step="0.1" min="0.01" value={createYield}
                    onChange={e => setCreateYield(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-1)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1 block">Unidad</label>
                  <select
                    value={createUnit} onChange={e => setCreateUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-2)]"
                  >
                    <option value="KG">Kilogramo (KG)</option>
                    <option value="LT">Litro (LT)</option>
                    <option value="PZ">Pieza (PZ)</option>
                    <option value="ML">Mililitro (ML)</option>
                    <option value="GR">Gramo (GR)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1 block">Notas (opcional)</label>
                <input
                  type="text" placeholder="Ej: base para pastas"
                  value={createNotes} onChange={e => setCreateNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--text-1)]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                Cancelar
              </button>
              <button onClick={handleCreate} disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40">
                {saving ? 'Guardando...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
