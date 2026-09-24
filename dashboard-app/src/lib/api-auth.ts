import { NextRequest } from 'next/server'
import { verifyShiftToken } from './shift-token'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Supabase session auth ─────────────────────────────────────────────────────

/** Validate a Supabase access token. Returns {id,email} or null. */
async function getSessionUser(request: NextRequest): Promise<{ id: string; email: string } | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = request.cookies.get('fs-at')?.value || bearer
  if (!token) return null
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? { id: user.id, email: user.email || '' } : null
  } catch {
    return null
  }
}

/** Validate a Supabase access token. Returns user id or null. */
export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  return (await getSessionUser(request))?.id || null
}

// ── Act-as (F-05, contención 2026-09-23) ──────────────────────────────────────
// Una membresía 'platform_actas' eleva a dueño SÓLO si:
//   · el request nombra ese tenant EXPLÍCITAMENTE (x-fullsite-tenant), y
//   · tiene menos de ACTAS_TTL_MINUTES (default 60) según client_users.created_at
//     (sin created_at legible → vencida: falla cerrado).
// Cada request NO-GET resuelto por act-as se registra en platform_audit_log con el
// actor real; si ese registro falla, el request se rechaza (null → 401).
// Límite conocido: esto vive en el servidor. Las lecturas directas del navegador a
// PostgREST pasan por RLS (private.user_has_client_access), que sin la migración
// PENDIENTE_20260923220000_actas_caducidad_y_agent_runs_tenant.sql sigue viendo el
// tenant hasta el exit o la revocación.
const ACTAS_ROLE = 'platform_actas'

function actasTtlMs(): number {
  const n = Number(process.env.ACTAS_TTL_MINUTES)
  return (Number.isFinite(n) && n > 0 ? n : 60) * 60_000
}

function actasVigente(createdAt: string | null | undefined, now = Date.now()): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN
  if (!Number.isFinite(t)) return false
  return now - t < actasTtlMs()
}

