// Uber Eats USL — OAuth callback (authorization code → tokens → store association).
//
// GET /api/integrations/uber-eats/auth/callback?code=X&state=Y
//
// Flow:
//   1. Validate CSRF state against httpOnly cookie
//   2. Exchange authorization code for access_token + refresh_token
//   3. Upsert integration_providers row with tokens (service role)
//   4. Upsert integration_store_mappings row
//   5. Redirect to /dashboard/integrations?status=connected
//
// NOTE: Tokens stored in _enc columns but NOT yet encrypted at rest.
//       Implement envelope encryption before production go-live.

import { type NextRequest, NextResponse } from 'next/server'
import { exchangeUberCode } from '@/lib/integrations/uber-eats/oauth'
import { auditLog } from '@/lib/integrations/audit-logger'
import { ADAPTER_VERSION } from '@/lib/integrations/uber-eats/adapter'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
function sbServiceKey(): string {
  const k = process.env.SUPABASE_SERVICE_KEY
  if (!k) throw new Error('[uber-usl] SUPABASE_SERVICE_KEY not configured')
  return k
}
function sbHeaders() {
  const k = sbServiceKey()
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }
}

function redirectUri(req: NextRequest): string {
  const override = process.env.UBER_REDIRECT_URI
  if (override) return override
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'app.fullsite.mx'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/api/integrations/uber-eats/auth/callback`
}

async function upsertProvider(clientId: string, storeId: string, tokens: {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const r = await fetch(`${SB_URL()}/rest/v1/integration_providers`, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      client_id: clientId,
      provider: 'ubereats',
      provider_version: ADAPTER_VERSION,
      provider_account_id: storeId,
      // NOTE: stored plaintext until encryption layer is implemented
      access_token_enc: tokens.access_token,
      token_expires_at: expiresAt,
      scopes: tokens.scope.split(' '),
      status: 'active',
      certification_state: 'uncertified',
      updated_at: new Date().toISOString(),
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`[uber-usl] upsertProvider failed ${r.status}: ${body}`)
  }
}

async function upsertStoreMapping(clientId: string, storeId: string): Promise<void> {
  const r = await fetch(`${SB_URL()}/rest/v1/integration_store_mappings`, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      provider: 'ubereats',
      provider_store_id: storeId,
      client_id: clientId,
      menu_sync_enabled: true,
      oos_sync_enabled: true,
      store_open: true,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`[uber-usl] upsertStoreMapping failed ${r.status}: ${body}`)
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')
  const correlationId = crypto.randomUUID()

  const errorUrl = (reason: string) =>
    `/dashboard/integrations?status=error&provider=ubereats&reason=${encodeURIComponent(reason)}&correlation_id=${correlationId}`

  // Handle Uber denying the authorization
  if (error) {
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId,
      action: 'usl.denied', response: { error },
    })
    return NextResponse.redirect(new URL(errorUrl(error), request.url))
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(new URL(errorUrl('missing_code_or_state'), request.url))
  }

  // CSRF validation — cookie must match state param
  const cookieState = request.cookies.get('uber_oauth_state')?.value
  if (!cookieState || cookieState !== stateParam) {
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId,
      action: 'usl.csrf_mismatch', response: { state_param: stateParam?.slice(0, 20) },
    })
    return NextResponse.redirect(new URL(errorUrl('csrf_validation_failed'), request.url))
  }

  // Extract store_id and client_id from state payload: "uuid|store_id|client_id"
  const [, storeId = '', clientId = 'amalay'] = stateParam.split('|')

  try {
    const callbackUri = redirectUri(request)
    const tokens = await exchangeUberCode(code, callbackUri)

    await Promise.all([
      upsertProvider(clientId, storeId, tokens),
      upsertStoreMapping(clientId, storeId),
    ])

    await auditLog({
      provider: 'ubereats', client_id: clientId, correlation_id: correlationId,
      action: 'usl.connected',
      request: { store_id: storeId },
      response: { scope: tokens.scope, expires_in: tokens.expires_in },
    })

    // Clear CSRF cookie
    const successUrl = `/dashboard/integrations?status=connected&provider=ubereats&store_id=${encodeURIComponent(storeId)}`
    const response = NextResponse.redirect(new URL(successUrl, request.url))
    response.cookies.set('uber_oauth_state', '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      maxAge: 0, path: '/api/integrations/uber-eats/auth',
    })
    return response

  } catch (e) {
    const msg = String(e)
    console.log(`[USL-CALLBACK][ERR] cid=${correlationId} error=${msg}`)
    const reason = msg.includes('upsertProvider') || msg.includes('upsertStoreMapping')
      ? 'db_write_failed'
      : 'token_exchange_failed'
    await auditLog({
      provider: 'ubereats', client_id: clientId, correlation_id: correlationId,
      action: 'usl.error', response: { error: msg, reason },
    })
    return NextResponse.redirect(new URL(errorUrl(reason), request.url))
  }
}
