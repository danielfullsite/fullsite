// Rentabilidad — el loop factura -> costo -> margen con CAUSA.
// Cruza el historial de costos (pos_ingredient_cost_history, poblado por trigger
// cuando entra una factura) con el cost-engine para responder:
//   "¿qué platillos se encarecieron / dejaron de ser rentables, y por qué insumo?"
//
// Server-side con service key (los costos son sensibles, RLS sin anon SELECT).

import { requireAuth, getClientId } from '@/lib/api-auth'
import { NextRequest } from 'next/server'
import {
  calculateDishCost,
  type CostEngineData,
  type Ingredient,
  type SubRecipe,
  type SubRecipeIngredientLine,
  type RecipeLine,
  type UnitConversion,
} from '@/lib/cost-engine'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sb(table: string, query: string, maxRows = 3000): Promise<any[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `0-${maxRows - 1}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return res.json()
}

const norm = (s: string) => (s || '').trim().toUpperCase()

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  const clientId = getClientId(request)
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 30, 1), 180)

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    // 1. Cambios de costo recientes. Neto por insumo: costo más viejo -> más nuevo.
    const hist = await sb(
      'pos_ingredient_cost_history',
      `client_id=eq.${clientId}&changed_at=gte.${since}&order=changed_at.asc&select=ingredient_id,ingredient_name,old_cost,new_cost,changed_at`,
    )
    const changeByIng = new Map<string, { name: string; oldCost: number | null; newCost: number; pct: number | null; at: string }>()
    for (const h of hist) {
      const prev = changeByIng.get(h.ingredient_id)
      const oldCost = prev ? prev.oldCost : (h.old_cost != null ? Number(h.old_cost) : null)
      const newCost = Number(h.new_cost)
      const pct = oldCost && oldCost > 0 ? ((newCost - oldCost) / oldCost) * 100 : null
      changeByIng.set(h.ingredient_id, { name: h.ingredient_name || h.ingredient_id, oldCost, newCost, pct, at: h.changed_at })
    }

    if (changeByIng.size === 0) {
      return Response.json({ days, changes: [], dishes: [], hasHistory: hist.length > 0 })
    }

    const changedIds = new Set(changeByIng.keys())

    // 2. Data base del cost-engine (una sola carga).
    const [rawIng, rawSubs, rawSRI, rawConv] = await Promise.all([
      sb('pos_ingredients', `client_id=eq.${clientId}&active=eq.true&select=id,name,unit,cost_per_unit,yield_factor`),
      sb('pos_sub_recipes', `client_id=eq.${clientId}&active=eq.true&select=id,name,yield_quantity,yield_unit`),
      sb('pos_sub_recipe_ingredients', `select=id,sub_recipe_id,ingredient_id,ingredient_type,quantity,unit`),
      sb('pos_unit_conversions', `client_id=eq.${clientId}&select=from_unit,to_unit,factor`),
    ])

    const ingredients = new Map<string, Ingredient>()
    for (const r of rawIng as Ingredient[]) ingredients.set(r.id, r)

    const subRecipes = new Map<string, SubRecipe>()
    for (const r of rawSubs as SubRecipe[]) subRecipes.set(r.id, r)

    const subRecipeIngredients = new Map<string, SubRecipeIngredientLine[]>()
    for (const r of rawSRI as SubRecipeIngredientLine[]) {
      if (!subRecipes.has(r.sub_recipe_id)) continue
      const list = subRecipeIngredients.get(r.sub_recipe_id) || []
      list.push(r)
      subRecipeIngredients.set(r.sub_recipe_id, list)
    }

    const conversions = new Map<string, number>()
    for (const r of rawConv as UnitConversion[]) conversions.set(`${r.from_unit}→${r.to_unit}`, r.factor)

    // Sub-recetas afectadas: contienen (directo) un insumo que cambió.
    const affectedSubs = new Set<string>()
    for (const [subId, lines] of subRecipeIngredients) {
      if (lines.some(l => l.ingredient_type !== 'sub_recipe' && changedIds.has(l.ingredient_id))) affectedSubs.add(subId)
    }

    // 3. Líneas de receta que usan un insumo o sub-receta afectada -> platillos.
    const recipeLinesAll = await sb(
      'pos_recipes_old',
      `client_id=eq.${clientId}&select=id,menu_item_id,menu_item_name,ingredient_id,ingredient_type,quantity,unit`,
      5000,
    ) as RecipeLine[]

    const affectedItems = new Set<string>()
    for (const l of recipeLinesAll) {
      const isSub = l.ingredient_type === 'sub_recipe'
      if ((!isSub && changedIds.has(l.ingredient_id)) || (isSub && affectedSubs.has(l.ingredient_id))) {
        affectedItems.add(l.menu_item_id)
      }
    }

    // recipeLines map solo de platillos afectados
    const recipeLines = new Map<string, RecipeLine[]>()
    for (const l of recipeLinesAll) {
      if (!affectedItems.has(l.menu_item_id)) continue
      const list = recipeLines.get(l.menu_item_id) || []
      list.push(l)
      recipeLines.set(l.menu_item_id, list)
    }

    // 4. Precios de venta (para margen). pos_menu_items + fallback pos_recipes.
    const [menuItems, posRecipes] = await Promise.all([
      sb('pos_menu_items', `client_id=eq.${clientId}&select=name,price`),
      sb('pos_recipes', `client_id=eq.${clientId}&select=nombre,precio_venta&precio_venta=gt.0`),
    ])
    const priceByName = new Map<string, number>()
    for (const m of posRecipes) if (m.precio_venta) priceByName.set(norm(m.nombre), Number(m.precio_venta))
    for (const m of menuItems) if (m.price) priceByName.set(norm(m.name), Number(m.price))

    // 5. Dos escenarios de costo: AHORA (costos actuales) y ANTES (costos previos).
    const ingredientsBefore = new Map<string, Ingredient>()
    for (const [id, ing] of ingredients) {
      const ch = changeByIng.get(id)
      ingredientsBefore.set(id, ch && ch.oldCost != null ? { ...ing, cost_per_unit: ch.oldCost } : ing)
    }
    const base = { subRecipes, subRecipeIngredients, recipeLines, conversions }
    const dataNow: CostEngineData = { ...base, ingredients }
    const dataBefore: CostEngineData = { ...base, ingredients: ingredientsBefore }

    const dishes = [] as any[]
    for (const itemId of affectedItems) {
      const now = calculateDishCost(itemId, dataNow)
      const before = calculateDishCost(itemId, dataBefore)
      const name = now.name
      const price = priceByName.get(norm(name)) ?? null
      const costNow = now.total_cost
      const costBefore = before.total_cost
      if (costNow <= 0) continue

      // insumos culpables que este platillo usa
      const drivers = now.ingredients
        .filter(i => changedIds.has(i.ingredient_id))
        .map(i => {
          const ch = changeByIng.get(i.ingredient_id)!
          return { name: ch.name, oldCost: ch.oldCost, newCost: ch.newCost, pct: ch.pct }
        })
        .filter(d => d.pct == null || Math.abs(d.pct) >= 0.5)

      const marginNow = price ? (1 - costNow / price) * 100 : null
      const marginBefore = price && costBefore > 0 ? (1 - costBefore / price) * 100 : null

      dishes.push({
        menu_item_id: itemId,
        name,
        price,
        costBefore: Math.round(costBefore * 100) / 100,
        costNow: Math.round(costNow * 100) / 100,
        costDeltaPct: costBefore > 0 ? Math.round(((costNow - costBefore) / costBefore) * 1000) / 10 : null,
        marginNow: marginNow != null ? Math.round(marginNow * 10) / 10 : null,
        marginBefore: marginBefore != null ? Math.round(marginBefore * 10) / 10 : null,
        drivers,
      })
    }

    // Orden: mayor caída de margen primero; sin precio, mayor alza de costo.
    dishes.sort((a, b) => {
      const da = a.marginBefore != null && a.marginNow != null ? a.marginBefore - a.marginNow : (a.costDeltaPct ?? 0)
      const db = b.marginBefore != null && b.marginNow != null ? b.marginBefore - b.marginNow : (b.costDeltaPct ?? 0)
      return db - da
    })

    // Resumen de insumos que subieron (para los chips arriba).
    const changes = [...changeByIng.values()]
      .filter(c => c.pct != null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
      .map(c => ({ name: c.name, oldCost: c.oldCost, newCost: c.newCost, pct: c.pct != null ? Math.round(c.pct * 10) / 10 : null }))

    return Response.json({ days, changes, dishes: dishes.slice(0, 100), hasHistory: true })
  } catch (e) {
    return Response.json({ days, changes: [], dishes: [], hasHistory: false, error: 'calc failed' }, { status: 200 })
  }
}
