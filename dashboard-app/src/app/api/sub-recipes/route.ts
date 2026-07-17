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

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

// ─── GET /api/sub-recipes ────────────────────────────────────────────────────
// Lists sub-recipes for the client. Does NOT include ingredients (use GET /[id] for detail).

export async function GET(request: NextRequest) {
  const clientId = getClientId(request)
  const activeOnly = request.nextUrl.searchParams.get('active') !== 'false'

  const filters = `client_id=eq.${clientId}${activeOnly ? '&active=eq.true' : ''}`
  const res = await fetch(
    `${SB_URL}/rest/v1/pos_sub_recipes?${filters}&order=name.asc&select=id,name,yield_quantity,yield_unit,notes,active,created_at,updated_at`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )

  if (!res.ok) {
    return err(502, 'DB_ERROR', 'Error al consultar sub-recetas')
  }

  return Response.json(await res.json())
}

// ─── POST /api/sub-recipes ───────────────────────────────────────────────────
// Creates a new sub-recipe (without ingredients — those are added via /[id]/ingredients).

export async function POST(request: NextRequest) {
  const clientId = getClientId(request)

  let body: { name?: string; yield_quantity?: number; yield_unit?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return err(400, 'INVALID_JSON', 'Body debe ser JSON válido')
  }

  // Validate
  const name = (body.name || '').trim()
  if (!name) {
    return err(400, 'NAME_REQUIRED', 'El nombre de la sub-receta es obligatorio')
  }

  const yieldQty = Number(body.yield_quantity)
  if (!yieldQty || yieldQty <= 0) {
    return err(400, 'YIELD_INVALID', 'La cantidad de rendimiento debe ser mayor a 0')
  }

  const yieldUnit = (body.yield_unit || '').trim().toUpperCase()
  if (!yieldUnit) {
    return err(400, 'UNIT_REQUIRED', 'La unidad de rendimiento es obligatoria')
  }

  const notes = (body.notes || '').trim() || null

  // Insert
  const res = await fetch(`${SB_URL}/rest/v1/pos_sub_recipes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      client_id: clientId,
      name,
      yield_quantity: yieldQty,
      yield_unit: yieldUnit,
      notes,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    if (text.includes('uq_sub_recipes_client_name') || text.includes('23505')) {
      return err(409, 'DUPLICATE_NAME', `Ya existe una sub-receta llamada "${name}"`)
    }
    return err(502, 'DB_ERROR', 'Error al crear sub-receta', text)
  }

  const rows = await res.json()
  const created = rows[0]
  return Response.json(created, { status: 201 })
}
