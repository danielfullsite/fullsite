/**
 * Cost Engine — Pure cost calculation for recipes and sub-recipes.
 *
 * Design principles:
 * - All costs derived, never persisted or cached
 * - All data preloaded in bulk (no N+1 queries)
 * - All queries filtered by client_id
 * - Cycle protection even though write API already prevents cycles
 * - Clear errors when data is missing (cost, unit, conversion)
 * - Deterministic: same input → same output, always
 *
 * Not connected to: POS, inventory deduction, r1_reconcile_order
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit: number
  yield_factor: number
}

export interface SubRecipe {
  id: string
  name: string
  yield_quantity: number
  yield_unit: string
}

export interface SubRecipeIngredientLine {
  id: number
  sub_recipe_id: string
  ingredient_id: string
  ingredient_type: 'ingredient' | 'sub_recipe'
  quantity: number
  unit: string
}

export interface RecipeLine {
  id: number
  menu_item_id: string
  menu_item_name: string
  ingredient_id: string
  ingredient_type: 'ingredient' | 'sub_recipe'
  quantity: number
  unit: string
}

export interface UnitConversion {
  from_unit: string
  to_unit: string
  factor: number
}

export interface CostLineResult {
  ingredient_id: string
  name: string
  type: 'ingredient' | 'sub_recipe'
  quantity: number
  unit: string
  unit_cost: number
  line_cost: number
  yield_factor?: number
  conversion_applied?: { from: string; to: string; factor: number }
  sub_breakdown?: CostResult
  warning?: string
}

export interface CostResult {
  id: string
  name: string
  total_cost: number
  ingredients: CostLineResult[]
  warnings: string[]
}

// ─── Preloaded data store ────────────────────────────────────────────────────

export interface CostEngineData {
  ingredients: Map<string, Ingredient>
  subRecipes: Map<string, SubRecipe>
  subRecipeIngredients: Map<string, SubRecipeIngredientLine[]> // keyed by sub_recipe_id
  recipeLines: Map<string, RecipeLine[]> // keyed by menu_item_id
  conversions: Map<string, number> // keyed by "FROM→TO"
}

// ─── Data loading ────────────────────────────────────────────────────────────

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sbFetch(table: string, query: string): Promise<unknown[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return res.json()
}

export async function loadCostEngineData(clientId: string): Promise<CostEngineData> {
  const [rawIngredients, rawSubRecipes, rawSRI, rawRecipes, rawConversions] = await Promise.all([
    sbFetch('pos_ingredients', `client_id=eq.${clientId}&active=eq.true&select=id,name,unit,cost_per_unit,yield_factor&limit=10000`),
    sbFetch('pos_sub_recipes', `client_id=eq.${clientId}&active=eq.true&select=id,name,yield_quantity,yield_unit&limit=5000`),
    sbFetch('pos_sub_recipe_ingredients', `select=id,sub_recipe_id,ingredient_id,ingredient_type,quantity,unit&limit=50000`),
    sbFetch('pos_recipes_old', `client_id=eq.${clientId}&select=id,menu_item_id,menu_item_name,ingredient_id,ingredient_type,quantity,unit&limit=50000`),
    sbFetch('pos_unit_conversions', `client_id=eq.${clientId}&select=from_unit,to_unit,factor&limit=1000`),
  ])

  const ingredients = new Map<string, Ingredient>()
  for (const r of rawIngredients as Ingredient[]) {
    ingredients.set(r.id, r)
  }

  const subRecipes = new Map<string, SubRecipe>()
  for (const r of rawSubRecipes as SubRecipe[]) {
    subRecipes.set(r.id, r)
  }

  // Filter sub_recipe_ingredients to only those belonging to this client's sub-recipes
  const subRecipeIngredients = new Map<string, SubRecipeIngredientLine[]>()
  for (const r of rawSRI as SubRecipeIngredientLine[]) {
    if (!subRecipes.has(r.sub_recipe_id)) continue // belongs to another client
    const list = subRecipeIngredients.get(r.sub_recipe_id) || []
    list.push(r)
    subRecipeIngredients.set(r.sub_recipe_id, list)
  }

  const recipeLines = new Map<string, RecipeLine[]>()
  for (const r of rawRecipes as RecipeLine[]) {
    const list = recipeLines.get(r.menu_item_id) || []
    list.push(r)
    recipeLines.set(r.menu_item_id, list)
  }

  const conversions = new Map<string, number>()
  for (const r of rawConversions as UnitConversion[]) {
    conversions.set(`${r.from_unit}→${r.to_unit}`, r.factor)
  }

  return { ingredients, subRecipes, subRecipeIngredients, recipeLines, conversions }
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

export function convertUnit(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  conversions: Map<string, number>,
): { quantity: number; factor: number } | { error: string } {
  const from = fromUnit.toUpperCase()
  const to = toUnit.toUpperCase()

  if (from === to) return { quantity, factor: 1 }

  // Direct conversion
  const direct = conversions.get(`${from}→${to}`)
  if (direct !== undefined) {
    return { quantity: quantity * direct, factor: direct }
  }

  // Inverse conversion
  const inverse = conversions.get(`${to}→${from}`)
  if (inverse !== undefined && inverse !== 0) {
    const factor = 1 / inverse
    return { quantity: quantity * factor, factor }
  }

  return { error: `No existe conversión entre ${from} y ${to}` }
}

// ─── Sub-recipe cost calculation ─────────────────────────────────────────────

export function calculateSubRecipeCost(
  subRecipeId: string,
  data: CostEngineData,
  visited: Set<string> = new Set(),
  depth: number = 0,
): CostResult {
  const sub = data.subRecipes.get(subRecipeId)
  if (!sub) {
    return {
      id: subRecipeId,
      name: '(sub-receta no encontrada)',
      total_cost: 0,
      ingredients: [],
      warnings: [`Sub-receta ${subRecipeId} no encontrada`],
    }
  }

  // Cycle protection (defense in depth — write API already prevents cycles)
  if (visited.has(subRecipeId)) {
    return {
      id: subRecipeId,
      name: sub.name,
      total_cost: 0,
      ingredients: [],
      warnings: [`Ciclo detectado en ${sub.name} — costo no calculable`],
    }
  }
  if (depth > 10) {
    return {
      id: subRecipeId,
      name: sub.name,
      total_cost: 0,
      ingredients: [],
      warnings: [`Profundidad máxima excedida en ${sub.name}`],
    }
  }

  visited.add(subRecipeId)
  const lines = data.subRecipeIngredients.get(subRecipeId) || []
  const warnings: string[] = []
  const ingredients: CostLineResult[] = []

  for (const line of lines) {
    const result = calculateLineCost(line.ingredient_id, line.ingredient_type, line.quantity, line.unit, data, visited, depth)
    ingredients.push(result)
    if (result.warning) warnings.push(result.warning)
    if (result.sub_breakdown?.warnings) warnings.push(...result.sub_breakdown.warnings)
  }

  visited.delete(subRecipeId)

  return {
    id: subRecipeId,
    name: sub.name,
    total_cost: ingredients.reduce((sum, i) => sum + i.line_cost, 0),
    ingredients,
    warnings,
  }
}

// ─── Single line cost ────────────────────────────────────────────────────────

function calculateLineCost(
  ingredientId: string,
  ingredientType: 'ingredient' | 'sub_recipe',
  quantity: number,
  unit: string,
  data: CostEngineData,
  visited: Set<string>,
  depth: number,
): CostLineResult {
  if (ingredientType === 'ingredient') {
    return calculateIngredientLineCost(ingredientId, quantity, unit, data)
  } else {
    return calculateSubRecipeLineCost(ingredientId, quantity, unit, data, visited, depth)
  }
}

function calculateIngredientLineCost(
  ingredientId: string,
  quantity: number,
  unit: string,
  data: CostEngineData,
): CostLineResult {
  const ing = data.ingredients.get(ingredientId)
  if (!ing) {
    return {
      ingredient_id: ingredientId,
      name: '(ingrediente no encontrado)',
      type: 'ingredient',
      quantity,
      unit,
      unit_cost: 0,
      line_cost: 0,
      warning: `Ingrediente ${ingredientId} no encontrado`,
    }
  }

  const costPerUnit = Number(ing.cost_per_unit) || 0
  const yieldFactor = Number(ing.yield_factor) || 1

  if (costPerUnit <= 0) {
    return {
      ingredient_id: ingredientId,
      name: ing.name,
      type: 'ingredient',
      quantity,
      unit,
      unit_cost: 0,
      line_cost: 0,
      yield_factor: yieldFactor,
      warning: `${ing.name}: sin costo configurado`,
    }
  }

  // Adjusted cost = cost / yield_factor
  // yield < 1 (waste): cost goes UP (buy more than you use)
  // yield > 1 (expansion): cost goes DOWN (get more than you buy)
  const adjustedCost = costPerUnit / yieldFactor

  // Unit conversion if needed
  let effectiveQuantity = quantity
  let conversionApplied: { from: string; to: string; factor: number } | undefined
  const recipeUnit = unit.toUpperCase()
  const ingUnit = (ing.unit || '').toUpperCase()

  if (recipeUnit !== ingUnit && ingUnit) {
    const conv = convertUnit(quantity, recipeUnit, ingUnit, data.conversions)
    if ('error' in conv) {
      return {
        ingredient_id: ingredientId,
        name: ing.name,
        type: 'ingredient',
        quantity,
        unit,
        unit_cost: adjustedCost,
        line_cost: 0,
        yield_factor: yieldFactor,
        warning: `${ing.name}: ${conv.error}`,
      }
    }
    effectiveQuantity = conv.quantity
    conversionApplied = { from: recipeUnit, to: ingUnit, factor: conv.factor }
  }

  return {
    ingredient_id: ingredientId,
    name: ing.name,
    type: 'ingredient',
    quantity,
    unit,
    unit_cost: adjustedCost,
    line_cost: effectiveQuantity * adjustedCost,
    yield_factor: yieldFactor,
    conversion_applied: conversionApplied,
  }
}

function calculateSubRecipeLineCost(
  subRecipeId: string,
  quantity: number,
  unit: string,
  data: CostEngineData,
  visited: Set<string>,
  depth: number,
): CostLineResult {
  const sub = data.subRecipes.get(subRecipeId)
  if (!sub) {
    return {
      ingredient_id: subRecipeId,
      name: '(sub-receta no encontrada)',
      type: 'sub_recipe',
      quantity,
      unit,
      unit_cost: 0,
      line_cost: 0,
      warning: `Sub-receta ${subRecipeId} no encontrada`,
    }
  }

  // Calculate full sub-recipe cost recursively
  const subCost = calculateSubRecipeCost(subRecipeId, data, new Set(visited), depth + 1)

  if (sub.yield_quantity <= 0) {
    return {
      ingredient_id: subRecipeId,
      name: sub.name,
      type: 'sub_recipe',
      quantity,
      unit,
      unit_cost: 0,
      line_cost: 0,
      sub_breakdown: subCost,
      warning: `${sub.name}: yield_quantity es 0`,
    }
  }

  // Cost per yield unit of the sub-recipe
  const costPerYieldUnit = subCost.total_cost / sub.yield_quantity

  // Unit conversion: recipe unit → sub-recipe yield unit
  let effectiveQuantity = quantity
  let conversionApplied: { from: string; to: string; factor: number } | undefined
  const recipeUnit = unit.toUpperCase()
  const yieldUnit = sub.yield_unit.toUpperCase()

  if (recipeUnit !== yieldUnit) {
    const conv = convertUnit(quantity, recipeUnit, yieldUnit, data.conversions)
    if ('error' in conv) {
      return {
        ingredient_id: subRecipeId,
        name: sub.name,
        type: 'sub_recipe',
        quantity,
        unit,
        unit_cost: costPerYieldUnit,
        line_cost: 0,
        sub_breakdown: subCost,
        warning: `${sub.name}: ${conv.error}`,
      }
    }
    effectiveQuantity = conv.quantity
    conversionApplied = { from: recipeUnit, to: yieldUnit, factor: conv.factor }
  }

  return {
    ingredient_id: subRecipeId,
    name: sub.name,
    type: 'sub_recipe',
    quantity,
    unit,
    unit_cost: costPerYieldUnit,
    line_cost: effectiveQuantity * costPerYieldUnit,
    conversion_applied: conversionApplied,
    sub_breakdown: subCost,
  }
}

// ─── Dish cost calculation ───────────────────────────────────────────────────

export function calculateDishCost(
  menuItemId: string,
  data: CostEngineData,
): CostResult {
  const lines = data.recipeLines.get(menuItemId)
  if (!lines || lines.length === 0) {
    return {
      id: menuItemId,
      name: menuItemId,
      total_cost: 0,
      ingredients: [],
      warnings: [`Platillo ${menuItemId} no tiene receta`],
    }
  }

  const name = lines[0].menu_item_name || menuItemId
  const warnings: string[] = []
  const ingredients: CostLineResult[] = []

  for (const line of lines) {
    const type = (line.ingredient_type || 'ingredient') as 'ingredient' | 'sub_recipe'
    const result = calculateLineCost(line.ingredient_id, type, line.quantity, line.unit, data, new Set(), 0)
    ingredients.push(result)
    if (result.warning) warnings.push(result.warning)
    if (result.sub_breakdown?.warnings) warnings.push(...result.sub_breakdown.warnings)
  }

  return {
    id: menuItemId,
    name,
    total_cost: ingredients.reduce((sum, i) => sum + i.line_cost, 0),
    ingredients,
    warnings,
  }
}
