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
import { requireTenant } from '@/lib/api-auth'
import { isManager } from '@/lib/pos-db-policy'

const STORE_ID_RE = /^[a-z0-9_-]{1,128}$/i

function redirectUri(req: NextRequest): string {
  const override = process.env.UBER_REDIRECT_URI
  if (override) return override
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'app.fullsite.mx'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/api/integrations/uber-eats/auth/callback`
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id') || ''
  const requestedClientId = searchParams.get('client_id')

  // Este flujo termina guardando tokens de Uber con service_role. El navegador
  // que lo inicia debe probar membresía del tenant; una cookie CSRF sólo enlaza
  // ida y vuelta, no autoriza a escoger un restaurante.
  const auth = await requireTenant(request, requestedClientId)
  if (auth instanceof Response) return auth
  if (!isManager(auth.role)) {
    return NextResponse.json({ error: 'Se requiere rol de gerente' }, { status: 403 })
  }
  const clientId = auth.clientId

  // `state` usa `|` como separador. Sin una lista de caracteres explícita, un
  // store_id como `tienda|victima` desplazaba el client_id que lee el callback.
  if (!STORE_ID_RE.test(storeId)) {
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
