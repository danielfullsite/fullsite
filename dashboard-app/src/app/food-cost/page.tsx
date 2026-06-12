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
  market: boolean           // producto de Market (retail) — excluido de KPIs de cocina
  modifier?: boolean        // receta de modificador (wsm-*): costo vs precio extra
  precioPromedio?: boolean  // precio derivado de ventas reales (total/qty), no de lista
  sospechoso?: {            // probable capture error in Wansoft recipe
    ingrediente: string
    costo: number
    pct: number             // % of total recipe cost
  }
}

type SortKey = 'platillo' | 'margen_pct' | 'precio' | 'costo' | 'ingredientes'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/**
 * Marcas y palabras clave de productos Market (retail) en AMALAY.
 * Derivado de las categorías mkt-* de pos_menu_items. Los productos Market
 * NO son platillos de cocina y distorsionan el food cost (regla fija).
 */
const MARKET_BRANDS = [
  // proteína / suplementos
  'garden of life', 'habits', 'birdman', 'fitmingo', 'vital proteins', 'olly',
  'natural vitality', 'nat vit', 'calm gummies', 'force factor', 'natrol',
  'nature made', 'pedialyte', 'nuun', 'ultima -', 'colageno', 'creatina mono',
  // snacks / dulces
  'smarty', 'jicama', 'sa nutri', 'sanutri', 'churritos', 'guayabate', 'nubits',
  'vamara', 'duraznero', 'manglo', 'healthy crunch', 'healty crunch', 'amaranth',
  'charris', 'obleas', 'nucelli', 'brule', 'okko', 'rx bar', 'raw rev', 'yooju',
  'binny brun', 'kind breakfast', 'la casa del jugo', 'mix enchilado',
  'mango enchilado', 'mango seco', 'pasa chocolate', 'cacahuate', 'papas desh',
  'flor de jamaica enchilada', 'rollitos', 'superfoods', 'granola amalay',
  'granola keto', 'semillas',
  // bebidas retail
  'kombucha', 'velvet', 'miel infinita', 'cafe grano', 'cafe molido', 'raices',
  // la nona
  'la nona', 'lanona', 'doraditas', 'gorditas keto',
  // rojamaica
  'rojamaica',
  // belleza
  'mali ', 'hand body lotion', 'hand & body', 'hand wash', 'renew', 'melaleuca',
  'bronceador', 'tanning',
  // accesorios / libros
  'libro', 'libreta', 'totebag', 'taza', 'termo', 'vela', 'velita', 'gift card',
  'tarjeta de regalo', 'ramekin', 'planta chica', 'planta grande', 'jarra infusora',
]

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
  const [showMarket, setShowMarket] = useState(false)
  const [showMods, setShowMods] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        // -------------------------------------------------------
        // SOURCE 1 (primary): /api/food-cost — server-side con service key
        // (wansoft_recipes/menu_config/data no tienen anon SELECT: costos sensibles)
        // -------------------------------------------------------
        const apiRes = await fetch('/api/food-cost', { cache: 'no-store' })
        const api = apiRes.ok ? await apiRes.json() : null

        if (api && Array.isArray(api.recipes) && api.recipes.length > 0) {
          const recipes: Array<{
            saucer_id: string
            saucer_name: string
            budget_cost: number | null
            ingredients: unknown
          }> = api.recipes

          // Build menu price lookup — items mkt-* son Market, NO entran al lookup de cocina
          const menuItems: Array<{ name: string; price: number; category_id: string | null }> = api.menuItems || []
          const menuMap = new Map<string, number>()
          const mktNames = new Set<string>()
          for (const m of menuItems) {
            if (String(m.category_id || '').startsWith('mkt-')) {
              mktNames.add(norm(m.name))
            } else if (Number(m.price) > 0) {
              menuMap.set(norm(m.name), Number(m.price))
            }
          }

          // Excel de costeo (pos_recipes) — precios reales de venta
          const posRecipes: Array<{ nombre: string; precio_venta: number }> = api.posRecipes || []
          const excelMap = new Map<string, number>()
          for (const r of posRecipes) {
            if (Number(r.precio_venta) > 0) excelMap.set(norm(r.nombre), Number(r.precio_venta))
          }

          // Precio promedio real cobrado por platillo (wansoft_menu_config.saucers)
          const saucerMap = new Map<string, number>()
          const snapshots: Array<{ fecha: string; saucers: unknown }> = api.menuConfig || []
          for (const snap of snapshots) {
            const saucers = deepParse(snap.saucers)
            if (Array.isArray(saucers) && saucers.length > 0) {
              for (const s of saucers) {
                const qty = Number(s?.qty) || 0
                const total = Number(s?.total) || 0
                if (qty > 0 && total > 0) saucerMap.set(norm(String(s.name || '')), total / qty)
              }
              break // primer snapshot con datos
            }
          }

          // Modificadores reales (wsm-*): las ~93 recetas huérfanas de Wansoft
          // (EXT. POLLO, C/ PAN BRIOCHE...) son recetas de modificadores — se
          // costean contra el precio EXTRA del modificador, no contra el menú.
          const modMap = new Map<string, number>()
          const posModifiers: Array<{ name: string; price: number }> = api.posModifiers || []
          for (const m of posModifiers) {
            const n = norm(m.name)
            if (n && !modMap.has(n)) modMap.set(n, Number(m.price) || 0)
          }

          // Detección Market: nombre exacto/fuzzy de items mkt-*, o marca conocida.
          // Match exacto con el menú de cocina gana siempre (ej. "Healthy Crunchy Mix"
          // es un platillo de bakery, distinto al snack Market "Healthy Crunch Mix 300g").
          const isMarket = (recipeName: string): boolean => {
            const nr = norm(recipeName)
            if (menuMap.has(nr)) return false
            if (mktNames.has(nr)) return true
            if (MARKET_BRANDS.some(b => nr.includes(norm(b)))) return true
            for (const mn of mktNames) {
              if (fuzzyMatch(nr, mn)) return true
            }
            return false
          }

          // Find best price match: exacto menú → exacto Excel → promedio real → fuzzy Excel → fuzzy menú
          const findPrice = (recipeName: string): { price: number; promedio: boolean } => {
            const nr = norm(recipeName)
            if (menuMap.has(nr)) return { price: menuMap.get(nr)!, promedio: false }
            if (excelMap.has(nr)) return { price: excelMap.get(nr)!, promedio: false }
            if (saucerMap.has(nr)) return { price: saucerMap.get(nr)!, promedio: true }
            let bestPrice = 0
            excelMap.forEach((price, name) => {
              if (!bestPrice && fuzzyMatch(nr, name)) bestPrice = price
            })
            if (bestPrice) return { price: bestPrice, promedio: false }
            menuMap.forEach((price, menuName) => {
              if (!bestPrice && fuzzyMatch(nr, menuName)) bestPrice = price
            })
            return { price: bestPrice, promedio: false }
          }

          const costItems: CostItem[] = []

          for (const recipe of recipes) {
            // Parse ingredients (may be double-escaped)
            const rawIngredients = deepParse(recipe.ingredients)
            const ingredients = Array.isArray(rawIngredients) ? rawIngredients : []

            // Sum cost from ingredients: ProductBudgetedCost is already the TOTAL cost per ingredient (not per unit)
            let costoTotal = 0
            let validIngredients = 0
            let maxIngCost = 0
            let maxIngName = ''
            for (const ing of ingredients) {
              const qty = Number(ing?.Quantity) || 0
              const budgetCost = Number(ing?.ProductBudgetedCost) || 0
              if (qty > 0 && budgetCost > 0) {
                costoTotal += budgetCost  // NOT qty * budgetCost — Wansoft already calculates the total
                validIngredients++
                if (budgetCost > maxIngCost) {
                  maxIngCost = budgetCost
                  maxIngName = String(ing?.ProductName || '')
                }
              } else if (qty > 0) {
                validIngredients++ // count even if cost is 0
              }
            }

            // Receta sospechosa: un solo ingrediente concentra >=60% del costo
            // y cuesta >=$50 con >=2 ingredientes — casi siempre error de captura
            // en Wansoft (unidad/cantidad mal, ej. MOZARELA en litros a $187/porción)
            const sospechoso =
              validIngredients >= 2 && maxIngCost >= 50 && maxIngCost / costoTotal >= 0.6
                ? {
                    ingrediente: maxIngName,
                    costo: Math.round(maxIngCost * 100) / 100,
                    pct: Math.round((maxIngCost / costoTotal) * 100),
                  }
                : undefined

            // ¿Es receta de modificador? Match exacto contra wsm-* primero;
            // el match exacto con el menú de cocina gana siempre.
            const nr0 = norm(recipe.saucer_name)
            let modPrice: number | undefined =
              !menuMap.has(nr0) && modMap.has(nr0) ? modMap.get(nr0) : undefined

            const market = modPrice === undefined && isMarket(recipe.saucer_name)
            const { price: menuPrice, promedio } =
              modPrice === undefined ? findPrice(recipe.saucer_name) : { price: 0, promedio: false }

            // Fuzzy contra modificadores solo si no hubo precio de cocina ni es Market
            if (modPrice === undefined && !market && menuPrice <= 0) {
              modMap.forEach((p, name) => {
                if (modPrice === undefined && fuzzyMatch(nr0, name)) modPrice = p
              })
            }

            const isMod = modPrice !== undefined
            const precio = isMod ? modPrice! : menuPrice
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
              market,
              modifier: isMod,
              precioPromedio: validMatch && promedio,
              sospechoso,
            })
          }

          if (costItems.length > 0) {
            setItems(costItems.sort((a, b) => a.margen_pct - b.margen_pct))
            const cocina = costItems.filter(i => !i.market && !i.modifier)
            const matchedCount = cocina.filter(i => i.matched).length
            const mktCount = costItems.filter(i => i.market).length
            const modCount = costItems.filter(i => i.modifier).length
            setSource(`wansoft_recipes · ${cocina.length} recetas cocina · ${matchedCount} con precio · ${mktCount} Market excluidas · ${modCount} modificadores`)
            setLoading(false)
            return
          }
        }

        // -------------------------------------------------------
        // SOURCE 2 (fallback): costeo_por_platillo (Eduardo Excel)
        // -------------------------------------------------------
        {
          const rows = api?.costeo || []
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
                  market: false,
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
      .filter(i => showMarket || !i.market)
      .filter(i => showMods || !i.modifier)
      .filter(i => !search || i.platillo.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const va = a[sortKey]
        const vb = b[sortKey]
        if (typeof va === 'string' && typeof vb === 'string') {
          return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
        }
        return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
      })
  }, [items, search, sortKey, sortAsc, showMarket, showMods])

  /* ---- KPIs (solo cocina — Market y modificadores excluidos de métricas) ---- */
  const cocina = items.filter(i => !i.market && !i.modifier)
  const marketItems = items.filter(i => i.market)
  const modItems = items.filter(i => i.modifier)
  const withPrice = cocina.filter(i => i.matched)
  const avgMargin = withPrice.length > 0 ? withPrice.reduce((s, i) => s + i.margen_pct, 0) / withPrice.length : 0
  const stars = withPrice.filter(i => i.margen_pct > 70)
  const losers = withPrice.filter(i => i.margen_pct < 30 && i.margen_pct > 0)
  const noPrice = cocina.filter(i => !i.matched)
  const suspicious = cocina.filter(i => i.sospechoso).sort((a, b) => b.costo - a.costo)

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
          <p className="text-2xl font-bold text-[var(--text-1)]">{cocina.length}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">{withPrice.length} con precio · {marketItems.length} Market excluidas</p>
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

      {/* Recetas con costo sospechoso (error de captura en Wansoft) */}
      {suspicious.length > 0 && (
        <div className="bg-amber-500/5 rounded-xl border border-amber-500/30 shadow-sm mb-6">
          <div className="p-4 border-b border-amber-500/20 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h3 className="text-sm font-bold text-[var(--text-1)]">
              {suspicious.length} receta{suspicious.length === 1 ? '' : 's'} con costo sospechoso
            </h3>
            <span className="text-xs text-[var(--text-3)]">
              probable error de captura en la receta (unidad o cantidad) — corregir en el catalogo de recetas
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-500/20 text-[var(--text-2)]">
                  <th className="text-left px-4 py-2 font-medium">Platillo</th>
                  <th className="text-right px-4 py-2 font-medium">Costo receta</th>
                  <th className="text-left px-4 py-2 font-medium">Ingrediente culpable</th>
                  <th className="text-right px-4 py-2 font-medium">Costo ingrediente</th>
                  <th className="text-right px-4 py-2 font-medium">% del costo</th>
                </tr>
              </thead>
              <tbody>
                {suspicious.map((item, i) => (
                  <tr key={i} className="border-b border-amber-500/10">
                    <td className="px-4 py-2 font-medium text-[var(--text-1)]">{item.platillo}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(item.costo)}</td>
                    <td className="px-4 py-2 text-amber-600 font-medium">{item.sospechoso!.ingrediente}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600 font-bold">{formatCurrency(item.sospechoso!.costo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--text-2)]">{item.sospechoso!.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)] flex items-center gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          {marketItems.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showMarket}
                onChange={e => setShowMarket(e.target.checked)}
                className="accent-emerald-500"
              />
              Mostrar Market ({marketItems.length})
            </label>
          )}
          {modItems.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showMods}
                onChange={e => setShowMods(e.target.checked)}
                className="accent-emerald-500"
              />
              Modificadores ({modItems.length})
            </label>
          )}
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
                        {item.market && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-500">
                            market
                          </span>
                        )}
                        {item.modifier && (
                          <span
                            className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600"
                            title={item.precio > 0 ? 'Costeado contra el precio extra del modificador' : 'Modificador incluido en el precio del platillo (costo sin cobro extra)'}
                          >
                            modificador{!item.matched ? ' · incluido' : ''}
                          </span>
                        )}
                        {!item.matched && !item.modifier && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">
                            sin precio
                          </span>
                        )}
                        {item.precioPromedio && (
                          <span
                            className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-500"
                            title="Precio promedio cobrado (ventas reales Wansoft), no precio de lista"
                          >
                            precio prom.
                          </span>
                        )}
                        {item.sospechoso && (
                          <span
                            className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500"
                            title={`${item.sospechoso.ingrediente}: ${formatCurrency(item.sospechoso.costo)} (${item.sospechoso.pct}% del costo)`}
                          >
                            costo sospechoso
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
                        {item.matched ? `${item.modifier ? '+' : ''}${formatCurrency(item.precio)}` : '-'}
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
