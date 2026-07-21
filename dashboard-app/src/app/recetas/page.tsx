'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Search, RefreshCw, ChevronDown, ChevronRight, Package, Plus, Trash2, Save, X } from 'lucide-react'
import { getRecipes, getIngredients, formatMXN, type RecipeRow, type Ingredient } from '@/lib/pos-data'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
function hdrs() { return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' } }

interface GroupedRecipe {
  menu_item_id: string
  menu_item_name: string
  ingredients: (RecipeRow & { ingredient_name: string; ingredient_unit: string; cost: number })[]
  total_cost: number
}

export default function RecetasPage() {
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newIngId, setNewIngId] = useState('')
  const [newIngQty, setNewIngQty] = useState('')
  const [newIngUnit, setNewIngUnit] = useState('KG')
  const [newIngType, setNewIngType] = useState<'ingredient' | 'sub_recipe'>('ingredient')
  const [newIngSearch, setNewIngSearch] = useState('')
  const [newRecipeName, setNewRecipeName] = useState('')
  const [showNewRecipe, setShowNewRecipe] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subRecipes, setSubRecipes] = useState<{ id: string; name: string; yield_quantity: number; yield_unit: string }[]>([])
  const [subCosts, setSubCosts] = useState<Map<string, number>>(new Map()) // sub_recipe_id → cost per yield unit

  async function addIngredientToRecipe(menuItemId: string, menuItemName: string, ingredientId: string, quantity: number, ingredientType: string, unit: string) {
    setSaving(true)
    await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old`, {
      method: 'POST', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: _cid(), menu_item_id: menuItemId, menu_item_name: menuItemName, ingredient_id: ingredientId, ingredient_type: ingredientType, quantity, unit: unit.toLowerCase() }),
    })
    setSaving(false)
    setAddingTo(null); setNewIngId(''); setNewIngQty(''); setNewIngUnit('KG'); setNewIngType('ingredient'); setNewIngSearch('')
    fetchData()
  }

  async function removeIngredient(menuItemId: string, ingredientId: string) {
    await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_cid()}&menu_item_id=eq.${menuItemId}&ingredient_id=eq.${ingredientId}`, {
      method: 'DELETE', headers: hdrs(),
    })
    fetchData()
  }

  async function updateQuantity(menuItemId: string, ingredientId: string, quantity: number) {
    await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_cid()}&menu_item_id=eq.${menuItemId}&ingredient_id=eq.${ingredientId}`, {
      method: 'PATCH', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify({ quantity }),
    })
    fetchData()
  }

  async function createNewRecipe() {
    if (!newRecipeName.trim()) return
    setSaving(true)
    const id = newRecipeName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old`, {
      method: 'POST', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: _cid(), menu_item_id: id, menu_item_name: newRecipeName.toUpperCase(), ingredient_id: '0', quantity: 0, unit: 'kg' }),
    })
    setSaving(false)
    setShowNewRecipe(false); setNewRecipeName('')
    fetchData()
  }

  const fetchData = async () => {
    setLoading(true)
    const [r, i] = await Promise.all([getRecipes(), getIngredients()])
    setRecipes(r)
    setIngredients(i)
    // Load sub-recipes for the dropdown + their costs
    try {
      const srRes = await fetch(`/api/sub-recipes`, { headers: { 'x-client-id': _cid() } })
      if (srRes.ok) {
        const srs = await srRes.json()
        setSubRecipes(srs)
        // Load costs in parallel for all sub-recipes used in recipes
        const costMap = new Map<string, number>()
        const usedSubIds = new Set(r.filter((row: RecipeRow) => (row as RecipeRow & { ingredient_type?: string }).ingredient_type === 'sub_recipe').map((row: RecipeRow) => row.ingredient_id))
        await Promise.all(Array.from(usedSubIds).map(async (subId: string) => {
          try {
            const costRes = await fetch(`/api/food-cost/calculate?sub_recipe_id=${subId}`, { headers: { 'x-client-id': _cid() } })
            if (costRes.ok) {
              const data = await costRes.json()
              const sr = srs.find((s: { id: string }) => s.id === subId)
              if (sr && sr.yield_quantity > 0) {
                costMap.set(subId, data.total_cost / sr.yield_quantity)
              }
            }
          } catch { /* */ }
        }))
        setSubCosts(costMap)
      }
    } catch { /* */ }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const ingMap = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients])

  const subMap = useMemo(() => new Map(subRecipes.map(s => [s.id, s])), [subRecipes])

  const grouped: GroupedRecipe[] = useMemo(() => {
    const map = new Map<string, GroupedRecipe>()
    for (const row of recipes) {
      if (!map.has(row.menu_item_id)) {
        map.set(row.menu_item_id, {
          menu_item_id: row.menu_item_id,
          menu_item_name: row.menu_item_name,
          ingredients: [],
          total_cost: 0,
        })
      }
      const group = map.get(row.menu_item_id)!
      const isSubRecipe = (row as { ingredient_type?: string }).ingredient_type === 'sub_recipe'
      const ing = ingMap.get(row.ingredient_id)
      const sub = subMap.get(row.ingredient_id)
      const name = isSubRecipe && sub ? sub.name : (ing?.name ?? row.ingredient_id)
      const unit = isSubRecipe && sub ? sub.yield_unit : (ing?.unit ?? row.unit ?? '')
      const costPerUnit = ing?.cost_per_unit ?? 0
      const yieldFactor = (ing as Ingredient & { yield_factor?: number })?.yield_factor ?? 1
      const cost = isSubRecipe
        ? (subCosts.get(row.ingredient_id) ?? 0) * row.quantity
        : (costPerUnit / (yieldFactor || 1)) * row.quantity
      group.ingredients.push({
        ...row,
        ingredient_name: isSubRecipe ? `${name} (sub-receta)` : name,
        ingredient_unit: unit,
        cost,
      })
      group.total_cost += cost
    }
    return Array.from(map.values()).sort((a, b) => a.menu_item_name.localeCompare(b.menu_item_name))
  }, [recipes, ingMap, subMap, subCosts])

  const filtered = grouped.filter(g =>
    g.menu_item_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => {
    if (expanded.size === filtered.length) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(filtered.map(g => g.menu_item_id)))
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Recetas</h2>
          <p className="text-sm text-[var(--text-3)]">{grouped.length} recetas · {ingredients.length} ingredientes</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/recetas/sub-recetas" className="text-xs text-emerald-400 hover:text-emerald-300 px-3 py-2 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 font-medium">
            Sub-recetas
          </Link>
          <button onClick={fetchData} className="w-10 h-10 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar receta..."
            className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-lg pl-10 pr-4 py-2.5 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button
          onClick={expandAll}
          className="px-3 py-2.5 bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--surface-2)] rounded-lg text-sm text-[var(--text-3)] transition-colors"
        >
          {expanded.size === filtered.length ? 'Cerrar todo' : 'Expandir todo'}
        </button>
        <button
          onClick={() => setShowNewRecipe(true)}
          className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-[var(--text-1)] font-medium transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} />
          Nueva receta
        </button>
        <Link
          href="/food-cost"
          className="px-3 py-2.5 bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--surface-2)] rounded-lg text-sm text-[var(--text-3)] transition-colors flex items-center gap-1.5"
        >
          <Package size={14} />
          Food Cost
        </Link>
      </div>

      {/* Recipe list */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <div className="text-center">
              <BookOpen size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">Sin recetas</p>
              <p className="text-sm mt-1">Agrega recetas desde el botón de arriba</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {filtered.map(recipe => {
              const isOpen = expanded.has(recipe.menu_item_id)
              return (
                <div key={recipe.menu_item_id}>
                  {/* Recipe header */}
                  <button
                    onClick={() => toggleExpand(recipe.menu_item_id)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[var(--surface-2)] transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                      {isOpen ? <ChevronDown size={16} className="text-amber-500" /> : <ChevronRight size={16} className="text-amber-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[var(--text-1)]">{recipe.menu_item_name}</p>
                      <p className="text-[var(--text-3)] text-sm">{recipe.ingredients.length} ingredientes</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-amber-500">{formatMXN(recipe.total_cost)}</p>
                      <p className="text-[var(--text-2)] text-xs">costo receta</p>
                    </div>
                  </button>

                  {/* Ingredients table */}
                  {isOpen && (
                    <div className="px-6 pb-4">
                      <div className="bg-[var(--surface)] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[var(--text-3)] border-b border-[var(--line)]">
                              <th className="text-left px-4 py-2.5 font-medium">Ingrediente</th>
                              <th className="text-right px-4 py-2.5 font-medium">Cantidad</th>
                              <th className="text-left px-4 py-2.5 font-medium">Unidad</th>
                              <th className="text-right px-4 py-2.5 font-medium">Costo/u</th>
                              <th className="text-right px-4 py-2.5 font-medium">Costo</th>
                              <th className="w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {recipe.ingredients.map((ing, i) => {
                              const ingData = ingMap.get(ing.ingredient_id)
                              return (
                                <tr key={i} className="border-b border-[var(--line)]/50 last:border-0">
                                  <td className="px-4 py-2.5 text-[var(--text-1)]">{ing.ingredient_name}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-4)]">{ing.quantity}</td>
                                  <td className="px-4 py-2.5 text-[var(--text-3)]">{ing.ingredient_unit}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-3)]">{formatMXN(ingData?.cost_per_unit ?? 0)}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-1)] font-medium">{formatMXN(ing.cost)}</td>
                                  <td className="px-2 py-2.5">
                                    <button onClick={(e) => { e.stopPropagation(); removeIngredient(recipe.menu_item_id, ing.ingredient_id) }}
                                      className="w-7 h-7 rounded-md hover:bg-red-500/20 flex items-center justify-center text-[var(--text-4)] hover:text-red-400 transition-colors">
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[var(--line)]">
                              <td colSpan={4} className="px-4 py-3 text-right font-semibold text-[var(--text-4)]">Total receta</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-500">{formatMXN(recipe.total_cost)}</td>
                              <td></td>
                            </tr>
                            {addingTo === recipe.menu_item_id ? (
                              <tr>
                                <td className="px-4 py-2" colSpan={6}>
                                  <div className="space-y-2">
                                    <div className="flex gap-2 items-center">
                                      <select value={newIngType} onChange={e => { setNewIngType(e.target.value as 'ingredient' | 'sub_recipe'); setNewIngId(''); setNewIngSearch('') }}
                                        className="bg-[var(--surface-2)] border border-[var(--line)] rounded px-2 py-1.5 text-xs text-[var(--text-2)]">
                                        <option value="ingredient">Materia prima</option>
                                        <option value="sub_recipe">Sub-receta</option>
                                      </select>
                                      <input type="text" placeholder="Buscar ingrediente..." value={newIngSearch} onChange={e => setNewIngSearch(e.target.value)}
                                        className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] rounded px-2 py-1.5 text-sm text-[var(--text-1)] placeholder-[var(--text-4)]" autoFocus />
                                      <input type="number" step="0.001" min="0" placeholder="Cantidad" value={newIngQty} onChange={e => setNewIngQty(e.target.value)}
                                        className="w-20 bg-[var(--surface-2)] border border-[var(--line)] rounded px-2 py-1.5 text-sm text-[var(--text-1)] text-right" />
                                      <select value={newIngUnit} onChange={e => setNewIngUnit(e.target.value)}
                                        className="w-16 bg-[var(--surface-2)] border border-[var(--line)] rounded px-1 py-1.5 text-xs text-[var(--text-2)]">
                                        <option value="KG">KG</option><option value="GR">GR</option><option value="LT">LT</option>
                                        <option value="ML">ML</option><option value="PZ">PZ</option><option value="OZ">OZ</option>
                                      </select>
                                      <button onClick={() => { if (newIngId && newIngQty) addIngredientToRecipe(recipe.menu_item_id, recipe.menu_item_name, newIngId, parseFloat(newIngQty), newIngType, newIngUnit) }}
                                        disabled={!newIngId || !newIngQty || saving}
                                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-xs text-[var(--text-1)] font-medium">
                                        <Save size={12} className="inline mr-1" />Guardar
                                      </button>
                                      <button onClick={() => { setAddingTo(null); setNewIngId(''); setNewIngQty(''); setNewIngUnit('KG'); setNewIngType('ingredient'); setNewIngSearch('') }}
                                        className="px-2 py-1.5 rounded text-xs text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                                        <X size={14} />
                                      </button>
                                    </div>
                                    {newIngSearch.length >= 2 && (
                                      <div className="max-h-40 overflow-y-auto bg-[var(--surface-2)] border border-[var(--line)] rounded text-sm">
                                        {(() => {
                                          const q = newIngSearch.toLowerCase()
                                          const items = newIngType === 'ingredient'
                                            ? ingredients.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20).map(i => ({ id: i.id, label: i.name, detail: i.unit }))
                                            : subRecipes.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20).map(s => ({ id: s.id, label: s.name, detail: `${s.yield_quantity} ${s.yield_unit}` }))
                                          if (items.length === 0) return <div className="px-3 py-2 text-[var(--text-4)]">Sin resultados</div>
                                          return items.map(item => (
                                            <button key={item.id} onClick={() => { setNewIngId(item.id); setNewIngSearch(item.label); if (newIngType === 'ingredient') { const ing = ingredients.find(i => i.id === item.id); if (ing) setNewIngUnit(ing.unit.toUpperCase()) } }}
                                              className={`w-full text-left px-3 py-1.5 hover:bg-emerald-500/10 flex justify-between ${newIngId === item.id ? 'bg-emerald-500/10 text-emerald-400' : 'text-[var(--text-1)]'}`}>
                                              <span className="truncate">{item.label}</span>
                                              <span className="text-[10px] text-[var(--text-4)] ml-2 flex-shrink-0">{item.detail}</span>
                                            </button>
                                          ))
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-4 py-2">
                                  <button onClick={() => setAddingTo(recipe.menu_item_id)}
                                    className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                                    <Plus size={12} /> Agregar ingrediente
                                  </button>
                                </td>
                              </tr>
                            )}
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* New recipe modal */}
      {showNewRecipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 w-96 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-1)]">Nueva receta</h3>
              <button onClick={() => setShowNewRecipe(false)} className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]">
                <X size={18} />
              </button>
            </div>
            <input
              type="text" autoFocus value={newRecipeName} onChange={e => setNewRecipeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createNewRecipe() }}
              placeholder="Nombre del platillo"
              className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 text-[var(--text-1)] placeholder-slate-400 text-sm focus:outline-none focus:border-amber-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowNewRecipe(false)} className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)] transition-colors">Cancelar</button>
              <button onClick={createNewRecipe} disabled={!newRecipeName.trim() || saving}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-[var(--text-1)] text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors">
                {saving ? 'Creando...' : 'Crear receta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
