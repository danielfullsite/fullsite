'use client'

import { useEffect, useState } from 'react'
import { PieChart, Search, ArrowUpDown, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'
import { getLatestDeep } from '@/lib/data'
import { getRecipes, getIngredients, getMenuCategoriesFromDB, type RecipeRow, type Ingredient } from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'

interface CostItem {
  platillo: string
  qty: number
  precio: number
  costo: number
  margen_pct: number
}

type SortKey = 'platillo' | 'margen_pct' | 'precio' | 'costo' | 'qty'

export default function FoodCostPage() {
  const [items, setItems] = useState<CostItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('margen_pct')
  const [sortAsc, setSortAsc] = useState(true)
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      try {
        // Try wansoft_food_cost first
        const row = await getLatestDeep('wansoft_food_cost')
        if (row?.data && Array.isArray(row.data) && row.data.length > 0) {
          setItems(row.data)
          setFecha(row.fecha as string || '')
        } else {
          // Fallback: calculate from pos_recipes + pos_ingredients
          const [recipes, ingredients, menuCats] = await Promise.all([getRecipes(), getIngredients(), getMenuCategoriesFromDB()])
          const ingMap = new Map(ingredients.map((i: Ingredient) => [i.id, i]))

          // Group recipes by platillo
          const platilloMap = new Map<string, { name: string; cost: number; ingredients: number }>()
          for (const r of recipes) {
            const existing = platilloMap.get(r.menu_item_id) || { name: r.menu_item_name, cost: 0, ingredients: 0 }
            const ing = ingMap.get(r.ingredient_id)
            if (ing) {
              existing.cost += (ing.cost_per_unit || 0) * r.quantity
              existing.ingredients++
            }
            platilloMap.set(r.menu_item_id, existing)
          }

          // Match with menu prices from DB
          const menuPrices = new Map<string, number>()
          for (const cat of menuCats) {
            for (const item of cat.items) {
              menuPrices.set(item.name.toLowerCase(), item.price)
            }
          }

          const costItems: CostItem[] = []
          for (const [, p] of platilloMap) {
            const price = menuPrices.get(p.name.toLowerCase()) || 0
            const margen = price > 0 ? Math.round((1 - p.cost / price) * 100) : 0
            if (p.cost > 0 || price > 0) {
              costItems.push({
                platillo: p.name,
                qty: p.ingredients,
                precio: price,
                costo: Math.round(p.cost * 100) / 100,
                margen_pct: margen,
              })
            }
          }
          setItems(costItems.sort((a, b) => a.margen_pct - b.margen_pct))
          setFecha('pos_recipes')
        }
      } catch (err) {
        console.error('Error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = items
    .filter(i => !search || i.platillo.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (typeof va === 'string') return sortAsc ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string)
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  const avgMargin = items.length > 0 ? items.reduce((s, i) => s + (i.margen_pct || 0), 0) / items.length : 0
  const losers = items.filter(i => i.margen_pct < 30)
  const stars = items.filter(i => i.margen_pct > 70)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'platillo') }
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Food Cost</h2>
        <p className="text-sm text-slate-400">Costo y margen por platillo {fecha && `· ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><PieChart size={16} className="text-blue-500" /><span className="text-xs text-slate-500 font-medium">Platillos</span></div>
          <p className="text-2xl font-bold text-slate-900">{items.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-emerald-500" /><span className="text-xs text-slate-500 font-medium">Margen promedio</span></div>
          <p className="text-2xl font-bold text-emerald-600">{avgMargin.toFixed(0)}%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingUp size={16} className="text-violet-500" /><span className="text-xs text-slate-500 font-medium">Estrellas (&gt;70%)</span></div>
          <p className="text-2xl font-bold text-violet-600">{stars.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingDown size={16} className="text-red-500" /><span className="text-xs text-slate-500 font-medium">Problema (&lt;30%)</span></div>
          <p className="text-2xl font-bold text-red-600">{losers.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar platillo..." className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">{items.length === 0 ? 'Sin datos de food cost. El scraper corre diario.' : 'Sin resultados'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-slate-500">
                <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('platillo')}>Platillo <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('qty')}>Qty <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('precio')}>Precio <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('costo')}>Costo <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('margen_pct')}>Margen <ArrowUpDown size={12} className="inline" /></th>
              </tr></thead>
              <tbody>{filtered.map((item, i) => (
                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${item.margen_pct < 30 ? 'bg-red-50/50' : item.margen_pct > 70 ? 'bg-emerald-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.platillo}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{item.qty}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(item.precio)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(item.costo)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-bold ${item.margen_pct < 30 ? 'text-red-600' : item.margen_pct > 70 ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {item.margen_pct.toFixed(0)}%
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                      <div className={`h-1.5 rounded-full ${item.margen_pct < 30 ? 'bg-red-500' : item.margen_pct > 70 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(item.margen_pct, 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
