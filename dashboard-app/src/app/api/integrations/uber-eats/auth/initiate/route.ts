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

function redirectUri(req: NextRequest): string {
  const override = process.env.UBER_REDIRECT_URI
  if (override) return override
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'app.fullsite.mx'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/api/integrations/uber-eats/auth/callback`
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  const t0 = Date.now()
  console.log(`[USL-INITIATE][1] request_received cid=${correlationId} url=${request.url}`)

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id') || ''
  const clientId = searchParams.get('client_id') || process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || 'amalay'
  console.log(`[USL-INITIATE][2] params_validated store_id=${storeId} client_id=${clientId} +${Date.now() - t0}ms`)

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
    console.log(`[USL-INITIATE][ERR] buildUberAuthUrl threw: ${String(e)} +${Date.now() - t0}ms`)
    return NextResponse.json({ error: 'oauth_config_error', detail: String(e) }, { status: 503 })
  }
  console.log(`[USL-INITIATE][3] state_and_url_built auth_host=${new URL(authUrl).host} callback=${callbackUri} +${Date.now() - t0}ms`)

  console.log(`[USL-INITIATE][4] audit_log_start +${Date.now() - t0}ms`)
  const tAudit = Date.now()
  await auditLog({
    provider: 'ubereats',
    client_id: clientId,
    correlation_id: correlationId,
    action: 'usl.initiate',
    request: { store_id: storeId, redirect_uri: callbackUri },
  })
  console.log(`[USL-INITIATE][5] audit_log_done duration=${Date.now() - tAudit}ms +${Date.now() - t0}ms`)

  const response = NextResponse.redirect(authUrl)
  // State cookie: httpOnly, Secure, SameSite=Lax, 10-minute TTL
  response.cookies.set('uber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/integrations/uber-eats/auth',
  })
  console.log(`[USL-INITIATE][6] returning_302 redirect_to=${new URL(authUrl).host} total=${Date.now() - t0}ms`)
  return response
}
