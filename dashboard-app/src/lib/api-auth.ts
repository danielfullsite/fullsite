import { NextRequest } from 'next/server'
import { verifyShiftToken } from './shift-token'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Supabase session auth ─────────────────────────────────────────────────────

/** Validate a Supabase access token. Returns user id or null. */
export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = request.cookies.get('fs-at')?.value || bearer
  if (!token) return null
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id || null
  } catch {
    return null
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
    return {
      clientId: shift.cid,
      staffId: shift.sub,
      staffName: shift.nam,
      role: shift.rol,
      authType: 'shift_token',
    }
  }

  // Fall back to Supabase session (dashboard users: dueño/gerente/capitan)
  const userId = await getSessionUserId(request)
  if (!userId) return null

  // Resolve clientId from client_users — not from user_metadata (user-writable)
  const sbKey = process.env.SUPABASE_SERVICE_KEY || SB_ANON
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/client_users?user_id=eq.${encodeURIComponent(userId)}&select=client_id,role&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) return null
    return {
      clientId: rows[0].client_id,
      staffId: userId,
      staffName: '',
      role: rows[0].role,
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
