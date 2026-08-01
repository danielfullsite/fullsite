// Uber Eats OAuth — client_credentials token management with in-process cache.
// Tokens are cached in memory per scope until 60s before expiry.

const isProduction = (): boolean => process.env.UBER_ENV === 'production'

const loginUrl = (): string =>
  isProduction()
    ? 'https://login.uber.com/oauth/v2/token'
    : 'https://sandbox-login.uber.com/oauth/v2/token'

const API_BASE = 'https://api.uber.com'

interface CachedToken {
  token: string
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

export async function getUberAccessToken(scope = 'eats.order'): Promise<string> {
  const cached = tokenCache.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const clientId = process.env.UBER_CLIENT_ID || process.env.UBER_SANDBOX_CLIENT_ID || ''
  const clientSecret = process.env.UBER_CLIENT_SECRET || process.env.UBER_SANDBOX_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) {
    throw new Error('[uber-oauth] UBER_CLIENT_ID/UBER_CLIENT_SECRET not configured')
  }

  const r = await fetch(loginUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope }),
  })
  if (!r.ok) throw new Error(`[uber-oauth] ${r.status}: ${await r.text()}`)

  const data = (await r.json()) as { access_token: string; expires_in: number }
  tokenCache.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token
}

/** Authenticated fetch to Uber API — always uses Bearer token for the given scope. */
export async function uberFetch(
  path: string,
  opts: RequestInit & { scope?: string } = {}
): Promise<Response> {
  const scope = opts.scope ?? 'eats.order'
  const token = await getUberAccessToken(scope)
  const { scope: _scope, ...rest } = opts
  return fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(rest.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  })
}
