import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { loadCostEngineData, calculateDishCost, calculateSubRecipeCost } from '@/lib/cost-engine'

// ─── GET /api/food-cost/calculate?item_id=X or ?sub_recipe_id=X ─────────────
// Pure cost calculation. No side effects. No caching. No persistence.

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const clientId = auth.clientId
  const itemId = request.nextUrl.searchParams.get('item_id')
  const subRecipeId = request.nextUrl.searchParams.get('sub_recipe_id')

  if (!itemId && !subRecipeId) {
    return Response.json(
      { code: 'PARAM_REQUIRED', message: 'Especifica item_id o sub_recipe_id' },
      { status: 400 },
    )
  }

  const data = await loadCostEngineData(clientId, itemId || undefined)

  if (subRecipeId) {
    if (!data.subRecipes.has(subRecipeId)) {
      return Response.json(
        { code: 'NOT_FOUND', message: 'Sub-receta no encontrada' },
        { status: 404 },
      )
    }
    return Response.json(calculateSubRecipeCost(subRecipeId, data))
  }

  if (itemId) {
    const result = calculateDishCost(itemId, data)
    if (result.ingredients.length === 0 && result.warnings.length > 0) {
      return Response.json(
        { code: 'NOT_FOUND', message: result.warnings[0] },
        { status: 404 },
      )
    }
    return Response.json(result)
  }

  return Response.json({ code: 'PARAM_REQUIRED', message: 'Especifica item_id o sub_recipe_id' }, { status: 400 })
}
