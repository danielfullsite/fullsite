import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError { code: string; message: string; details?: unknown }
function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

// ─── GET /api/unit-conversions ───────────────────────────────────────────────
// List all unit conversions for the client (system + custom).

export async function GET(request: NextRequest) {
  const clientId = getClientId(request)

  const res = await fetch(
    `${SB_URL}/rest/v1/pos_unit_conversions?client_id=eq.${clientId}&order=from_unit.asc,to_unit.asc&select=id,from_unit,to_unit,factor,is_system`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )

  if (!res.ok) return err(502, 'DB_ERROR', 'Error al consultar conversiones')
  return Response.json(await res.json())
}

// ─── POST /api/unit-conversions ──────────────────────────────────────────────
// Create a custom unit conversion. System conversions cannot be created via API.

export async function POST(request: NextRequest) {
  const clientId = getClientId(request)

  let body: { from_unit?: string; to_unit?: string; factor?: number }
  try {
    body = await request.json()
  } catch {
    return err(400, 'INVALID_JSON', 'Body debe ser JSON válido')
  }

  const fromUnit = (body.from_unit || '').trim().toUpperCase()
  const toUnit = (body.to_unit || '').trim().toUpperCase()
  const factor = Number(body.factor)

  if (!fromUnit) return err(400, 'FROM_UNIT_REQUIRED', 'from_unit es obligatorio')
  if (!toUnit) return err(400, 'TO_UNIT_REQUIRED', 'to_unit es obligatorio')
  if (fromUnit === toUnit) return err(400, 'SAME_UNITS', 'from_unit y to_unit deben ser diferentes')
  if (!factor || factor <= 0) return err(400, 'FACTOR_INVALID', 'factor debe ser mayor a 0')

  const res = await fetch(`${SB_URL}/rest/v1/pos_unit_conversions`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      client_id: clientId,
      from_unit: fromUnit,
      to_unit: toUnit,
      factor,
      is_system: false,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    if (text.includes('uq_uc_client_units') || text.includes('23505')) {
      return err(409, 'DUPLICATE', `Ya existe conversión de ${fromUnit} a ${toUnit}`)
    }
    return err(502, 'DB_ERROR', 'Error al crear conversión', text)
  }

  const rows = await res.json()
  return Response.json(rows[0], { status: 201 })
}
