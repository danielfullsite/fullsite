import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import { randomBytes } from 'crypto'

/**
 * A2b (Fase 1) — Usuarios del DASHBOARD, autoservicio del dueño.
 *
 * El dueño da de alta cuentas de dashboard para su equipo SIN contactar a Fullsite
 * (modelo Wansoft). Fase 1 NO depende de correo: el servidor auto-genera una
 * contraseña temporal fuerte y se devuelve UNA vez para que el dueño la comparta;
 * el empleado la cambia después. Fase 2 (cuando haya SMTP): invitación por link.
 *
 * Reemplaza el /admin/usuarios teatro (que guardaba un JSON y no creaba auth.users).
 *
 * BLINDAJE (API-proof):
 *  - sameOriginOnly: rechaza mutaciones cross-origin (token robado desde otro sitio
 *    o integración de tercero no autorizada) — las integraciones van por Fullsite.
 *  - Solo rol DUEÑO gestiona usuarios de dashboard (otorgar accesos es del dueño).
 *  - clientId SIEMPRE del token server-side (withPOSAuth) — jamás del body.
 *  - Sin escalación: rol asignable ∈ roles de tenant; NUNCA platform_admin.
 *    app_metadata.role lo fija el servidor (no es user-writable).
 *  - Sin IDOR: toda acción sobre un usuario verifica que sea MIEMBRO de tu tenant.
 *  - Protección del super-admin: ninguna acción puede tocar a un platform_admin.
 */

export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const MANAGER_ROLES = new Set(['dueño', 'admin'])           // quién puede gestionar usuarios
const ASSIGNABLE_ROLES = new Set(['dueño', 'gerente', 'capitan', 'cajero', 'mesero'])
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function svc(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return null
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}
function genTempPassword(): string {
  // 12 chars base64url (≈72 bits) — fuerte, legible, temporal. El empleado la cambia.
  return randomBytes(9).toString('base64url')
}
async function adminGetUser(H: Record<string, string>, userId: string): Promise<{ id: string; email: string; app_metadata: Record<string, unknown> } | null> {
  const res = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: H, cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}
async function isPlatformAdmin(H: Record<string, string>, email: string): Promise<boolean> {
  const res = await fetch(`${SB_URL}/rest/v1/platform_admins?email=eq.${encodeURIComponent(email)}&select=email`, { headers: H, cache: 'no-store' })
  if (!res.ok) return true // fail-closed: si no podemos verificar, no tocar
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows.length > 0
}
async function membership(H: Record<string, string>, clientId: string, userId: string): Promise<{ id: string; role: string } | null> {
  const res = await fetch(
    `${SB_URL}/rest/v1/client_users?client_id=eq.${encodeURIComponent(clientId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,role&limit=1`,
    { headers: H, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

// ── GET — usuarios de dashboard del tenant del caller ─────────────────────────
export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Solo el dueño gestiona usuarios del dashboard' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const memRes = await fetch(
    `${SB_URL}/rest/v1/client_users?client_id=eq.${encodeURIComponent(auth.clientId)}&select=user_id,role,created_at&order=created_at`,
    { headers: H, cache: 'no-store' }
  )
  if (!memRes.ok) return Response.json({ error: `No se pudo leer (${memRes.status})` }, { status: 502 })
  const members: { user_id: string; role: string; created_at: string }[] = await memRes.json()

  // Resolver email por miembro (Admin API). Excluir el service-account del Local Server.
  const users = await Promise.all(members
    .filter(m => m.role !== 'local_server')
    .map(async m => {
      const u = await adminGetUser(H, m.user_id)
      return { user_id: m.user_id, email: u?.email || '(desconocido)', role: m.role, display_name: (u?.app_metadata?.display_name as string) || '' }
    }))
  return Response.json({ users, callerRole: auth.role })
}

// ── POST — crea un usuario de dashboard con contraseña temporal ───────────────
export async function POST(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Solo el dueño gestiona usuarios del dashboard' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const role = typeof body?.role === 'string' ? body.role : ''
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Correo inválido' }, { status: 400 })
  if (!name) return Response.json({ error: 'Nombre requerido' }, { status: 400 })
  if (!ASSIGNABLE_ROLES.has(role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })

  const tempPassword = genTempPassword()
  const createRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      email, password: tempPassword, email_confirm: true,
      // app_metadata = fuente de verdad server-side del enforcement (no user-writable).
      app_metadata: { client_id: auth.clientId, role, display_name: name },
      user_metadata: { client_id: auth.clientId, display_name: name, must_change_password: true },
    }),
  })
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '')
    // Email ya existe globalmente → NO lo adjuntamos a este tenant (evita apropiarse
    // de una cuenta ajena). El dueño usa un correo nuevo.
    const msg = /already.*registered|exists|duplicate/i.test(detail) ? 'Ese correo ya tiene una cuenta' : `No se pudo crear (${createRes.status})`
    return Response.json({ error: msg }, { status: createRes.status === 422 ? 409 : 502 })
  }
  const created = await createRes.json()
  const userId = created?.id
  if (!userId) return Response.json({ error: 'No se pudo resolver el usuario' }, { status: 502 })

  // Membresía del tenant (check-then-insert; client_users no tiene UNIQUE(user,client)).
  const exists = await membership(H, auth.clientId, userId)
  if (!exists) {
    await fetch(`${SB_URL}/rest/v1/client_users`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, client_id: auth.clientId, role }),
    })
  }
  // La contraseña temporal se devuelve UNA vez — el dueño la comparte, el empleado la cambia.
  return Response.json({ ok: true, user_id: userId, email, role, tempPassword })
}

