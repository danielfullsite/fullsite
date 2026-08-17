import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { randomUUID } from 'crypto'

/**
 * A2a — Gestión de staff POS + PINs desde el DASHBOARD del dueño.
 *
 * Reemplaza el hueco donde esto solo existía dentro del POS (/pos/staff, con
 * escritura anon-key). Aquí el dueño/gerente gestiona a su equipo desde el
 * dashboard vía un endpoint server-side con service_role.
 *
 * Seguridad (anti-fraude / anti-escalación):
 *  - Autenticación: withPOSAuth (cookie fs-at del dashboard o shift token).
 *  - clientId SIEMPRE del contexto de auth, NUNCA del body → sin cruce de tenants.
 *  - Gate: solo roles manager (dueño/admin/gerente) pueden gestionar equipo.
 *  - Escalación: solo dueño/admin puede crear/editar staff con rol admin|gerente;
 *    un gerente solo gestiona roles ≤ capitan.
 *  - PIN: 3–8 dígitos, único entre staff ACTIVO del mismo tenant. Nunca se loguea
 *    en claro (auditoría registra solo los campos cambiados, no el valor).
 */

export const dynamic = 'force-dynamic'

const MANAGER_ROLES = new Set(['dueño', 'admin', 'gerente'])
const ELEVATED_STAFF_ROLES = new Set(['admin', 'gerente'])
const ALLOWED_STAFF_ROLES = new Set(['mesero', 'cajero', 'cocina', 'barra', 'capitan', 'gerente', 'admin'])
const PIN_RE = /^\d{3,8}$/

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function svc() {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return null
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/** ¿El caller puede asignar este rol de staff? dueño/admin todo; gerente solo ≤ capitan. */
function canAssignRole(callerRole: string, staffRole: string): boolean {
  if (callerRole === 'dueño' || callerRole === 'admin') return true
  // gerente: no puede tocar roles elevados
  return !ELEVATED_STAFF_ROLES.has(staffRole)
}

async function pinTaken(H: Record<string, string>, clientId: string, pin: string, exceptId?: string): Promise<boolean> {
  const cid = encodeURIComponent(clientId)
  let url = `${SB_URL}/rest/v1/pos_staff?client_id=eq.${cid}&pin=eq.${encodeURIComponent(pin)}&active=eq.true&select=id`
  const res = await fetch(url, { headers: H, cache: 'no-store' })
  if (!res.ok) return false
  const rows: { id: string }[] = await res.json()
  return rows.some(r => r.id !== exceptId)
}

async function audit(H: Record<string, string>, clientId: string, staffId: string, action: string, fields: string[], by: string) {
  try {
    await fetch(`${SB_URL}/rest/v1/pos_staff_audit`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: clientId, staff_id: staffId, action, changed_fields: fields, changed_by: by }),
    })
  } catch { /* auditoría best-effort, no bloquea la operación */ }
}

// ── GET — lista el staff del tenant del caller ────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño o gerente' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const res = await fetch(
    `${SB_URL}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(auth.clientId)}` +
    `&select=id,name,pin,role,role_display,active,hourly_rate,weekly_salary&order=name`,
    { headers: H, cache: 'no-store' }
  )
  if (!res.ok) return Response.json({ error: `No se pudo leer (${res.status})` }, { status: 502 })
  // callerRole permite a la UI gatear el dropdown de roles (un gerente no ofrece admin/gerente).
  return Response.json({ staff: await res.json(), callerRole: auth.role })
}

// ── POST — crea un miembro del staff ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño o gerente' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const role = typeof body?.role === 'string' ? body.role : ''
  if (!name) return Response.json({ error: 'Nombre requerido' }, { status: 400 })
  if (!PIN_RE.test(pin)) return Response.json({ error: 'PIN debe ser 3–8 dígitos' }, { status: 400 })
  if (!ALLOWED_STAFF_ROLES.has(role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })
  if (!canAssignRole(auth.role, role)) return Response.json({ error: 'No puedes asignar ese rol' }, { status: 403 })
  if (await pinTaken(H, auth.clientId, pin)) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })

  const id = `${auth.clientId}-${randomUUID()}`
  const row = {
    id, client_id: auth.clientId, name, pin, role, role_display: role, active: true,
    hourly_rate: Number(body?.hourly_rate) || 0, weekly_salary: Number(body?.weekly_salary) || 0,
  }
  const res = await fetch(`${SB_URL}/rest/v1/pos_staff`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo crear (${res.status})`, detail: detail.slice(0, 200) }, { status: 502 })
  }
  await audit(H, auth.clientId, id, 'created', ['name', 'pin', 'role'], auth.staffName || auth.role)
  return Response.json({ ok: true, id })
}

// ── PATCH — edita nombre/PIN/rol/estado/tarifas ───────────────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño o gerente' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return Response.json({ error: 'id requerido' }, { status: 400 })
  const cid = encodeURIComponent(auth.clientId)

  // Cargar la fila objetivo — DEBE pertenecer al tenant del caller (scoping duro).
  const curRes = await fetch(
    `${SB_URL}/rest/v1/pos_staff?id=eq.${encodeURIComponent(id)}&client_id=eq.${cid}&select=id,role`,
    { headers: H, cache: 'no-store' }
  )
  const cur: { id: string; role: string }[] = curRes.ok ? await curRes.json() : []
  if (cur.length === 0) return Response.json({ error: 'Staff no encontrado' }, { status: 404 })
  // No puedes editar a alguien de rol elevado si tú no eres dueño/admin.
  if (!canAssignRole(auth.role, cur[0].role)) return Response.json({ error: 'No puedes editar ese rol' }, { status: 403 })

  const changes: Record<string, unknown> = {}
  const fields: string[] = []
  if (typeof body.name === 'string' && body.name.trim()) { changes.name = body.name.trim(); fields.push('name') }
  if (typeof body.pin === 'string') {
    if (!PIN_RE.test(body.pin)) return Response.json({ error: 'PIN debe ser 3–8 dígitos' }, { status: 400 })
    if (await pinTaken(H, auth.clientId, body.pin, id)) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
    changes.pin = body.pin; fields.push('pin')
  }
  if (typeof body.role === 'string') {
    if (!ALLOWED_STAFF_ROLES.has(body.role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })
    if (!canAssignRole(auth.role, body.role)) return Response.json({ error: 'No puedes asignar ese rol' }, { status: 403 })
    changes.role = body.role; changes.role_display = body.role; fields.push('role')
  }
  if (typeof body.active === 'boolean') { changes.active = body.active; fields.push('active') }
  if (body.hourly_rate != null) { changes.hourly_rate = Number(body.hourly_rate) || 0; fields.push('hourly_rate') }
  if (body.weekly_salary != null) { changes.weekly_salary = Number(body.weekly_salary) || 0; fields.push('weekly_salary') }
  if (fields.length === 0) return Response.json({ error: 'Nada que actualizar' }, { status: 400 })

  const res = await fetch(
    `${SB_URL}/rest/v1/pos_staff?id=eq.${encodeURIComponent(id)}&client_id=eq.${cid}`,
    { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(changes) }
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo actualizar (${res.status})`, detail: detail.slice(0, 200) }, { status: 502 })
  }
  const action = ('active' in changes && fields.length === 1) ? (changes.active ? 'reactivated' : 'deactivated') : 'updated'
  await audit(H, auth.clientId, id, action, fields, auth.staffName || auth.role)
  return Response.json({ ok: true })
}
