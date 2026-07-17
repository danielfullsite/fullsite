import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError {
  code: string
  message: string
  details?: unknown
}

function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

const hdrs = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

type RouteCtx = { params: Promise<{ id: string }> }

// Helper: fetch sub-recipe with client_id guard
async function fetchSubRecipe(id: string, clientId: string) {
  const res = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipes?id=eq.${encodeURIComponent(id)}&client_id=eq.${clientId}&select=*`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0] || null
}

// ─── GET /api/sub-recipes/[id] ──────────────────────────────────────────────
// Detail: sub-recipe with its ingredients (resolved names).

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const clientId = getClientId(request)

  const subRecipe = await fetchSubRecipe(id, clientId)
  if (!subRecipe) {
    return err(404, 'NOT_FOUND', 'Sub-receta no encontrada')
  }

  // Fetch ingredients
  const ingRes = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipe_ingredients?sub_recipe_id=eq.${encodeURIComponent(id)}&order=created_at.asc&select=id,ingredient_id,ingredient_type,quantity,unit`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )
  const ingredients = ingRes.ok ? await ingRes.json() : []

  // Resolve ingredient names
  const resolvedIngredients = await Promise.all(
    ingredients.map(async (ing: { id: number; ingredient_id: string; ingredient_type: string; quantity: number; unit: string }) => {
      let ingredientName = ing.ingredient_id
      if (ing.ingredient_type === 'ingredient') {
        const r = await fetch(
          `${SB_URL}/rest/v1/pos_ingredients?id=eq.${encodeURIComponent(ing.ingredient_id)}&client_id=eq.${clientId}&select=name`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
        )
        if (r.ok) {
          const rows = await r.json()
          if (rows[0]) ingredientName = rows[0].name
        }
      } else if (ing.ingredient_type === 'sub_recipe') {
        const r = await fetch(
          `${SB_URL}/rest/v1/pos_sub_recipes?id=eq.${encodeURIComponent(ing.ingredient_id)}&client_id=eq.${clientId}&select=name`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
        )
        if (r.ok) {
          const rows = await r.json()
          if (rows[0]) ingredientName = rows[0].name
        }
      }
      return { ...ing, ingredient_name: ingredientName }
    }),
  )

  return Response.json({ ...subRecipe, ingredients: resolvedIngredients })
}

// ─── PATCH /api/sub-recipes/[id] ────────────────────────────────────────────
// Partial update: only fields present in the body are updated.

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const clientId = getClientId(request)

  const existing = await fetchSubRecipe(id, clientId)
  if (!existing) {
    return err(404, 'NOT_FOUND', 'Sub-receta no encontrada')
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return err(400, 'INVALID_JSON', 'Body debe ser JSON válido')
  }

  // Build patch — only fields present in body
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('name' in body) {
    const name = String(body.name || '').trim()
    if (!name) return err(400, 'NAME_REQUIRED', 'El nombre no puede estar vacío')
    patch.name = name
  }

  if ('yield_quantity' in body) {
    const yq = Number(body.yield_quantity)
    if (!yq || yq <= 0) return err(400, 'YIELD_INVALID', 'La cantidad de rendimiento debe ser mayor a 0')
    patch.yield_quantity = yq
  }

  if ('yield_unit' in body) {
    const yu = String(body.yield_unit || '').trim().toUpperCase()
    if (!yu) return err(400, 'UNIT_REQUIRED', 'La unidad de rendimiento es obligatoria')
    patch.yield_unit = yu
  }

  if ('notes' in body) {
    patch.notes = body.notes ? String(body.notes).trim() : null
  }

  if ('active' in body) {
    patch.active = Boolean(body.active)
  }

  const res = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipes?id=eq.${encodeURIComponent(id)}&client_id=eq.${clientId}`,
    {
      method: 'PATCH',
      headers: { ...hdrs, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    if (text.includes('uq_sub_recipes_client_name') || text.includes('23505')) {
      return err(409, 'DUPLICATE_NAME', `Ya existe una sub-receta con ese nombre`)
    }
    return err(502, 'DB_ERROR', 'Error al actualizar sub-receta', text)
  }

  const rows = await res.json()
  return Response.json(rows[0])
}

// ─── DELETE /api/sub-recipes/[id] ───────────────────────────────────────────
// Soft delete (active=false). Checks dependencies first.

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const clientId = getClientId(request)

  const existing = await fetchSubRecipe(id, clientId)
  if (!existing) {
    return err(404, 'NOT_FOUND', 'Sub-receta no encontrada')
  }

  // Check if used as ingredient in other sub-recipes
  const usedInSubRes = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipe_ingredients?ingredient_id=eq.${encodeURIComponent(id)}&ingredient_type=eq.sub_recipe&select=sub_recipe_id`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  )
  const usedInSub = usedInSubRes.ok ? await usedInSubRes.json() : []

  // Check if used in dish recipes
  const usedInDishRes = await fetch(
    `${SB_URL}/rest/v1/pos_recipes_old?ingredient_id=eq.${encodeURIComponent(id)}&ingredient_type=eq.sub_recipe&client_id=eq.${clientId}&select=menu_item_id,menu_item_name`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  )
  const usedInDish = usedInDishRes.ok ? await usedInDishRes.json() : []

  if (usedInSub.length > 0 || usedInDish.length > 0) {
    return err(409, 'IN_USE', 'No se puede eliminar: esta sub-receta está en uso', {
      sub_recipes: usedInSub.map((r: { sub_recipe_id: string }) => r.sub_recipe_id),
      dishes: usedInDish.map((r: { menu_item_id: string; menu_item_name: string }) => ({
        id: r.menu_item_id,
        name: r.menu_item_name,
      })),
    })
  }

  // Soft delete
  const res = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipes?id=eq.${encodeURIComponent(id)}&client_id=eq.${clientId}`,
    {
      method: 'PATCH',
      headers: { ...hdrs, Prefer: 'return=representation' },
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    },
  )

  if (!res.ok) {
    return err(502, 'DB_ERROR', 'Error al eliminar sub-receta')
  }

  return Response.json({ deleted: true, id })
}
