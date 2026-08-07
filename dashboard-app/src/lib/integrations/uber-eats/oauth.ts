// Uber Eats OAuth — client_credentials (M2M) + authorization code (USL) flows.
//
// Identity/domains come exclusively from env.ts (resolveUberIdentity):
//   sandbox    → Test Client       @ sandbox-login.uber.com / test-api.uber.com
//   production → Production Client @ auth.uber.com / api.uber.com
// Cross-environment client use is structurally impossible — see env.ts.
//
// Grant model (verified against developer.uber.com, 2026-08-06):
//   authorization_code (USL) — merchant consents in browser.
//     Scopes: eats.pos_provisioning (+ offline_access → refresh_token).
//     Used for: integration activation flows (pos_data setup via merchant),
//     store discovery during onboarding.
//   client_credentials (M2M) — app-level, cached in memory per scope set.
//     eats.order                → accept / deny / cancel / order details (v1) / cart patch
//     eats.store.orders.read    → order details (v2)
//     eats.store                → pos_data GET, menu upload, Update Item
//     eats.store.status.write   → store availability
//     eats.deliveries           → /v1/delivery/order/... endpoints
//
// Fail-closed: getUberAccessToken verifies the scope Uber actually granted
// covers every scope requested; a silently-narrowed grant throws instead of
// letting API calls fail downstream with confusing 401s.

import { resolveUberIdentity, resolveUberEnv, uberDomains, describeUberIdentity, UberConfigError, type UberIdentity } from './env'
import { openToken, sealToken } from '../token-vault'

export class UberScopeError extends Error {
  constructor(requested: string, granted: string) {
    super(`[uber-oauth] scope not granted: requested='${requested}' granted='${granted}' — approve the missing scopes in the Uber Developer Dashboard`)
    this.name = 'UberScopeError'
  }
}

// Exported for testing and for modules that only need domains.
// Domains require only a valid UBER_ENV (fail closed on missing/invalid env);
// credentials are validated separately by resolveUberIdentity at call time.
export const getLoginUrl = (): string => uberDomains(resolveUberEnv()).loginUrl
export const getAuthorizeUrl = (): string => uberDomains(resolveUberEnv()).authorizeUrl
export const getApiBase = (): string => uberDomains(resolveUberEnv()).apiBase

// USL requests offline_access so Uber returns a refresh_token — without it the
// stored merchant connection dies at token_expires_at with no recovery path.
export const USL_SCOPES = ['eats.pos_provisioning', 'offline_access']
export const MARKETPLACE_M2M_SCOPES = ['eats.store', 'eats.store.status.write', 'eats.order', 'eats.store.orders.read']
// eats.deliveries: kept for reference only. The audit reconciliation (2026-08-07)
// found NO public evidence that it is the scope for the /v1/delivery/order/*
// Order Fulfillment family — no tokenType consumes it anymore. Blocker A2.
export const DELIVERY_M2M_SCOPES = ['eats.deliveries']

/**
 * Scope for the current Order Fulfillment family (/v1/delivery/order/*).
 * Uber's public docs do not state it (blocker A2) — we refuse to guess.
 * Set UBER_ORDER_FULFILLMENT_SCOPE once Uber confirms (or once a scope probe
 * against the test store proves which grant the family accepts).
 */
export function getOrderFulfillmentScope(): string {
  const scope = (process.env.UBER_ORDER_FULFILLMENT_SCOPE ?? '').trim()
  if (!scope) {
    throw new UberConfigError(
      'scope for /v1/delivery/order/* is not confirmed by Uber (blocker A2) — set UBER_ORDER_FULFILLMENT_SCOPE once confirmed; refusing to call with a guessed scope'
    )
  }
  return scope
}

// Explicit scope constants (kept for audit documentation)
export const SCOPE_ORDER = 'eats.order'
export const SCOPE_STORE = 'eats.store'
export const SCOPE_STORE_STATUS_WRITE = 'eats.store.status.write'
export const SCOPE_STORE_ORDERS_READ = 'eats.store.orders.read'
export const SCOPE_DELIVERIES = 'eats.deliveries'

