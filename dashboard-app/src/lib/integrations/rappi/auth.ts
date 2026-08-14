type RappiEnv = 'dev' | 'prod'

export class RappiConfigError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'RappiConfigError'
  }
}

export class RappiHttpError extends Error {
  constructor(public status: number, public payload: unknown) {
    super(`Rappi HTTP ${status}`)
    this.name = 'RappiHttpError'
  }
}

type TokenCache = {
  token: string
  expiresAtMs: number
}

let tokenCache: TokenCache | null = null

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function rappiEnv(): RappiEnv {
  const raw = (process.env.RAPPI_ENV || 'dev').toLowerCase()
  return raw === 'prod' || raw === 'production' ? 'prod' : 'dev'
}

export function rappiBaseUrl(): string {
  const override = process.env.RAPPI_API_BASE_URL?.trim()
  if (override) return trimSlash(override)
  return rappiEnv() === 'prod'
    ? 'https://services.mxgrability.rappi.com'
    : 'https://api.dev.rappi.com'
}

export function rappiOrdersBasePath(): string {
  return '/restaurants/orders/v1'
}

export function rappiStoreId(): string | null {
  const value = (process.env.RAPPI_STORE_ID || process.env.RAPPI_DEV_STORE_ID || '').trim()
  return value || null
}

export function rappiConfigStatus() {
  return {
    env: rappiEnv(),
    base_url: rappiBaseUrl(),
    client_id_configured: Boolean(process.env.RAPPI_CLIENT_ID?.trim()),
    client_secret_configured: Boolean(process.env.RAPPI_CLIENT_SECRET?.trim()),
    store_id_configured: Boolean(rappiStoreId()),
  }
}

export function assertRappiConfigured(options?: { requireStoreId?: boolean }) {
  const clientId = process.env.RAPPI_CLIENT_ID?.trim()
  const clientSecret = process.env.RAPPI_CLIENT_SECRET?.trim()
  if (!clientId) throw new RappiConfigError('RAPPI_CLIENT_ID_REQUIRED', 'Rappi client id is not configured')
  if (!clientSecret) throw new RappiConfigError('RAPPI_CLIENT_SECRET_REQUIRED', 'Rappi client secret is not configured')
  if (options?.requireStoreId && !rappiStoreId()) {
    throw new RappiConfigError('RAPPI_STORE_ID_REQUIRED', 'Rappi store id is not configured')
  }
  return { clientId, clientSecret, storeId: rappiStoreId() }
}

function tokenFromPayload(payload: Record<string, unknown>): string | null {
  const candidates = [payload.access_token, payload.accessToken, payload.token, payload.id_token]
  const token = candidates.find(v => typeof v === 'string' && v.length > 0)
  return typeof token === 'string' ? token : null
}

function ttlFromPayload(payload: Record<string, unknown>): number {
  const raw = payload.expires_in ?? payload.expiresIn ?? payload.expires
  const ttl = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(ttl) && ttl > 0) return Math.min(ttl, 23 * 60 * 60)
  return 23 * 60 * 60
}

export function clearRappiTokenCacheForTests() {
  tokenCache = null
}

export async function getRappiAccessToken(): Promise<string> {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAtMs - now > 60_000) return tokenCache.token

  const { clientId, clientSecret } = assertRappiConfigured()
  const res = await fetch(`${rappiBaseUrl()}/restaurants/auth/v1/token/login/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: 'no-store',
  })

  const payload = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new RappiHttpError(res.status, { error: payload.error ?? payload.message ?? 'RAPPI_AUTH_FAILED' })

  const token = tokenFromPayload(payload)
  if (!token) throw new RappiConfigError('RAPPI_TOKEN_MISSING', 'Rappi auth response did not include a token')

  tokenCache = {
    token,
    expiresAtMs: now + ttlFromPayload(payload) * 1000,
  }
  return token
}

export async function buildRappiAuthHeaders(): Promise<Record<string, string>> {
  const token = await getRappiAccessToken()
  return { 'x-authorization': `Bearer: ${token}` }
}

export async function rappiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const authHeaders = await buildRappiAuthHeaders()
  for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const url = path.startsWith('http') ? path : `${rappiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  return fetch(url, { ...init, headers, cache: 'no-store' })
}
