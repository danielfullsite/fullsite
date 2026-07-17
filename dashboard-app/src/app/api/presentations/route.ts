import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ApiError { code: string; message: string; details?: unknown }
function err(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, details } satisfies ApiError, { status })
}

// ─── GET /api/presentations ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const clientId = getClientId(request)
  const activeOnly = request.nextUrl.searchParams.get('active') !== 'false'

  const filters = `client_id=eq.${clientId}${activeOnly ? '&active=eq.true' : ''}`
  const res = await fetch(
    `${SB_URL}/rest/v1/pos_presentations?${filters}&order=code.asc&select=id,code,name,active,created_at`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
  )

  if (!res.ok) return err(502, 'DB_ERROR', 'Error al consultar presentaciones')
  return Response.json(await res.json())
}

// ─── POST /api/presentations ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const clientId = getClientId(request)

  let body: { code?: string; name?: string }
  try {
    body = await request.json()
  } catch {
    return err(400, 'INVALID_JSON', 'Body debe ser JSON válido')
  }

  const code = (body.code || '').trim().toUpperCase()
  if (!code) return err(400, 'CODE_REQUIRED', 'El código de la presentación es obligatorio')

  const name = (body.name || '').trim()
  if (!name) return err(400, 'NAME_REQUIRED', 'El nombre de la presentación es obligatorio')

  const res = await fetch(`${SB_URL}/rest/v1/pos_presentations`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ client_id: clientId, code, name }),
  })

  if (!res.ok) {
    const text = await res.text()
    if (text.includes('uq_pres_client_code') || text.includes('23505')) {
      return err(409, 'DUPLICATE_CODE', `Ya existe una presentación con código "${code}"`)
    }
    return err(502, 'DB_ERROR', 'Error al crear presentación', text)
  }

  const rows = await res.json()
  return Response.json(rows[0], { status: 201 })
}
