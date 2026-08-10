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
  /**
   * The caller's Supabase access token (JWT), when available (fs-at cookie or a
   * Supabase Bearer). Lets POS routes run DB access under the caller's RLS instead
   * of the service_role key — so a tenant needs NO server-side service key. Absent
   * for pure-kiosk shift-token requests that carry no Supabase session.
   */
  supabaseJwt?: string
}

/** How a POS route should reach the DB: the caller's JWT (RLS) if present, else the service key. */
export interface PosDbAuth {
  url: string
  apikey: string
  token: string
  via: 'user_jwt' | 'service_role'
}

/**
 * Resolve the DB credentials a POS route should use. Prefers the caller's Supabase
 * JWT (RLS-scoped — clonable, no per-tenant service key) and falls back to the
 * service_role key only when there is no Supabase session (legacy kiosk). Returns
 * null when neither is available (caller must respond 503, fail-closed).
 */
export function posDbAuth(ctx: POSAuthContext | null, request: NextRequest): PosDbAuth | null {
  const jwt = ctx?.supabaseJwt || request.cookies.get('fs-at')?.value
  if (jwt) return { url: SB_URL, apikey: SB_ANON, token: jwt, via: 'user_jwt' }
  const svc = process.env.SUPABASE_SERVICE_KEY
  if (svc) return { url: SB_URL, apikey: svc, token: svc, via: 'service_role' }
  return null
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
      // A browser POS terminal carries the Supabase session cookie alongside the
      // shift token → reuse it for RLS-scoped DB access (no service key needed).
      supabaseJwt: cookieToken,
    }
  }

  // Fall back to Supabase session (dashboard users: dueño/gerente/capitan)
  const userId = await getSessionUserId(request)
  if (!userId) return null

  // The caller's Supabase access token — used both to resolve membership and for
  // RLS-scoped DB access downstream. Matches what getSessionUserId() validated.
  const userJwt = cookieToken || bearer
  // Resolve clientId from client_users UNDER THE CALLER'S JWT (RLS read-own) — never
  // from user_metadata (user-writable), never with the service key (clonable path).
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/client_users?user_id=eq.${encodeURIComponent(userId)}&select=client_id,role&limit=1`,
      { headers: { apikey: SB_ANON, Authorization: `Bearer ${userJwt}` }, cache: 'no-store' }
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
      supabaseJwt: userJwt,
    }
  } catch {
    return null
  }
}

/** 401 response helper. */
export function unauthorized(message = 'No autorizado'): Response {
  return Response.json({ error: message }, { status: 401 })
}

// ── Legacy helper ─────────────────────────────────────────────────────────────
// WARNING: getClientId() trusts a client-controlled header. Only safe on routes
// that already enforce requireAuth() AND where the user is assumed to be honest
// (internal dashboard fetches). Never use on unauthenticated routes.

const CLIENT_ID_RE = /^[a-z0-9_-]{1,40}$/i

/** @deprecated Use withPOSAuth() for POS mutation routes. */
export function getClientId(request: NextRequest): string {
  const fromHeader = request.headers.get('x-client-id')
  if (fromHeader && CLIENT_ID_RE.test(fromHeader)) return fromHeader
  const fromParam = request.nextUrl.searchParams.get('client_id')
  if (fromParam && CLIENT_ID_RE.test(fromParam)) return fromParam
  return ''
}