// Token type for explicit grant type selection in uberFetch.
//   provisioning      → authorization_code (USL, stored per-store in integration_providers)
//   marketplace       → client_credentials with MARKETPLACE_M2M_SCOPES
//   order-fulfillment → client_credentials with UBER_ORDER_FULFILLMENT_SCOPE
//                       (fail-closed until Uber confirms the scope — blocker A2)
export type UberTokenType = 'provisioning' | 'marketplace' | 'order-fulfillment'

interface CachedToken {
  token: string
  expiresAt: number
}
// Cache key includes the client alias so a config change never serves a stale
// token from the other client.
const tokenCache = new Map<string, CachedToken>()

// Clears the in-memory M2M token cache. Test isolation only.
export function clearTokenCache(): void { tokenCache.clear() }

/** Every requested scope must appear in the granted scope string (space-separated). */
export function grantCoversRequest(requested: string, granted: string | undefined): boolean {
  const grantedSet = new Set((granted ?? '').split(/\s+/).filter(Boolean))
  return requested.split(/\s+/).filter(Boolean).every(s => grantedSet.has(s))
}

export async function getUberAccessToken(scope: string): Promise<string> {
  const identity = resolveUberIdentity()
  const cacheKey = `${identity.clientAlias}:${scope}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const r = await fetch(identity.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: identity.clientId,
      client_secret: identity.clientSecret,
      grant_type: 'client_credentials',
      scope,
    }),
  })
  if (!r.ok) {
    // Body may echo request details — log status only, never the payload.
    throw new Error(`[uber-oauth] token request failed ${r.status} (${describeUberIdentity(identity)}, scope='${scope}')`)
  }

  const data = (await r.json()) as { access_token: string; expires_in: number; scope?: string }
  if (!grantCoversRequest(scope, data.scope)) {
    throw new UberScopeError(scope, data.scope ?? '')
  }
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token
}

// ─── USL (Universal Sign-on Link) — Authorization Code Flow ──────────────────
//
// Flow:
//   1. Merchant clicks "Connect" in Uber Eats Portal or our dashboard
//   2. We redirect to Uber's OAuth page (buildUberAuthUrl)
//   3. After merchant authorizes, Uber redirects to /auth/callback?code=X&state=Y
//   4. We exchange the code for access_token + refresh_token (exchangeUberCode)
//   5. We store tokens in integration_providers (service role, sealed by token-vault)
//   6. We associate the store in integration_store_mappings
//
// State/CSRF: caller generates a random UUID, stores in httpOnly cookie,
// verifies on callback, clears cookie after use.

/** Build the Uber OAuth authorization URL for the USL redirect. */
export function buildUberAuthUrl(state: string, redirectUri: string, scopes = USL_SCOPES): string {
  const identity = resolveUberIdentity()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: identity.clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(' '),
  })
  return `${identity.authorizeUrl}?${params.toString()}`
}

export interface UberTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

function basicAuthHeader(identity: UberIdentity): string {
  return `Basic ${Buffer.from(`${identity.clientId}:${identity.clientSecret}`).toString('base64')}`
}

/** Exchange an authorization code for access + refresh tokens (USL callback). */
export async function exchangeUberCode(code: string, redirectUri: string): Promise<UberTokenResponse> {
  const identity = resolveUberIdentity()
  const r = await fetch(identity.loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(identity),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  })
  if (!r.ok) {
    throw new Error(`[uber-usl] code exchange failed ${r.status} (${describeUberIdentity(identity)})`)
  }
  return r.json() as Promise<UberTokenResponse>
}

/** Exchange a refresh_token for a new access_token. */
export async function refreshUberToken(refreshToken: string): Promise<UberTokenResponse> {
  const identity = resolveUberIdentity()
  const r = await fetch(identity.loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(identity),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!r.ok) throw new Error(`[uber-usl] refresh failed ${r.status} (${describeUberIdentity(identity)})`)
  return r.json() as Promise<UberTokenResponse>
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the stored access_token for a given Uber store from integration_providers.
 * Uses the authorization_code token granted during USL — required for merchant-level
 * provisioning operations. Tokens are opened via token-vault (transparent for
 * legacy plaintext rows). If expired and a refresh_token exists, refreshes and
 * persists the new sealed tokens automatically.
 */
export async function getStoredTokenForStore(storeId: string): Promise<string> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('[uber-oauth] SUPABASE_SERVICE_KEY not configured')

  const r = await fetch(
    `${sbUrl}/rest/v1/integration_providers?provider=eq.ubereats&provider_account_id=eq.${encodeURIComponent(storeId)}&select=client_id,access_token_enc,token_expires_at,refresh_token_enc&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  )
  if (!r.ok) throw new Error(`[uber-oauth] DB lookup failed ${r.status}`)

  const rows = (await r.json()) as Array<{
    client_id: string
    access_token_enc: string
    token_expires_at: string
    refresh_token_enc?: string
  }>
  if (!rows.length) throw new Error(`[uber-oauth] no stored token for store ${storeId} — run USL first`)

  const row = rows[0]
  const expiresAt = new Date(row.token_expires_at).getTime()

  if (expiresAt > Date.now() + 60_000) return openToken(row.access_token_enc)

  if (!row.refresh_token_enc) throw new Error(`[uber-oauth] token expired and no refresh_token for store ${storeId} — re-run USL`)
  const tokens = await refreshUberToken(openToken(row.refresh_token_enc))

  const patch: Record<string, string> = {
    access_token_enc: sealToken(tokens.access_token),
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }
  // Uber may rotate the refresh token — persist the new one when present.
  if (tokens.refresh_token) patch.refresh_token_enc = sealToken(tokens.refresh_token)

  await fetch(
    `${sbUrl}/rest/v1/integration_providers?provider=eq.ubereats&provider_account_id=eq.${encodeURIComponent(storeId)}`,
    {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    }
  )
  return tokens.access_token
}

