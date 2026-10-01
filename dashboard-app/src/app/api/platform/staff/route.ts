import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog } from '@/lib/platform-writes'

// Control Plane · GET/PATCH /api/platform/staff — ver/editar el personal de cualquier
// tenant. Via service_role (cross-tenant), gateado por platform admin.
// GET  ?client_id=X            → lista personal (SIN pin — V-A18)
// PATCH { client_id, id, pin?, name?, active? } → actualiza una fila
export const dynamic = 'force-dynamic'

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
// 4–10: los seeds del provisioning son de 10 dígitos; con el tope viejo de 8
// esta pantalla rechazaba los PINs que ella misma provisionó (gap Minute-0 #4).
const PIN_RE = /^\d{4,10}$/
const STAFF_PUBLIC_COLUMNS = ['id', 'name', 'role', 'role_display', 'active'] as const

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const clientId = req.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) return Response.json({ error: 'client_id inválido' }, { status: 400 })

  // V-A18 (2026-09-23): el PIN no sale al navegador ni para el super-admin (igual que
  // /api/platform/export, que ya lo excluía). Cambiarlo sigue siendo posible por PATCH.
  const res = await platformServiceFetch(
    `pos_staff?client_id=eq.${encodeURIComponent(clientId)}&select=${STAFF_PUBLIC_COLUMNS.join(',')}&order=name`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok) return Response.json({ error: `No se pudo leer (${res.status})` }, { status: 502 })
  const rows = await res.json().catch(() => [])
  // Allowlist al serializar: aunque la BD devolviera pin/pin_hash, no se reenvían.
  const staff = Array.isArray(rows)
    ? rows.map(r => Object.fromEntries(STAFF_PUBLIC_COLUMNS.map(k => [k, (r as Record<string, unknown>)?.[k] ?? null])))
    : []
  return Response.json({ staff })
}

export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { client_id?: string; id?: string; pin?: string; name?: string; active?: boolean } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  const { client_id, id } = body
  if (!client_id || !CLIENT_RE.test(client_id) || !id) return Response.json({ error: 'client_id e id requeridos' }, { status: 400 })

  const changes: Record<string, unknown> = {}
  if (typeof body.pin === 'string') {
    if (!PIN_RE.test(body.pin)) return Response.json({ error: 'PIN debe ser 4–10 dígitos' }, { status: 400 })
    changes.pin = body.pin
  }
  if (typeof body.name === 'string' && body.name.trim()) changes.name = body.name.trim()
  if (typeof body.active === 'boolean') changes.active = body.active
  if (Object.keys(changes).length === 0) return Response.json({ error: 'Nada que actualizar' }, { status: 400 })

  const res = await platformServiceFetch(
    `pos_staff?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(client_id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(changes),
    }
  )
  if (!res.ok) {
    // La unicidad del PIN la garantiza el índice único (pin, client_id): PostgREST responde
    // 409. Ya no hay lista de PINs en el navegador para pre-validar, así que se traduce.
    if (res.status === 409 && 'pin' in changes) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo actualizar (${res.status})`, detail }, { status: 502 })
  }

  await auditLog(gate.ctx, {
    action: 'staff.update',
    scope: 'tenant',
    target_tenant: client_id,
    detail: { id, campos: Object.keys(changes) }, // no logueamos el PIN en claro
  })
  return Response.json({ ok: true })
}