// ── PATCH — cambiar rol o resetear contraseña ─────────────────────────────────
export async function PATCH(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Solo el dueño gestiona usuarios del dashboard' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!userId) return Response.json({ error: 'user_id requerido' }, { status: 400 })

  // Sin IDOR: el objetivo DEBE ser miembro de tu tenant.
  const mem = await membership(H, auth.clientId, userId)
  if (!mem) return Response.json({ error: 'Usuario no encontrado en tu restaurante' }, { status: 404 })
  // El objetivo no puede ser un platform_admin (protección del super-admin).
  const target = await adminGetUser(H, userId)
  if (!target) return Response.json({ error: 'Usuario no encontrado' }, { status: 404 })
  if (await isPlatformAdmin(H, target.email)) return Response.json({ error: 'No permitido' }, { status: 403 })

  const results: Record<string, unknown> = { ok: true }

  // Cambio de rol → client_users.role + app_metadata.role (en sync), client_id intacto.
  if (typeof body.role === 'string') {
    if (!ASSIGNABLE_ROLES.has(body.role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })
    await fetch(`${SB_URL}/rest/v1/client_users?client_id=eq.${encodeURIComponent(auth.clientId)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ role: body.role }),
    })
    await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ app_metadata: { ...(target.app_metadata || {}), client_id: auth.clientId, role: body.role } }),
    })
    results.role = body.role
  }

  // Reset de contraseña → nueva temporal, devuelta una vez.
  if (body.reset_password === true) {
    const tempPassword = genTempPassword()
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT', headers: H, body: JSON.stringify({ password: tempPassword }),
    })
    if (!r.ok) return Response.json({ error: 'No se pudo resetear la contraseña' }, { status: 502 })
    results.tempPassword = tempPassword
  }

  return Response.json(results)
}

// ── DELETE — quitar acceso al dashboard (remueve la membresía del tenant) ──────
export async function DELETE(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Solo el dueño gestiona usuarios del dashboard' }, { status: 403 })
  const H = svc()
  if (!H) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

  const userId = request.nextUrl.searchParams.get('user_id') || ''
  if (!userId) return Response.json({ error: 'user_id requerido' }, { status: 400 })
  if (userId === auth.staffId) return Response.json({ error: 'No puedes quitarte a ti mismo' }, { status: 400 })

  const mem = await membership(H, auth.clientId, userId)
  if (!mem) return Response.json({ error: 'Usuario no encontrado en tu restaurante' }, { status: 404 })
  const target = await adminGetUser(H, userId)
  if (target && await isPlatformAdmin(H, target.email)) return Response.json({ error: 'No permitido' }, { status: 403 })

  // Quita SOLO la membresía a este tenant (el auth.users puede pertenecer a otros).
  await fetch(`${SB_URL}/rest/v1/client_users?client_id=eq.${encodeURIComponent(auth.clientId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' },
  })
  return Response.json({ ok: true })
}