/** Probe whether the Uber app has a given M2M scope approved.
 *  Returns the scope Uber actually granted (may be narrower than requested). */
export async function probeM2MToken(scope: string): Promise<{ ok: boolean; granted_scope?: string; error?: string }> {
  let identity: UberIdentity
  try {
    identity = resolveUberIdentity()
  } catch (e) {
    return { ok: false, error: String(e) }
  }
  try {
    const r = await fetch(identity.loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: identity.clientId, client_secret: identity.clientSecret, grant_type: 'client_credentials', scope }),
    })
    const data = (await r.json()) as { access_token?: string; scope?: string; error?: string; error_description?: string }
    if (!r.ok) return { ok: false, error: data.error_description ?? data.error ?? `HTTP ${r.status}` }
    return { ok: true, granted_scope: data.scope }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Authenticated fetch to Uber API.
 *  tokenType drives which token is used — do NOT mix grant types:
 *    provisioning      → USL authorization_code (requires storeId for DB lookup)
 *    marketplace       → client_credentials, MARKETPLACE_M2M_SCOPES
 *    order-fulfillment → client_credentials, UBER_ORDER_FULFILLMENT_SCOPE (fail-closed, A2)
 *  opts.scope narrows the client_credentials request to exactly that scope
 *  (audit BUG fixed: previous version silently discarded this parameter). */
export async function uberFetch(
  path: string,
  opts: RequestInit & { tokenType?: UberTokenType; storeId?: string; scope?: string } = {}
): Promise<Response> {
  const { tokenType = 'marketplace', storeId, scope, ...rest } = opts
  let token: string
  if (tokenType === 'provisioning') {
    if (!storeId) throw new Error('[uber-fetch] storeId required for provisioning token (USL)')
    token = await getStoredTokenForStore(storeId)
  } else if (tokenType === 'order-fulfillment') {
    token = await getUberAccessToken(scope ?? getOrderFulfillmentScope())
  } else {
    token = await getUberAccessToken(scope ?? MARKETPLACE_M2M_SCOPES.join(' '))
  }
  return fetch(`${getApiBase()}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(rest.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  })
}
