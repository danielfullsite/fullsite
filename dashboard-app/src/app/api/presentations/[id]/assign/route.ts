import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError { code: string; message: string; details?: unknown }
function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

const readHdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

type RouteCtx = { params: Promise<{ id: string }> }

// ─── POST /api/presentations/[id]/assign ─────────────────────────────────────
// Assigns a presentation to an ingredient with equivalence data.

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { id: presentationId } = await ctx.params
  const clientId = getClientId(request)

  // 1. Verify presentation exists and belongs to client
  const presRes = await fetch(
    `${SB_URL}/rest/v1/pos_presentations?id=eq.${encodeURIComponent(presentationId)}&client_id=eq.${clientId}&select=id`,
    { headers: readHdrs, cache: 'no-store' },
  )
  const presRows = presRes.ok ? await presRes.json() : []
  if (presRows.length === 0) {
    return err(404, 'PRESENTATION_NOT_FOUND', 'Presentación no encontrada')
  }

  // 2. Parse body
  let body: {
    ingredient_id?: string
    contains_quantity?: number
    contains_unit?: string
    cost_per_presentation?: number
    supplier_id?: string
  }
  try {
    body = await request.json()
  } catch {
    return err(400, 'INVALID_JSON', 'Body debe ser JSON válido')
  }

  // 3. Validate ingredient_id
  const ingredientId = (body.ingredient_id || '').trim()
  if (!ingredientId) {
    return err(400, 'INGREDIENT_REQUIRED', 'ingredient_id es obligatorio')
  }

  const ingRes = await fetch(
    `${SB_URL}/rest/v1/pos_ingredients?id=eq.${encodeURIComponent(ingredientId)}&client_id=eq.${clientId}&select=id`,
    { headers: readHdrs, cache: 'no-store' },
  )
  const ingRows = ingRes.ok ? await ingRes.json() : []
  if (ingRows.length === 0) {
    return err(404, 'INGREDIENT_NOT_FOUND', 'Ingrediente no encontrado')
  }

  // 4. Validate contains_quantity
  const containsQty = Number(body.contains_quantity)
  if (!containsQty || containsQty <= 0) {
    return err(400, 'QUANTITY_INVALID', 'contains_quantity debe ser mayor a 0')
  }

  // 5. Validate contains_unit
  const containsUnit = (body.contains_unit || '').trim().toUpperCase()
  if (!containsUnit) {
    return err(400, 'UNIT_REQUIRED', 'contains_unit es obligatoria')
  }

  // 6. Validate cost (optional, default 0, must be >= 0)
  const cost = Number(body.cost_per_presentation || 0)
  if (cost < 0) {
    return err(400, 'COST_INVALID', 'cost_per_presentation no puede ser negativo')
  }

  // 7. supplier_id is optional, pass through
  const supplierId = (body.supplier_id || '').trim() || null

  // 8. Insert
  const res = await fetch(`${SB_URL}/rest/v1/pos_ingredient_presentations`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      client_id: clientId,
      ingredient_id: ingredientId,
      presentation_id: presentationId,
      contains_quantity: containsQty,
      contains_unit: containsUnit,
      cost_per_presentation: cost,
      supplier_id: supplierId,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    if (text.includes('uq_ip_client_ingredient_pres') || text.includes('23505')) {
      return err(409, 'DUPLICATE', 'Este ingrediente ya tiene asignada esta presentación')
    }
    return err(502, 'DB_ERROR', 'Error al asignar presentación', text)
  }

  const rows = await res.json()
  return Response.json(rows[0], { status: 201 })
}
