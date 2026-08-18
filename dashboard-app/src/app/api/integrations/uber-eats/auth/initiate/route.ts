// Uber Eats USL — Initiate OAuth authorization flow.
//
// GET /api/integrations/uber-eats/auth/initiate?store_id=X&client_id=Y
//
// Generates a CSRF state token, stores it in an httpOnly cookie,
// and redirects the merchant to Uber's OAuth authorization page.
// The operator calls this when connecting a new Uber Eats store.

import { type NextRequest, NextResponse } from 'next/server'
import { buildUberAuthUrl } from '@/lib/integrations/uber-eats/oauth'
import { auditLog } from '@/lib/integrations/audit-logger'
import { withPOSAuth } from '@/lib/api-auth'

function redirectUri(req: NextRequest): string {
  const override = process.env.UBER_REDIRECT_URI
  if (override) return override
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'app.fullsite.mx'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/api/integrations/uber-eats/auth/callback`
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()

  // BLINDAJE B1 (P0-3): el client_id se deriva de la SESIÓN, no del query param.
  // Antes un atacante iniciaba el flujo con client_id=<víctima> y mapeaba su propia
  // tienda Uber al tenant de la víctima. Ahora el state lleva el client_id autenticado.
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const clientId = auth.clientId

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id') || ''

  if (!storeId) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 })
  }

  // Generate CSRF state: uuid + encoded store context
  const state = `${correlationId}|${storeId}|${clientId}`
  const callbackUri = redirectUri(request)
  let authUrl: string
  try {
    authUrl = buildUberAuthUrl(state, callbackUri)
  } catch (e) {
    console.error('[uber/initiate] oauth_config_error', e)
    return NextResponse.json({ error: 'oauth_config_error' }, { status: 503 })
  }

  await auditLog({
    provider: 'ubereats',
    client_id: clientId,
    correlation_id: correlationId,
    action: 'usl.initiate',
    request: { store_id: storeId, redirect_uri: callbackUri },
  })

  const response = NextResponse.redirect(authUrl)
  // State cookie: httpOnly, Secure, SameSite=Lax, 10-minute TTL
  response.cookies.set('uber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/integrations/uber-eats/auth',
  })
  return response
}
