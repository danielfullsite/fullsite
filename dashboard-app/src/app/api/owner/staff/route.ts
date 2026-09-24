import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import { randomUUID, randomInt } from 'crypto'
import { columnasDePin } from '@/lib/pos-staff-pin-write'
import { esPimientaNoConfigurada, HTTP_AUTORIDAD_NO_DISPONIBLE } from '@/lib/pos-pin-hash'

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
 *  - PIN: 4–10 dígitos, único en el tenant (activo o no). Nunca se loguea en claro
 *    (auditoría registra solo los campos cambiados) y el GET NUNCA lo devuelve (V-A18).
 *  - Nadie se cambia a sí mismo el rol ni se desactiva (2026-09-24): con shift token el
 *    rol sale de `pos_staff.role`, así que editarlo sería autorizarse con un dato propio.
 *  - PIN con hash (F2, PLAN-PIN-HASH.md): `columnasDePin` escribe pin_hash junto al pin
 *    cuando POS_PIN_DUAL_WRITE=on; sin pimienta → 503 authority_unavailable, nunca pin solo.
 *  - Restablecer PIN: PATCH { id, reset_pin: true } → el servidor genera uno libre y lo
 *    devuelve UNA vez. Auditoría: created, role_changed, pin_reset, deactivated,
 *    reactivated, updated (la base además audita por trigger, ver migración 20260925010000).
 *  - Desde 2026-09-24 el navegador NO puede escribir pos_staff por PostgREST ni por el proxy
 *    del kiosco (/api/pos/db): esta ruta es la única puerta para el dashboard y el POS.
 */

export const dynamic = 'force-dynamic'

const MANAGER_ROLES = new Set(['dueño', 'admin', 'gerente'])
const ELEVATED_STAFF_ROLES = new Set(['admin', 'gerente'])
const ALLOWED_STAFF_ROLES = new Set(['mesero', 'cajero', 'cocina', 'barra', 'capitan', 'gerente', 'admin'])
// 4–10 dígitos: 4 = PIN corto que teclea el mesero; hasta 10 para el PIN de
// respaldo generado por el sistema (ver src/lib/pos-pin.ts). Debe coincidir con
// el CHECK de BD pos_staff_pin_len_chk (^[0-9]{4,10}$).
const PIN_RE = /^\d{4,10}$/

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

// Columnas que SÍ pueden salir al navegador. Allowlist (no denylist): aunque la BD
// devolviera columnas de más (pin, pin_hash, lo que se agregue mañana), se proyecta aquí.
const STAFF_PUBLIC_COLUMNS = ['id', 'name', 'role', 'role_display', 'active', 'hourly_rate', 'weekly_salary'] as const

function publicStaff(rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return []
  return rows.map(r => Object.fromEntries(STAFF_PUBLIC_COLUMNS.map(k => [k, (r as Record<string, unknown>)?.[k] ?? null])))
}

async function pinTaken(H: Record<string, string>, clientId: string, pin: string, exceptId?: string): Promise<boolean> {
  const cid = encodeURIComponent(clientId)
  // OJO: NO filtrar por active. El índice único de BD es `unique_pin_per_client
  // UNIQUE (pin, client_id)` — abarca staff INACTIVO también. Si filtráramos active,
  // un PIN de un mesero desactivado se vería "libre" aquí pero el INSERT chocaría con
  // el índice → 502 opaco (y el autogen podría lazar sin salida). Chequear contra TODO
  // el tenant para coincidir con la constraint.
  const url = `${SB_URL}/rest/v1/pos_staff?client_id=eq.${cid}&pin=eq.${encodeURIComponent(pin)}&select=id`
  const res = await fetch(url, { headers: H, cache: 'no-store' })
  if (!res.ok) return false
  const rows: { id: string }[] = await res.json()
  return rows.some(r => r.id !== exceptId)
}

/** PIN de 4 dígitos que nadie del tenant (activo o no) tiene. null si no hubo suerte. */
async function generarPinLibre(H: Record<string, string>, clientId: string, exceptId?: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const cand = String(randomInt(0, 10000)).padStart(4, '0')
    if (!(await pinTaken(H, clientId, cand, exceptId))) return cand
  }
  return null
}

/** Pimienta ausente con doble escritura encendida: la nube no puede juzgar PINs ahora. */
function autoridadNoDisponible(): Response {
  return Response.json(
    { error: 'No se pudo asegurar el PIN — la configuración del servidor está incompleta', code: HTTP_AUTORIDAD_NO_DISPONIBLE.code },
    { status: HTTP_AUTORIDAD_NO_DISPONIBLE.status },
  )
}

/** Acción de auditoría para un PATCH, por prioridad de riesgo. */
function accionDeAuditoria(fields: string[], active?: unknown): string {
  if (fields.includes('role')) return 'role_changed'
  if (fields.includes('pin')) return 'pin_reset'
  if (fields.length === 1 && fields[0] === 'active') return active ? 'reactivated' : 'deactivated'
  return 'updated'
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

  // V-A18 (2026-09-23): el PIN NO sale al navegador — ni en claro ni como hash. Antes se
  // seleccionaba `pin` y /pos/staff comparaba unicidad en el cliente; la unicidad la decide
  // el servidor (pinTaken en POST/PATCH + índice único unique_pin_per_client).
  const res = await fetch(
    `${SB_URL}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(auth.clientId)}` +
    `&select=${STAFF_PUBLIC_COLUMNS.join(',')}&order=name`,
    { headers: H, cache: 'no-store' }
  )
  if (!res.ok) return Response.json({ error: `No se pudo leer (${res.status})` }, { status: 502 })
  const rows = await res.json().catch(() => [])
  // callerRole permite a la UI gatear el dropdown de roles (un gerente no ofrece admin/gerente).
  return Response.json({ staff: publicStaff(rows), callerRole: auth.role })
}