async function auditarActas(
  user: { id: string; email: string },
  clientId: string,
  request: NextRequest,
): Promise<boolean> {
  const svc = process.env.SUPABASE_SERVICE_KEY
  if (!svc) return false // platform_audit_log sólo acepta service_role: sin llave no hay auditoría
  let path = ''
  try { path = request.nextUrl?.pathname ?? new URL(request.url).pathname } catch { path = '' }
  try {
    const res = await fetch(`${SB_URL}/rest/v1/platform_audit_log`, {
      method: 'POST',
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{
        actor_email: user.email || `user:${user.id}`,
        actor_user_id: user.id,
        action: 'actas.request',
        scope: 'tenant',
        target_tenant: clientId,
        detail: { method: request.method, path },
      }]),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Guard for dashboard routes — returns 401 Response if not authenticated, null if OK. */
export async function requireAuth(request: NextRequest): Promise<Response | null> {
  const userId = await getSessionUserId(request)
  if (!userId) return Response.json({ error: 'No autorizado' }, { status: 401 })
  return null
}

// ── POS authenticated context ─────────────────────────────────────────────────
// Replaces getClientId() (which trusted a client-controlled x-client-id header).
// Accepts either a POS shift token (kiosk) or a Supabase session (dashboard).
// clientId is ALWAYS resolved from the server — never from request headers.

export interface POSAuthContext {
  clientId: string
  staffId: string
  staffName: string
  role: string
  authType: 'shift_token' | 'supabase_session'
}

/**
 * Authenticate a POS or dashboard API request.
 *
 * Kiosk path: shift token issued by /api/pos/pin → clientId from token payload
 * Dashboard path: Supabase session → clientId from client_users table (DB lookup)
 *
 * Returns null if neither token validates. Never trusts x-client-id header.
 */
export async function withPOSAuth(request: NextRequest): Promise<POSAuthContext | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const cookieToken = request.cookies.get('fs-at')?.value
  const token = bearer || cookieToken
  if (!token) return null

  // Try POS shift token first — avoids an outbound Supabase call for kiosk requests
  const shift = await verifyShiftToken(token)
  if (shift) {
    // FUGA F-7 CERRADA (2026-08-30): el shift token se validaba ANTES que la
    // sesión y no se borraba al cambiar de tenant, así que un token viejo seguía
    // enrutando lecturas/escrituras al restaurante anterior — evadiendo el fix
    // del header. Si el cliente declara un tenant distinto al del token, es un
    // token huérfano de otra sesión: se rechaza (fail-closed), y el logout ahora
    // lo purga (AuthContext).
    const hint = request.headers.get('x-fullsite-tenant')?.toLowerCase().trim()
    if (hint && hint !== shift.cid.toLowerCase()) return null
    return {
      clientId: shift.cid,
      staffId: shift.sub,
      staffName: shift.nam,
      role: shift.rol,
      authType: 'shift_token',
    }
  }

  // Fall back to Supabase session (dashboard users: dueño/gerente/capitan)
  const user = await getSessionUser(request)
  if (!user) return null
  const userId = user.id

  // Resolve clientId from client_users — not from user_metadata (user-writable)
  //
  // FUGA CERRADA (2026-08-30, vista en campo): esto era `limit=1` sin `order` —
  // para un usuario con VARIAS membresías (Daniel: 8; mañana cualquier dueño
  // multi-marca) Postgres devolvía una fila ARBITRARIA (en la práctica amalay),
  // así que /api/owner/* y time-clock leían Y ESCRIBÍAN sobre otro restaurante
  // sin importar cuál estaba viendo el usuario (el Equipo de tekila-rg mostró
  // los 40 meseros reales de AMALAY). Contrato nuevo:
  //   · El cliente puede SUGERIR tenant con el header `x-fullsite-tenant`; se
  //     honra SOLO si hay membresía para ese tenant (mismo patrón sancionado
  //     que requireTenant con body.client_id). Sin membresía → null (401).
  //   · Sin header: si el usuario tiene UNA membresía real, esa. Si tiene
  //     varias → FALLA CERRADO (null): adivinar es exactamente la fuga.
  const sbKey = process.env.SUPABASE_SERVICE_KEY || SB_ANON
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/client_users?user_id=eq.${encodeURIComponent(userId)}&select=client_id,role,created_at&order=client_id.asc&limit=50`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const all = await res.json() as Array<{ client_id: string; role: string; created_at?: string | null }>
    if (!Array.isArray(all) || all.length === 0) return null
    // F-05: una membresía act-as vencida no existe para efectos de autorización.
    const rows = all.filter(r => r.role !== ACTAS_ROLE || actasVigente(r.created_at))

    const hint = request.headers.get('x-fullsite-tenant')?.toLowerCase().trim()
    let membership: { client_id: string; role: string } | undefined
    if (hint) {
      // Una membresía real gana sobre una act-as para el mismo tenant.
      membership = rows.find(r => r.client_id === hint && r.role !== ACTAS_ROLE) ?? rows.find(r => r.client_id === hint)
      if (!membership) return null // pidió un tenant del que NO es miembro → fuera
    } else {
      // Sin tenant explícito, act-as NUNCA se usa (F-05: act-as exige tenant destino).
      const reales = rows.filter(r => r.role !== ACTAS_ROLE)
      membership = reales.length === 1 ? reales[0] : undefined
      if (!membership) return null // multi-membresía sin header → jamás adivinar
    }
    if (membership.role === ACTAS_ROLE && request.method !== 'GET' && request.method !== 'HEAD') {
      // Escritura en act-as: sin registro de auditoría con el actor real, no pasa.
      if (!(await auditarActas(user, membership.client_id, request))) return null
    }
    // Una membresía 'platform_actas' SOLO la crea /api/platform/act-as, que está
    // gateado por requirePlatformAdmin(+2FA). Es decir: su existencia PRUEBA que
    // un admin de plataforma entró deliberadamente a este tenant. En ese modo el
    // admin opera con acceso de dueño (igual que AuthContext, que fija rol 'dueño'
    // en act-as). Sin esta elevación, /api/owner/* daba 403 al propio admin
    // impersonando — regresión del fix de fugas, vista en campo 2026-08-30.
    const effectiveRole = membership.role === 'platform_actas' ? 'dueño' : membership.role
    return {
      clientId: membership.client_id,
      staffId: userId,
      staffName: '',
      role: effectiveRole,
      authType: 'supabase_session',
    }
  } catch {
    return null
  }
}

/** 401 response helper. */
export function unauthorized(message = 'No autorizado'): Response {
  return Response.json({ error: message }, { status: 401 })
}

// ── OP-39: role gate for sensitive /api/pos routes ────────────────────────────
// Jerarquía de roles. Incluye TANTO los de pos_staff (shift token: mesero..admin)
// COMO los de client_users (sesión dashboard: admin/dueño). `dueño` es el tope real
// (owner) — sin él, checkPosRole trataba a los dueños como nivel 0 → en strict los
// bloqueaba y en grace los marcaba como below_role (falsos eventos de fraude).
// `member`/`barra`/`cocina` quedan sin mapear a propósito → nivel 0 (no-manager) para
// estos gates administrativos (ajuste de stock / edición de receta).
export const POS_ROLE_LVL: Record<string, number> = {
  mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, dueño: 6,
}

/**
 * Grace-mode server-side role gate. Patrón hermano del de cancel-item:
 *  - rol >= minLevel                → { ok:true,  mode:'role:<rol>' }
 *  - rol <  minLevel + <strictEnv>='true' → { ok:false, mode:'blocked' }  (el caller devuelve 403)
 *  - rol <  minLevel + grace (default)    → { ok:true,  mode:'below_role:<rol>' } (el caller audita)
 *
 * Fase 1 (default): NO bloquea, solo audita — no rompe flujos legítimos ni offline.
 * Fase 2: setear el env flag a 'true' cuando el log deje de mostrar 'below_role:*'.
 */
export function checkPosRole(
  auth: { role?: string | null },
  minLevel: number,
  strictEnv: string,
): { ok: boolean; mode: string } {
  const rol = auth.role ?? ''
  const lvl = POS_ROLE_LVL[rol] ?? 0
  if (lvl >= minLevel) return { ok: true, mode: `role:${rol || 'unknown'}` }
  if (process.env[strictEnv] === 'true') return { ok: false, mode: 'blocked' }
  return { ok: true, mode: `below_role:${rol || 'unknown'}` }
}

// BLINDAJE P2-5: se ELIMINÓ el helper legacy getClientId(request) que confiaba en el
// header client-controlado x-client-id / query param client_id. Era código muerto (0
// importadores — todas las rutas usan withPOSAuth, que resuelve client_id server-side).
// Nunca reintroducir un client_id derivado de input del cliente para scoping de tenant.

/**
 * El tenant NUNCA lo decide quien llama.
 *
 * Nace de una auditoría de clonabilidad del 2026-08-26. Tres rutas tomaban el
 * `client_id` del cuerpo o del query string —o sea, del navegador— y consultaban
 * con SUPABASE_SERVICE_KEY, que ignora la RLS:
 *
 *   /api/agents/run                          POST, sin sesión, ESCRIBE
 *   /api/dashboard/hourly-distribution       GET,  sin sesión, lee pos_orders
 *   /api/integrations/uber-eats/reconcile    POST, sin sesión, ESCRIBE
 *
 * Cualquiera en internet podía mandar {client_id:"amalay"} y disparar los
 * agentes de otro restaurante, o leer sus órdenes. El filtro de la URL era el
 * único control, y lo controlaba el atacante.
 *
 * Este guardián resuelve el restaurante desde `client_users` (vía withPOSAuth) y
 * exige que coincida con el pedido. Si no hay sesión: 401. Si pide otro
 * restaurante: 403. Falla cerrado.
 *
 * Uso:
 *     const auth = await requireTenant(request, body.client_id)
 *     if (auth instanceof Response) return auth
 *     // a partir de aquí, auth.clientId es de confianza
 */
export async function requireTenant(
  request: NextRequest,
  pedido?: string | null,
): Promise<POSAuthContext | Response> {
  const ctx = await withPOSAuth(request)
  if (!ctx) return unauthorized('Se requiere sesión')

  if (pedido && pedido !== ctx.clientId) {
    // No se dice cuál es el suyo: eso ya sería filtrar información.
    return new Response(
      JSON.stringify({ error: 'El restaurante solicitado no corresponde a tu sesión' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return ctx
}
