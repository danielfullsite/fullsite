import { NextRequest } from 'next/server'
import { verifyStepUp, is2FAEnforced, STEPUP_COOKIE } from './platform-2fa'

// ── Control Plane · contrato de seguridad ─────────────────────────────────────
// El super-admin es el objetivo #1 de un atacante, así que TODA acción cross-tenant
// pasa por aquí. Reglas:
//  - La sesión se verifica SERVER-SIDE contra GoTrue (nunca se confía en app_metadata
//    ni en headers del cliente).
//  - is_platform_admin (tabla platform_admins) es la fuente de verdad; se invoca SOLO
//    con la service_role key (la función está revocada de PUBLIC/anon/authenticated).
//  - Fail-closed: sin SUPABASE_SERVICE_KEY → 503. Sin sesión → 401. No admin → 403.
//  - RLS por tenant (BUG-019) se mantiene; el admin lee cross-tenant SOLO vía service_role
//    en el servidor, nunca bypasseando RLS desde el cliente con la anon key.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export interface PlatformAdminContext {
  userId: string
  email: string
}

/** Verifica el token de sesión contra GoTrue. Devuelve {id,email} o null. */
async function getSessionUser(request: NextRequest): Promise<{ id: string; email: string } | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = request.cookies.get('fs-at')?.value || bearer
  if (!token) return null
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const user = await res.json()
    if (!user?.id) return null
    return { id: user.id, email: user.email || '' }
  } catch {
    return null
  }
}

/**
 * Guard para endpoints /api/platform/*. Verifica que la SESIÓN pertenezca a un platform admin.
 * Uso:
 *   const gate = await requirePlatformAdmin(req)
 *   if ('error' in gate) return gate.error
 *   // gate.ctx.userId / gate.ctx.email disponibles
 */
export async function requirePlatformAdmin(
  request: NextRequest
): Promise<{ ctx: PlatformAdminContext } | { error: Response }> {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) {
    return { error: Response.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503 }) }
  }
  const user = await getSessionUser(request)
  if (!user) return { error: Response.json({ error: 'No autorizado' }, { status: 401 }) }

  try {
    // is_platform_admin sólo es callable por service_role (revocada de anon/authenticated).
    const res = await fetch(`${SB_URL}/rest/v1/rpc/is_platform_admin`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: user.email, p_user_id: user.id }),
      cache: 'no-store',
    })
    if (!res.ok) return { error: Response.json({ error: 'Acceso denegado' }, { status: 403 }) }
    const isAdmin = await res.json()
    if (isAdmin !== true) {
      return { error: Response.json({ error: 'Acceso denegado: no es platform admin' }, { status: 403 }) }
    }
    return { ctx: { userId: user.id, email: user.email } }
  } catch {
    return { error: Response.json({ error: 'Error verificando admin' }, { status: 500 }) }
  }
}

/**
 * Guard ESTRICTO: requirePlatformAdmin + segundo factor por correo (step-up).
 * Usar en TODOS los endpoints /api/platform/* EXCEPTO los del propio flujo 2FA
 * (status/send/verify/enroll), que usan requirePlatformAdmin base.
 *
 * Fail-open por flag: si PLATFORM_2FA_ENFORCED !== 'true', se comporta idéntico
 * al guard base (NO exige el segundo factor → cero riesgo de lockout mientras se
 * prueba el flujo). Con enforcement ON y sin token step-up válido → 401 { error: '2fa_required' }.
 */
export async function requirePlatformAdmin2FA(
  request: NextRequest,
  nowMs: number = Date.now()
): Promise<{ ctx: PlatformAdminContext } | { error: Response }> {
  const base = await requirePlatformAdmin(request)
  if ('error' in base) return base
  if (!is2FAEnforced()) return base

  const token = request.cookies.get(STEPUP_COOKIE)?.value
  const uid = verifyStepUp(token, nowMs)
  if (!uid || uid !== base.ctx.userId) {
    return { error: Response.json({ error: '2fa_required' }, { status: 401 }) }
  }
  return base
}

/**
 * Fetch a PostgREST con la service_role key (cross-tenant, bypassa RLS SOLO server-side).
 * Usar únicamente dentro de endpoints ya protegidos por requirePlatformAdmin().
 * `path` es la parte tras /rest/v1/ (ej. "clients?select=id,display_name").
 */
export function platformServiceFetch(path: string, init?: RequestInit): Promise<Response> {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
}

/** Base URL de Supabase (para endpoints que arman rutas RPC/REST propias). */
export const PLATFORM_SB_URL = SB_URL
