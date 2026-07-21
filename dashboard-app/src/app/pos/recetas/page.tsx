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
  const [newRecipeName, setNewRecipeName] = useState('')
  const [showNewRecipe, setShowNewRecipe] = useState(false)
  const [saving, setSaving] = useState(false)

  async function addIngredientToRecipe(menuItemId: string, menuItemName: string, ingredientId: string, quantity: number) {
    setSaving(true)
    await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old`, {
      method: 'POST', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: _cid(), menu_item_id: menuItemId, menu_item_name: menuItemName, ingredient_id: ingredientId, quantity, unit: 'kg' }),
    })
    setSaving(false)
    setAddingTo(null); setNewIngId(''); setNewIngQty('')
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
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const ingMap = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients])

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
      const ing = ingMap.get(row.ingredient_id)
      const cost = (ing?.cost_per_unit ?? 0) * row.quantity
      group.ingredients.push({
        ...row,
        ingredient_name: ing?.name ?? row.ingredient_id,
        ingredient_unit: ing?.unit ?? row.unit ?? '',
        cost,
      })
      group.total_cost += cost
    }
    return Array.from(map.values()).sort((a, b) => a.menu_item_name.localeCompare(b.menu_item_name))
  }, [recipes, ingMap])

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
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen size={24} className="text-amber-400" />
            <h1 className="text-xl font-bold">Recetas</h1>
          </div>
          <button onClick={fetchData} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--text-3)]">
          <span>{grouped.length} recetas</span>
          <span>·</span>
          <span>{ingredients.length} ingredientes</span>
        </div>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 bg-[var(--surface-2)]/50 border-b border-slate-700">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar receta..."
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
        <button
          onClick={expandAll}
          className="px-3 py-2.5 bg-[var(--line)] hover:bg-slate-600 rounded-lg text-sm text-[var(--text-4)] transition-colors"
        >
          {expanded.size === filtered.length ? 'Cerrar todo' : 'Expandir todo'}
        </button>
        <button
          onClick={() => setShowNewRecipe(true)}
          className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-medium transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} />
          Nueva receta
        </button>
        <Link
          href="/pos/inventario"
          className="px-3 py-2.5 bg-[var(--line)] hover:bg-slate-600 rounded-lg text-sm text-[var(--text-4)] transition-colors flex items-center gap-1.5"
        >
          <Package size={14} />
          Inventario
        </Link>
      </div>

      {/* Recipe list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-2)]">
            <div className="text-center">
              <BookOpen size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-xl">Sin recetas</p>
              <p className="text-sm mt-1">Corre el SQL seed en Supabase</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map(recipe => {
              const isOpen = expanded.has(recipe.menu_item_id)
              return (
                <div key={recipe.menu_item_id}>
                  {/* Recipe header */}
                  <button
                    onClick={() => toggleExpand(recipe.menu_item_id)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[var(--surface-2)]/50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                      {isOpen ? <ChevronDown size={16} className="text-amber-400" /> : <ChevronRight size={16} className="text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">{recipe.menu_item_name}</p>
                      <p className="text-[var(--text-3)] text-sm">{recipe.ingredients.length} ingredientes</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-amber-400">{formatMXN(recipe.total_cost)}</p>
                      <p className="text-[var(--text-2)] text-xs">costo receta</p>
                    </div>
                  </button>

                  {/* Ingredients table */}
                  {isOpen && (
                    <div className="px-6 pb-4">
                      <div className="bg-[var(--surface-2)]/60 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[var(--text-3)] border-b border-slate-700">
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
                                <tr key={i} className="border-b border-slate-700/50 last:border-0">
                                  <td className="px-4 py-2.5 text-white">{ing.ingredient_name}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-4)]">{ing.quantity}</td>
                                  <td className="px-4 py-2.5 text-[var(--text-3)]">{ing.ingredient_unit}</td>
                                  <td className="px-4 py-2.5 text-right text-[var(--text-3)]">{formatMXN(ingData?.cost_per_unit ?? 0)}</td>
                                  <td className="px-4 py-2.5 text-right text-white font-medium">{formatMXN(ing.cost)}</td>
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
                            <tr className="border-t border-slate-600">
                              <td colSpan={4} className="px-4 py-3 text-right font-semibold text-[var(--text-4)]">Total receta</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-400">{formatMXN(recipe.total_cost)}</td>
                              <td></td>
                            </tr>
                            {addingTo === recipe.menu_item_id ? (
                              <tr>
                                <td className="px-4 py-2" colSpan={2}>
                                  <select value={newIngId} onChange={e => setNewIngId(e.target.value)}
                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white">
                                    <option value="">Seleccionar ingrediente...</option>
                                    {ingredients.sort((a, b) => a.name.localeCompare(b.name)).map(i => (
                                      <option key={i.id} value={i.id}>{i.name}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-4 py-2">
                                  <input type="number" step="0.01" placeholder="Cant" value={newIngQty} onChange={e => setNewIngQty(e.target.value)}
                                    className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white text-right" />
                                </td>
                                <td className="px-4 py-2 text-right" colSpan={2}>
                                  <button onClick={() => { if (newIngId && newIngQty) addIngredientToRecipe(recipe.menu_item_id, recipe.menu_item_name, newIngId, parseFloat(newIngQty)) }}
                                    disabled={!newIngId || !newIngQty || saving}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-xs text-white font-medium mr-2">
                                    <Save size={12} className="inline mr-1" />Guardar
                                  </button>
                                  <button onClick={() => { setAddingTo(null); setNewIngId(''); setNewIngQty('') }}
                                    className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-xs text-white">
                                    Cancelar
                                  </button>
                                </td>
                                <td></td>
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
          <div className="bg-[var(--surface)] border border-slate-600 rounded-2xl p-6 w-96 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Nueva receta</h3>
              <button onClick={() => setShowNewRecipe(false)} className="w-8 h-8 rounded-lg hover:bg-slate-700 flex items-center justify-center text-[var(--text-3)]">
                <X size={18} />
              </button>
            </div>
            <input
              type="text" autoFocus value={newRecipeName} onChange={e => setNewRecipeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createNewRecipe() }}
              placeholder="Nombre del platillo"
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-amber-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowNewRecipe(false)} className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-slate-700 transition-colors">Cancelar</button>
              <button onClick={createNewRecipe} disabled={!newRecipeName.trim() || saving}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors">
                {saving ? 'Creando...' : 'Crear receta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
