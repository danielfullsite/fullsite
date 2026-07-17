import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError { code: string; message: string; details?: unknown }
function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

type RouteCtx = { params: Promise<{ id: string; lineId: string }> }

// ─── DELETE /api/sub-recipes/[id]/ingredients/[lineId] ──────────────────────

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { id: subRecipeId, lineId } = await ctx.params
  const clientId = getClientId(request)

  // Verify sub-recipe exists and belongs to client
  const srRes = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipes?id=eq.${encodeURIComponent(subRecipeId)}&client_id=eq.${clientId}&select=id`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )
  const srRows = srRes.ok ? await srRes.json() : []
  if (srRows.length === 0) {
    return err(404, 'SUB_RECIPE_NOT_FOUND', 'Sub-receta no encontrada')
  }

  // Verify ingredient line exists and belongs to this sub-recipe
  const lineRes = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipe_ingredients?id=eq.${encodeURIComponent(lineId)}&sub_recipe_id=eq.${encodeURIComponent(subRecipeId)}&select=id`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )
  const lineRows = lineRes.ok ? await lineRes.json() : []
  if (lineRows.length === 0) {
    return err(404, 'LINE_NOT_FOUND', 'Línea de ingrediente no encontrada')
  }

  // Delete
  const delRes = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipe_ingredients?id=eq.${encodeURIComponent(lineId)}&sub_recipe_id=eq.${encodeURIComponent(subRecipeId)}`,
    { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  )

  if (!delRes.ok) {
    return err(502, 'DB_ERROR', 'Error al eliminar ingrediente')
  }

  return Response.json({ deleted: true, id: Number(lineId) })
}
