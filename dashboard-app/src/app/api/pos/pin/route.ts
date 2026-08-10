import { NextRequest } from 'next/server'
import { issueShiftToken } from '@/lib/shift-token'

// PIN validation + shift token issuance.
// On success returns { staff, shiftToken } — the client stores shiftToken
// and sends it as Authorization: Bearer <shiftToken> on every POS request.
// This replaces the btoa(pin) PIN cache (P0-E fix) and provides server-verified
// identity for all POS API calls (P0-N fix via withPOSAuth).

const MAX_ATTEMPTS = 30
const WINDOW_MS = 300_000 // 5 minutes

// In-memory rate limit keyed by IP+PIN so one bad PIN from one terminal
// doesn't lock all terminals sharing the same NAT IP (restaurant scenario).
const attemptsByIp = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = attemptsByIp.get(ip)
  if (!entry || now > entry.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

async function respond(staff: { id: string; name: string; role: string }, clientId: string, ip: string) {
  attemptsByIp.delete(ip)
  let shiftToken: string | undefined
  try {
    shiftToken = await issueShiftToken(staff.id, clientId, staff.role, staff.name)
  } catch (e) {
    // SHIFT_TOKEN_SECRET not configured — log and continue without token (degrades to legacy flow)
    console.error('[pin] issueShiftToken failed (SHIFT_TOKEN_SECRET missing?):', e)
  }
  return Response.json({ staff, shiftToken })
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const { pin, client_id, manager, fingerprint_id, min_role } = await request.json()
    const rateLimitKey = `${ip}:${typeof pin === 'string' ? pin : 'x'}`
    if (!checkRateLimit(rateLimitKey)) {
      return Response.json({ error: 'Demasiados intentos' }, { status: 429 })
    }
    if (typeof client_id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(client_id)) {
      return Response.json({ error: 'client_id requerido' }, { status: 400 })
    }
    const clientId = client_id
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    // Clonable path (no per-tenant service key): resolve the PIN under the CALLER'S
    // Supabase JWT (fs-at cookie / Bearer). BUG-019 RLS scopes pos_staff to the
    // caller's tenant, so a PIN can only match staff of a tenant the caller belongs
    // to — the browser-supplied client_id cannot widen it, and the tenant of the
    // matched row (not the request body) is what binds the shift token. Falls back to
    // the service_role key only for legacy kiosks that carry no Supabase session.
    const callerJwt = request.cookies.get('fs-at')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const apiKeyHdr = callerJwt ? anon : (process.env.SUPABASE_SERVICE_KEY || '')
    const authHdr = callerJwt || process.env.SUPABASE_SERVICE_KEY || ''
    if (!authHdr) return Response.json({ error: 'Servicio no disponible' }, { status: 503 })
    const dbHeaders = { apikey: apiKeyHdr, Authorization: `Bearer ${authHdr}` }

    // Fingerprint (WebAuthn) login — look up by staff ID, validate active status + tenant
    if (fingerprint_id && typeof fingerprint_id === 'string') {
      const fpRes = await fetch(
        `${sbUrl}/rest/v1/pos_staff?id=eq.${encodeURIComponent(fingerprint_id)}&active=eq.true&client_id=eq.${encodeURIComponent(clientId)}&select=id,name,role,client_id&limit=1`,
        { headers: dbHeaders, cache: 'no-store' }
      )
      if (fpRes.ok) {
        const rows = await fpRes.json()
        if (Array.isArray(rows) && rows.length > 0) {
          return respond({ id: rows[0].id, name: rows[0].name, role: rows[0].role }, rows[0].client_id || clientId, rateLimitKey)
        }
      }
      return Response.json({ error: 'Empleado no encontrado o desactivado' }, { status: 401 })
    }

    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
      return Response.json({ error: 'PIN inválido' }, { status: 400 })
    }

    // Role hierarchy filter
    const ROLE_HIERARCHY: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }
    const effectiveMinRole = min_role || (manager === true ? 'gerente' : null)
    let roleFilter = ''
    if (effectiveMinRole && ROLE_HIERARCHY[effectiveMinRole]) {
      const minLevel = ROLE_HIERARCHY[effectiveMinRole]
      const allowedRoles = Object.entries(ROLE_HIERARCHY)
        .filter(([, level]) => level >= minLevel)
        .map(([role]) => role)
      roleFilter = `&role=in.(${allowedRoles.join(',')})`
    }

    const res = await fetch(
      `${sbUrl}/rest/v1/pos_staff?pin=eq.${encodeURIComponent(pin)}&active=eq.true&client_id=eq.${encodeURIComponent(clientId)}${roleFilter}&select=id,name,role,client_id&limit=1`,
      { headers: dbHeaders, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows) && rows.length > 0) {
        return respond({ id: rows[0].id, name: rows[0].name, role: rows[0].role }, rows[0].client_id || clientId, rateLimitKey)
      }
    }

    // Fallback PIN — server-side env, never exposed to client
    const fallback = process.env.POS_FALLBACK_PIN
    if (fallback && pin === fallback) {
      return respond({ id: 'admin', name: 'Admin', role: 'admin' }, clientId, rateLimitKey)
    }

    // MANAGER_PINS — server-side env format "pin:Nombre,pin:Nombre"
    if (manager === true) {
      const raw = process.env.MANAGER_PINS || ''
      for (const entry of raw.split(',')) {
        const [p, name] = entry.split(':')
        if (p && name && p.trim() === pin) {
          return respond({ id: 'manager', name: name.trim(), role: 'gerente' }, clientId, rateLimitKey)
        }
      }
    }

    return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
