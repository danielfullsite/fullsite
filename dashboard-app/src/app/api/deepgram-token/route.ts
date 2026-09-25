import { NextRequest, NextResponse } from 'next/server'
import { withPOSAuth, unauthorized, POS_ROLE_LVL } from '@/lib/api-auth'

/**
 * GET /api/deepgram-token — token EFÍMERO de Deepgram para STT en el navegador.
 *
 * Contención V-C07 (2026-09-23): antes esta ruta devolvía `process.env.DEEPGRAM_API_KEY`
 * TAL CUAL a cualquier usuario con sesión Supabase (sin membresía ni rol). La llave maestra
 * nunca vuelve a salir del servidor: se acuña un token temporal con la API oficial de
 * Deepgram (documentación: developers.deepgram.com/reference/auth/tokens/grant y
 * /guides/fundamentals/token-based-authentication):
 *
 *   POST https://api.deepgram.com/v1/auth/grant
 *   Authorization: Token <DEEPGRAM_API_KEY>      (la llave necesita permiso Member+)
 *   { "ttl_seconds": 30 }                        (default 30 s, máximo 3600 s)
 *   → { "access_token": "<JWT>", "expires_in": 30 }
 *
 * El navegador usa ese JWT con `Authorization: Bearer <token>`; tiene `usage::write` y NO
 * sirve para las Management APIs.
 *
 * Guardas, en orden (fallan cerrado):
 *   · sin sesión / sin membresía de restaurante (withPOSAuth) → 401
 *   · rol < gerente → 403
 *   · DEEPGRAM_TOKEN_ENABLED !== 'true'  → 410 deepgram_token_disabled (default: apagado;
 *     ninguna pantalla consume esta ruta hoy — encenderla requiere autorización)
 *   · sin DEEPGRAM_API_KEY → 503 deepgram_not_configured
 *   · > RATE_MAX tokens por minuto por usuario+tenant → 429
 *   · Deepgram falla → 502 deepgram_grant_failed (sin reenviar su cuerpo)
 */

export const dynamic = 'force-dynamic'

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant'
const TTL_SECONDS = 30
const MIN_ROLE_LEVEL = POS_ROLE_LVL.gerente
const RATE_MAX = 5
const RATE_WINDOW_MS = 60_000

// Rate limit en memoria por instancia: suficiente como contención (el acuñado ya exige
// gerente+ con membresía). No es un límite global entre instancias serverless.
const _hits = new Map<string, number[]>()

function rateLimited(key: string, now = Date.now()): boolean {
  const prev = (_hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS)
  if (prev.length >= RATE_MAX) { _hits.set(key, prev); return true }
  prev.push(now)
  _hits.set(key, prev)
  return false
}

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if ((POS_ROLE_LVL[auth.role] ?? 0) < MIN_ROLE_LEVEL) {
    return NextResponse.json({ error: 'Requiere rol gerente o superior' }, { status: 403, headers: noStore })
  }

  if (process.env.DEEPGRAM_TOKEN_ENABLED !== 'true') {
    return NextResponse.json({ error: 'deepgram_token_disabled' }, { status: 410, headers: noStore })
  }

  const masterKey = process.env.DEEPGRAM_API_KEY
  if (!masterKey) {
    return NextResponse.json({ error: 'deepgram_not_configured' }, { status: 503, headers: noStore })
  }

  if (rateLimited(`${auth.clientId}:${auth.staffId}`)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { ...noStore, 'Retry-After': '60' } })
  }

  let grant: { access_token?: unknown; expires_in?: unknown }
  try {
    const res = await fetch(GRANT_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${masterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
      cache: 'no-store',
    })
    if (!res.ok) {
      // Solo el status: el cuerpo del proveedor no se reenvía ni se loguea.
      console.error(`[deepgram-token] grant falló: HTTP ${res.status}`)
      return NextResponse.json({ error: 'deepgram_grant_failed' }, { status: 502, headers: noStore })
    }
    grant = await res.json()
  } catch {
    console.error('[deepgram-token] grant falló: error de red')
    return NextResponse.json({ error: 'deepgram_grant_failed' }, { status: 502, headers: noStore })
  }

  if (typeof grant?.access_token !== 'string' || !grant.access_token || grant.access_token.includes(masterKey)) {
    // (revisión H-8: `includes`, no `===`: si el proveedor repitiera la llave dentro del token)
    return NextResponse.json({ error: 'deepgram_grant_failed' }, { status: 502, headers: noStore })
  }
  const expiresIn = typeof grant.expires_in === 'number' && grant.expires_in > 0
    ? Math.min(grant.expires_in, TTL_SECONDS)
    : TTL_SECONDS

  return NextResponse.json(
    { token: grant.access_token, expires_in: expiresIn, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() },
    { headers: noStore },
  )
}