// ── POST — crea un miembro del staff ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño o gerente' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  let pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  const role = typeof body?.role === 'string' ? body.role : ''
  if (!name) return Response.json({ error: 'Nombre requerido' }, { status: 400 })
  if (!ALLOWED_STAFF_ROLES.has(role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })
  if (!canAssignRole(auth.role, role)) return Response.json({ error: 'No puedes asignar ese rol' }, { status: 403 })

  // OP-42 — alta rápida: si el gerente no teclea PIN, generamos uno de 4 dígitos
  // único entre el staff ACTIVO del tenant (alta de mesero en ~15s en la rotación).
  // Si lo teclea, se valida y se checa colisión como siempre.
  let pinGenerated = false
  if (!pin) {
    const libre = await generarPinLibre(H, auth.clientId)
    if (!libre) return Response.json({ error: 'No se pudo generar un PIN libre — especifícalo manualmente' }, { status: 409 })
    pin = libre; pinGenerated = true
  } else {
    if (!PIN_RE.test(pin)) return Response.json({ error: 'PIN debe ser 4–10 dígitos' }, { status: 400 })
    if (await pinTaken(H, auth.clientId, pin)) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
  }

  let pinCols
  try { pinCols = await columnasDePin(auth.clientId, pin) } catch (e) {
    if (esPimientaNoConfigurada(e)) return autoridadNoDisponible()
    throw e
  }
  const id = `${auth.clientId}-${randomUUID()}`
  const row = {
    id, client_id: auth.clientId, name, ...pinCols, role, role_display: role, active: true,
    hourly_rate: Number(body?.hourly_rate) || 0, weekly_salary: Number(body?.weekly_salary) || 0,
  }
  const res = await fetch(`${SB_URL}/rest/v1/pos_staff`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  })
  if (!res.ok) {
    // Colisión de PIN por carrera (índice único) → mensaje legible en vez de 502 opaco.
    if (res.status === 409) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo crear (${res.status})`, detail: detail.slice(0, 200) }, { status: 502 })
  }
  await audit(H, auth.clientId, id, 'created', ['name', 'pin', 'role'], auth.staffName || auth.role)
  // Devolvemos el PIN SOLO de la fila recién creada, para mostrarlo una vez (sobre todo
  // cuando fue autogenerado). El GET ya no lo expone: quien lo pierda, lo cambia (PATCH).
  return Response.json({ ok: true, id, pin, pinGenerated })
}

// ── PATCH — edita nombre/PIN/rol/estado/tarifas ───────────────────────────────
export async function PATCH(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
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
  // Uno mismo no se cambia el rol ni se apaga: con shift token el rol ES pos_staff.role, así
  // que editarlo sería autorizarse con un dato propio. Lo hace otro gerente o el dueño.
  const esUnoMismo = auth.authType === 'shift_token' && auth.staffId === id
  if (esUnoMismo && (typeof body.role === 'string' || typeof body.active === 'boolean')) {
    return Response.json({ error: 'No puedes cambiar tu propio rol ni desactivarte' }, { status: 403 })
  }

  const changes: Record<string, unknown> = {}
  const fields: string[] = []
  let pinNuevo: string | null = null
  if (typeof body.name === 'string' && body.name.trim()) { changes.name = body.name.trim(); fields.push('name') }
  if (body.reset_pin === true && typeof body.pin === 'string') {
    return Response.json({ error: 'Usa pin o reset_pin, no ambos' }, { status: 400 })
  }
  if (body.reset_pin === true) {
    pinNuevo = await generarPinLibre(H, auth.clientId, id)
    if (!pinNuevo) return Response.json({ error: 'No se pudo generar un PIN libre — especifícalo manualmente' }, { status: 409 })
  } else if (typeof body.pin === 'string') {
    if (!PIN_RE.test(body.pin)) return Response.json({ error: 'PIN debe ser 4–10 dígitos' }, { status: 400 })
    if (await pinTaken(H, auth.clientId, body.pin, id)) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
    pinNuevo = body.pin
  }
  if (pinNuevo) {
    try { Object.assign(changes, await columnasDePin(auth.clientId, pinNuevo)) } catch (e) {
      if (esPimientaNoConfigurada(e)) return autoridadNoDisponible()
      throw e
    }
    fields.push('pin')
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
    if (res.status === 409) return Response.json({ error: 'Ese PIN ya está en uso' }, { status: 409 })
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo actualizar (${res.status})`, detail: detail.slice(0, 200) }, { status: 502 })
  }
  await audit(H, auth.clientId, id, accionDeAuditoria(fields, changes.active), fields, auth.staffName || auth.role)
  // El PIN restablecido se devuelve UNA vez, igual que en el alta. Un PIN tecleado por el
  // gerente no se devuelve: ya lo tiene.
  return Response.json(body.reset_pin === true ? { ok: true, pin: pinNuevo } : { ok: true })
}
