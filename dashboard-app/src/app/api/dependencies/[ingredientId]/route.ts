import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError { code: string; message: string; details?: unknown }
function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

const readHdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

type RouteCtx = { params: Promise<{ ingredientId: string }> }

async function sbGet(table: string, query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: readHdrs, cache: 'no-store' })
  return res.ok ? res.json() : []
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubRecipeDep {
  id: string
  name: string
  path: string[]   // ingredient → sub-recipe chain (names)
  direct: boolean   // true if ingredient is a direct member
}

interface DishDep {
  item_id: string
  name: string
  direct: boolean           // true if ingredient is used directly in the dish
  via_sub_recipes: string[] // sub-recipe names through which ingredient reaches this dish
}

interface DependencyMap {
  ingredient_id: string
  ingredient_name: string
  sub_recipes: SubRecipeDep[]
  dishes: DishDep[]
}

// ─── GET /api/dependencies/[ingredientId] ────────────────────────────────────
// Given an ingredient, find all sub-recipes and dishes that use it (directly
// or transitively through nested sub-recipes). Read-only, no side effects.

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { ingredientId } = await ctx.params
  const clientId = getClientId(request)

  // 1. Verify ingredient exists
  const ingRows = await sbGet('pos_ingredients',
    `id=eq.${encodeURIComponent(ingredientId)}&client_id=eq.${clientId}&select=id,name`)
  if (ingRows.length === 0) {
    return err(404, 'NOT_FOUND', 'Ingrediente no encontrado')
  }
  const ingredientName = String(ingRows[0].name)

  // 2. Preload sub-recipe data for this client (small tables)
  // Recipe lines loaded AFTER we know which IDs to search for (avoids 1000-row limit)
  const [allSRI, allSubRecipes] = await Promise.all([
    sbGet('pos_sub_recipe_ingredients', `select=sub_recipe_id,ingredient_id,ingredient_type`),
    sbGet('pos_sub_recipes', `client_id=eq.${clientId}&select=id,name`),
  ])

  // Build lookup maps
  const subRecipeNames = new Map<string, string>()
  const clientSubRecipeIds = new Set<string>()
  for (const sr of allSubRecipes) {
    subRecipeNames.set(String(sr.id), String(sr.name))
    clientSubRecipeIds.add(String(sr.id))
  }

  // Filter SRI to only this client's sub-recipes
  const sriByIngredient = new Map<string, string[]>()  // ingredient_id → [sub_recipe_id, ...]
  for (const line of allSRI) {
    if (!clientSubRecipeIds.has(String(line.sub_recipe_id))) continue
    const ingId = String(line.ingredient_id)
    const srId = String(line.sub_recipe_id)
    const list = sriByIngredient.get(ingId) || []
    list.push(srId)
    sriByIngredient.set(ingId, list)
  }

  // 3. Find all sub-recipes that use this ingredient (BFS up the tree)
  const subRecipeDeps: SubRecipeDep[] = []
  const visited = new Set<string>()

  // Queue entries: [sub_recipe_id, path_of_names, is_direct]
  const queue: [string, string[], boolean][] = []

  // Seed: sub-recipes that directly contain this ingredient
  const directParents = sriByIngredient.get(ingredientId) || []
  for (const srId of directParents) {
    const name = subRecipeNames.get(srId) || srId
    queue.push([srId, [ingredientName, name], true])
  }

  let depth = 0
  while (queue.length > 0 && depth < 50) {
    const [srId, path, isDirect] = queue.shift()!
    if (visited.has(srId)) continue
    visited.add(srId)
    depth++

    const name = subRecipeNames.get(srId) || srId
    subRecipeDeps.push({ id: srId, name, path, direct: isDirect })

    // Find sub-recipes that contain THIS sub-recipe as an ingredient
    const grandparents = sriByIngredient.get(srId) || []
    for (const gpId of grandparents) {
      if (!visited.has(gpId)) {
        const gpName = subRecipeNames.get(gpId) || gpId
        queue.push([gpId, [...path, gpName], false])
      }
    }
  }

  // 4. Load recipe lines that reference this ingredient OR any affected sub-recipe
  // This avoids the Supabase 1000-row limit by filtering to only relevant IDs
  const searchIds = [ingredientId, ...Array.from(visited)] // ingredient + all affected sub-recipes
  const allRecipeLines: Record<string, unknown>[] = []
  // Supabase `in` filter: batch in groups to avoid URL length issues
  for (let i = 0; i < searchIds.length; i += 50) {
    const batch = searchIds.slice(i, i + 50)
    const inFilter = `(${batch.map(id => `"${id}"`).join(',')})`
    const rows = await sbGet('pos_recipes_old',
      `client_id=eq.${clientId}&ingredient_id=in.${inFilter}&select=menu_item_id,menu_item_name,ingredient_id,ingredient_type`)
    allRecipeLines.push(...rows)
  }

  // 5. Find all dishes that use this ingredient (directly or via sub-recipes)
  const dishMap = new Map<string, DishDep>()

  for (const line of allRecipeLines) {
    const lineIngId = String(line.ingredient_id)
    const lineType = String(line.ingredient_type || 'ingredient')
    const itemId = String(line.menu_item_id)
    const itemName = String(line.menu_item_name || itemId)

    // Direct: dish uses this ingredient directly
    if (lineIngId === ingredientId && lineType === 'ingredient') {
      const existing = dishMap.get(itemId)
      if (existing) {
        existing.direct = true
      } else {
        dishMap.set(itemId, { item_id: itemId, name: itemName, direct: true, via_sub_recipes: [] })
      }
    }

    // Indirect: dish uses a sub-recipe that contains this ingredient
    if (lineType === 'sub_recipe' && visited.has(lineIngId)) {
      const srName = subRecipeNames.get(lineIngId) || lineIngId
      const existing = dishMap.get(itemId)
      if (existing) {
        if (!existing.via_sub_recipes.includes(srName)) {
          existing.via_sub_recipes.push(srName)
        }
      } else {
        dishMap.set(itemId, { item_id: itemId, name: itemName, direct: false, via_sub_recipes: [srName] })
      }
    }
  }

  // Deduplicate: a dish reached by multiple paths appears once with all paths listed
  const dishes = Array.from(dishMap.values())

  const result: DependencyMap = {
    ingredient_id: ingredientId,
    ingredient_name: ingredientName,
    sub_recipes: subRecipeDeps,
    dishes,
  }

  return Response.json(result)
}
