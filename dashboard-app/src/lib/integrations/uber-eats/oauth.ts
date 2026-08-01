// Uber Eats OAuth — client_credentials (M2M) + authorization code (USL) flows.
// M2M tokens are cached in memory per scope until 60s before expiry.
// USL tokens are stored in integration_providers via service role.
//
// Domain mapping (Uber official docs):
//   Sandbox:    auth  → sandbox-login.uber.com   API → test-api.uber.com
//   Production: auth  → auth.uber.com             API → api.uber.com
// Mixing auth domain with API domain causes 401 from Uber.

const isProduction = (): boolean => process.env.UBER_ENV === 'production'

// Exported for testing — guarantees domain isolation between environments
export const getLoginUrl = (): string =>
  isProduction()
    ? 'https://auth.uber.com/oauth/v2/token'
    : 'https://sandbox-login.uber.com/oauth/v2/token'

export const getAuthorizeUrl = (): string =>
  isProduction()
    ? 'https://auth.uber.com/oauth/v2/authorize'
    : 'https://sandbox-login.uber.com/oauth/v2/authorize'

export const getApiBase = (): string =>
  isProduction()
    ? 'https://api.uber.com'
    : 'https://test-api.uber.com'

// eats.pos_provisioning is the single approved scope for Eats Marketplace POS apps.
// It covers order management, store management, and menu operations.
export const USL_SCOPES = ['eats.pos_provisioning']

interface CachedToken {
  token: string
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

export async function getUberAccessToken(scope = 'eats.pos_provisioning'): Promise<string> {
  const cached = tokenCache.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const clientId = process.env.UBER_CLIENT_ID || process.env.UBER_SANDBOX_CLIENT_ID || ''
  const clientSecret = process.env.UBER_CLIENT_SECRET || process.env.UBER_SANDBOX_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) {
    throw new Error('[uber-oauth] UBER_CLIENT_ID/UBER_CLIENT_SECRET not configured')
  }

  const r = await fetch(getLoginUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope }),
  })
  if (!r.ok) throw new Error(`[uber-oauth] token request failed ${r.status}: ${await r.text()}`)

  const data = (await r.json()) as { access_token: string; expires_in: number; scope?: string }
  tokenCache.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token
}

// ─── USL (Universal Sign-on Link) — Authorization Code Flow ──────────────────
//
// Flow:
//   1. Merchant clicks "Connect" in Uber Eats Portal or our dashboard
//   2. We redirect to Uber's OAuth page (buildUberAuthUrl)
//   3. After merchant authorizes, Uber redirects to /auth/callback?code=X&state=Y
//   4. We exchange the code for access_token + refresh_token (exchangeUberCode)
//   5. We store tokens in integration_providers (service role)
//   6. We associate the store in integration_store_mappings
//
// State/CSRF: caller generates a random UUID, stores in httpOnly cookie,
// verifies on callback, clears cookie after use.

function clientCredentials() {
  const clientId = process.env.UBER_CLIENT_ID || process.env.UBER_SANDBOX_CLIENT_ID || ''
  const clientSecret = process.env.UBER_CLIENT_SECRET || process.env.UBER_SANDBOX_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) throw new Error('[uber-usl] UBER_CLIENT_ID/UBER_CLIENT_SECRET not configured')
  return { clientId, clientSecret }
}

/** Build the Uber OAuth authorization URL for the USL redirect. */
export function buildUberAuthUrl(state: string, redirectUri: string, scopes = USL_SCOPES): string {
  const { clientId } = clientCredentials()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(' '),
  })
  return `${getAuthorizeUrl()}?${params.toString()}`
}

export interface UberTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  token_type: string
}

/** Exchange an authorization code for access + refresh tokens (USL callback). */
export async function exchangeUberCode(code: string, redirectUri: string): Promise<UberTokenResponse> {
  const { clientId, clientSecret } = clientCredentials()
  const r = await fetch(getLoginUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`[uber-usl] code exchange failed ${r.status}: ${err}`)
  }
  return r.json() as Promise<UberTokenResponse>
}

/** Exchange a refresh_token for a new access_token. */
export async function refreshUberToken(refreshToken: string): Promise<UberTokenResponse> {
  const { clientId, clientSecret } = clientCredentials()
  const r = await fetch(getLoginUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!r.ok) throw new Error(`[uber-usl] refresh failed ${r.status}: ${await r.text()}`)
  return r.json() as Promise<UberTokenResponse>
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the stored access_token for a given Uber store from integration_providers.
 * Uses the authorization_code token granted during USL — required for all merchant-level
 * operations (menu, orders, store status). eats.pos_provisioning is NOT a valid
 * client_credentials scope; only the merchant's own token carries those permissions.
 * If the token is expired and refresh_token_enc is present, refreshes automatically.
 */
export async function getStoredTokenForStore(storeId: string): Promise<string> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('[uber-oauth] SUPABASE_SERVICE_KEY not configured')

  const r = await fetch(
    `${sbUrl}/rest/v1/integration_providers?provider=eq.ubereats&provider_account_id=eq.${encodeURIComponent(storeId)}&select=client_id,access_token_enc,token_expires_at,refresh_token_enc&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  )
  if (!r.ok) throw new Error(`[uber-oauth] DB lookup failed ${r.status}: ${await r.text()}`)

  const rows = (await r.json()) as Array<{
    client_id: string
    access_token_enc: string
    token_expires_at: string
    refresh_token_enc?: string
  }>
  if (!rows.length) throw new Error(`[uber-oauth] no stored token for store ${storeId} — run USL first`)

  const row = rows[0]
  const expiresAt = new Date(row.token_expires_at).getTime()

  if (expiresAt > Date.now() + 60_000) return row.access_token_enc

  if (!row.refresh_token_enc) throw new Error(`[uber-oauth] token expired and no refresh_token for store ${storeId}`)
  const tokens = await refreshUberToken(row.refresh_token_enc)

  await fetch(
    `${sbUrl}/rest/v1/integration_providers?provider=eq.ubereats&provider_account_id=eq.${encodeURIComponent(storeId)}`,
    {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token_enc: tokens.access_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }
  )
  return tokens.access_token
}

/** Authenticated fetch to Uber API.
 *  Pass `storeId` for merchant-level operations (menu, orders, store status) —
 *  uses the stored authorization_code token from integration_providers.
 *  Omit `storeId` only for app-level M2M calls that don't require merchant scope. */
export async function uberFetch(
  path: string,
  opts: RequestInit & { scope?: string; storeId?: string } = {}
): Promise<Response> {
  const { scope: _scope, storeId, ...rest } = opts
  const token = storeId
    ? await getStoredTokenForStore(storeId)
    : await getUberAccessToken(_scope ?? 'eats.pos_provisioning')
  return fetch(`${getApiBase()}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(rest.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  })
}
