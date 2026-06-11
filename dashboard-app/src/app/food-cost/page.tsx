'use client'

import { useEffect, useState, useMemo } from 'react'
import { PieChart, Search, ArrowUpDown, TrendingUp, TrendingDown, DollarSign, ChefHat, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/format'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CostItem {
  platillo: string
  ingredientes: number
  costo: number
  precio: number
  margen_pct: number
  matched: boolean          // true if we found a menu price
}

type SortKey = 'platillo' | 'margen_pct' | 'precio' | 'costo' | 'ingredientes'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

/** Deep-parse double-escaped JSON strings */
function deepParse(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return deepParse(JSON.parse(val)) } catch { return val }
  }
  return val
}

/** Normalize a name for fuzzy matching: lowercase, strip accents, remove special chars */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strict fuzzy match: exact, or significant word overlap (≥60% of words shared) */
function fuzzyMatch(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true

  // Strip common modifiers
  const strip = (s: string) => s.replace(/\b(servido|chico|grande|regular|medium|small|large|ml|gr|kg|pz|lt|500g|240|473|1000|bote|botella|copa|frasco|galon)\b/g, '').replace(/\s+/g, ' ').trim()
  const sa = strip(na)
  const sb = strip(nb)
  if (sa === sb && sa.length > 3) return true

  // Word-overlap: at least 60% of shorter name's words must appear in longer
  const stopWords = new Set(['de', 'la', 'el', 'con', 'en', 'y', 'a', 'por', 'del', 'al', 'los', 'las', 'un', 'una'])
  const wordsA = sa.split(' ').filter(w => w.length > 1 && !stopWords.has(w))
  const wordsB = sb.split(' ').filter(w => w.length > 1 && !stopWords.has(w))
  if (wordsA.length === 0 || wordsB.length === 0) return false
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA]
  const longerStr = longer.join(' ')
  const matched = shorter.filter(w => longerStr.includes(w)).length
  const ratio = matched / shorter.length
  // Need ≥60% word overlap AND at least 2 meaningful matching words (or 1 if short name has only 1 word)
  const minMatched = shorter.length === 1 ? 1 : 2
  return ratio >= 0.6 && matched >= minMatched
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function FoodCostPage() {
  const [items, setItems] = useState<CostItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('margen_pct')
  const [sortAsc, setSortAsc] = useState(true)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        // -------------------------------------------------------
        // SOURCE 1 (primary): wansoft_recipes — 574 real recipes
        // -------------------------------------------------------
        const [recipesRes, menuRes, posRecipesRes] = await Promise.all([
          fetch(
            `${SB_URL}/rest/v1/wansoft_recipes?client_id=eq.amalay&select=saucer_id,saucer_name,budget_cost,ingredients`,
            { headers }
          ),
          fetch(
            `${SB_URL}/rest/v1/pos_menu_items?client_id=eq.amalay&select=name,price`,
            { headers }
          ),
          // Excel de costeo real (fuente de verdad de precios de venta)
          fetch(
            `${SB_URL}/rest/v1/pos_recipes?select=nombre,precio_venta&precio_venta=gt.0`,
            { headers }
          ),
        ])

        if (recipesRes.ok) {
          const recipes: Array<{
            saucer_id: string
            saucer_name: string
            budget_cost: number | null
            ingredients: unknown
          }> = await recipesRes.json()

          // Build menu price lookup
          const menuItems: Array<{ name: string; price: number }> = menuRes.ok ? await menuRes.json() : []
          const menuMap = new Map<string, number>()
          for (const m of menuItems) {
            if (Number(m.price) > 0) menuMap.set(norm(m.name), Number(m.price))
          }

          // Excel de costeo (pos_recipes) — precios reales de venta
          const posRecipes: Array<{ nombre: string; precio_venta: number }> = posRecipesRes.ok ? await posRecipesRes.json() : []
          const excelMap = new Map<string, number>()
          for (const r of posRecipes) {
            if (Number(r.precio_venta) > 0) excelMap.set(norm(r.nombre), Number(r.precio_venta))
          }

          // Find best price match: exacto menú → exacto Excel → fuzzy Excel → fuzzy menú
          const findPrice = (recipeName: string): number => {
            const nr = norm(recipeName)
            if (menuMap.has(nr)) return menuMap.get(nr)!
            if (excelMap.has(nr)) return excelMap.get(nr)!
            let bestPrice = 0
            excelMap.forEach((price, name) => {
              if (!bestPrice && fuzzyMatch(nr, name)) bestPrice = price
            })
            if (bestPrice) return bestPrice
            menuMap.forEach((price, menuName) => {
              if (!bestPrice && fuzzyMatch(nr, menuName)) bestPrice = price
            })
            return bestPrice
          }

          const costItems: CostItem[] = []

          for (const recipe of recipes) {
            // Parse ingredients (may be double-escaped)
            const rawIngredients = deepParse(recipe.ingredients)
            const ingredients = Array.isArray(rawIngredients) ? rawIngredients : []

            // Sum cost from ingredients: ProductBudgetedCost is already the TOTAL cost per ingredient (not per unit)
            let costoTotal = 0
            let validIngredients = 0
            for (const ing of ingredients) {
              const qty = Number(ing?.Quantity) || 0
              const budgetCost = Number(ing?.ProductBudgetedCost) || 0
              if (qty > 0 && budgetCost > 0) {
                costoTotal += budgetCost  // NOT qty * budgetCost — Wansoft already calculates the total
                validIngredients++
              } else if (qty > 0) {
                validIngredients++ // count even if cost is 0
              }
            }

            const precio = findPrice(recipe.saucer_name)
            const margen = precio > 0 ? Math.round((1 - costoTotal / precio) * 1000) / 10 : 0

            // Sanity check: si el margen es < -100%, el match es casi seguro incorrecto
            // (ej. producto de market matcheado con un platillo) — tratar como sin precio
            const validMatch = precio > 0 && margen > -100

            costItems.push({
              platillo: recipe.saucer_name,
              ingredientes: ingredients.length,
              costo: Math.round(costoTotal * 100) / 100,
              precio: validMatch ? precio : 0,
              margen_pct: validMatch ? margen : 0,
              matched: validMatch,
            })
          }

          if (costItems.length > 0) {
            setItems(costItems.sort((a, b) => a.margen_pct - b.margen_pct))
            const matchedCount = costItems.filter(i => i.matched).length
            setSource(`wansoft_recipes · ${costItems.length} recetas · ${matchedCount} con precio`)
            setLoading(false)
            return
          }
        }

        // -------------------------------------------------------
        // SOURCE 2 (fallback): costeo_por_platillo (Eduardo Excel)
        // -------------------------------------------------------
        const fallbackRes = await fetch(
          `${SB_URL}/rest/v1/wansoft_data?tipo=eq.costeo_por_platillo&order=fecha.desc&limit=1&select=data,fecha`,
          { headers }
        )
        if (fallbackRes.ok) {
          const rows = await fallbackRes.json()
          if (rows?.[0]?.data) {
            const rawData = deepParse(rows[0].data)
            const data = Array.isArray(rawData) ? rawData : []
            if (data.length > 0) {
              const costItems: CostItem[] = data.map((p: Record<string, unknown>) => {
                const qty = Number(p.cantidad || p.qty) || 1
                const ventaTotal = Number(p.subtotal_venta) || 0
                const costoTotal = Number(p.costo_real || p.costo_ideal) || 0
                const precioUnit = Number(p.precio) || (qty > 0 ? Math.round(ventaTotal / qty) : 0)
                const costoUnit = Number(p.costo) || (qty > 0 ? Math.round(costoTotal / qty) : 0)
                const margen = p.margen_pct ? Number(p.margen_pct) :
                  p.costo_real_pct ? Math.round((100 - Number(p.costo_real_pct)) * 10) / 10 :
                  p.costo_ideal_pct ? Math.round((100 - Number(p.costo_ideal_pct)) * 10) / 10 :
                  precioUnit > 0 ? Math.round((1 - costoUnit / precioUnit) * 1000) / 10 : 0
                return {
                  platillo: String(p.platillo || p.nombre || ''),
                  ingredientes: qty,
                  costo: costoUnit,
                  precio: precioUnit,
                  margen_pct: margen,
                  matched: true,
                }
              }).filter((p: CostItem) => p.platillo && p.precio > 0 && p.margen_pct > -100)
              setItems(costItems)
              setSource(`Costeo Eduardo · ${rows[0].fecha || ''}`)
              setLoading(false)
              return
            }
          }
        }

        setError('No se encontraron datos de food cost')
      } catch (err) {
        console.error('Food cost load error:', err)
        setError('Error cargando datos')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  /* ---- Filter & sort ---- */
  const filtered = useMemo(() => {
    return items
      .filter(i => !search || i.platillo.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const va = a[sortKey]
        const vb = b[sortKey]
        if (typeof va === 'string' && typeof vb === 'string') {
          return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
        }
        return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
      })
  }, [items, search, sortKey, sortAsc])

  /* ---- KPIs ---- */
  const withPrice = items.filter(i => i.matched)
  const avgMargin = withPrice.length > 0 ? withPrice.reduce((s, i) => s + i.margen_pct, 0) / withPrice.length : 0
  const stars = withPrice.filter(i => i.margen_pct > 70)
  const losers = withPrice.filter(i => i.margen_pct < 30 && i.margen_pct > 0)
  const noPrice = items.filter(i => !i.matched)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'platillo') }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Food Cost</h2>
        <p className="text-sm text-[var(--text-3)]">
          Costo y margen por platillo {source && `· ${source}`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <ChefHat size={16} className="text-blue-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Recetas</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{items.length}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">{withPrice.length} con precio</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-emerald-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Margen promedio</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{avgMargin.toFixed(0)}%</p>
          <p className="text-xs text-[var(--text-3)] mt-1">solo con precio</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-violet-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Estrellas (&gt;70%)</span>
          </div>
          <p className="text-2xl font-bold text-violet-600">{stars.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={16} className="text-red-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Problema (&lt;30%)</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{losers.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Sin precio</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{noPrice.length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>

        {error || filtered.length === 0 ? (
          <div className="p-8 text-center">
            <PieChart size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">
              {error || (items.length === 0 ? 'Sin datos de food cost' : 'Sin resultados')}
            </p>
            <p className="text-xs text-[var(--text-3)]">
              {items.length === 0 ? 'Verifica la conexion a wansoft_recipes.' : 'Intenta con otro termino de busqueda.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('platillo')}>
                    Platillo <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('ingredientes')}>
                    # Ing <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('costo')}>
                    Costo Receta <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('precio')}>
                    Precio Venta <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('margen_pct')}>
                    Margen <ArrowUpDown size={12} className="inline" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const rowBg = !item.matched
                    ? 'bg-amber-500/5'
                    : item.margen_pct < 30
                    ? 'bg-red-500/10'
                    : item.margen_pct > 70
                    ? 'bg-emerald-500/10'
                    : ''
                  return (
                    <tr
                      key={i}
                      className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${rowBg}`}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--text-1)]">
                        {item.platillo}
                        {!item.matched && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">
                            sin precio
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">
                        {item.ingredientes}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">
                        {formatCurrency(item.costo)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">
                        {item.matched ? formatCurrency(item.precio) : '-'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-bold ${
                          !item.matched
                            ? 'text-[var(--text-3)]'
                            : item.margen_pct < 30
                            ? 'text-red-600'
                            : item.margen_pct > 70
                            ? 'text-emerald-600'
                            : 'text-[var(--text-1)]'
                        }`}
                      >
                        {item.matched ? `${item.margen_pct.toFixed(1)}%` : '-'}
                        {item.matched && (
                          <div className="w-full bg-[var(--surface-2)] rounded-full h-1.5 mt-1">
                            <div
                              className={`h-1.5 rounded-full ${
                                item.margen_pct < 30
                                  ? 'bg-red-500'
                                  : item.margen_pct > 70
                                  ? 'bg-emerald-500'
                                  : 'bg-amber-400'
                              }`}
                              style={{ width: `${Math.max(0, Math.min(item.margen_pct, 100))}%` }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
