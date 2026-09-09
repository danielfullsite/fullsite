import { createHash, randomBytes } from 'node:crypto'
import { assertRappiConfigured, rappiEnv, rappiPublicApiBaseUrl, RappiConfigError, RappiHttpError } from './auth'

// Rappi self-onboarding (dev-portal.rappi.com → Self-Onboarding). Two-token model:
//   - Integrator token (M2M, our client_id/secret) → header X-Authorization
//   - Merchant token   (OAuth2 Authorization Code + PKCE on Portal Partners, id_token)
//     → header Authorization-Partners
// The merchant public client (RAPPI_SELF_CLIENT_ID) requires NO secret. The redirect_uri
// must be pre-whitelisted by Rappi's integrations team (done for our callback URL).

const PUBLIC_API_PREFIX = '/api/v2/restaurants-integrations-public-api'
const DEFAULT_REDIRECT_URI = 'https://app.fullsite.mx/api/integrations/rappi/onboarding/callback'
const OAUTH_SCOPE = 'openid profile email'

export function rappiPartnersBaseUrl(): string {
  const override = process.env.RAPPI_PARTNERS_AUTH_BASE_URL?.trim()
  if (override) return override.replace(/\/+$/, '')
  return rappiEnv() === 'prod'
    ? 'https://login.partners.rappi.com'
    : 'https://login.partners.dev.rappi.com'
}

export function rappiSelfClientId(): string | null {
  return process.env.RAPPI_SELF_CLIENT_ID?.trim() || null
}

export function rappiOnboardingRedirectUri(): string {
  return process.env.RAPPI_ONBOARDING_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI
}

// ─── PKCE ────────────────────────────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generatePkce(): { verifier: string; challenge: string } {
  // 32 random bytes → 43-char base64url verifier (within the 43–128 spec range).
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function randomState(): string {
  return base64url(randomBytes(16))
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const clientId = rappiSelfClientId()
  if (!clientId) throw new RappiConfigError('RAPPI_SELF_CLIENT_ID_REQUIRED', 'Rappi self-onboarding client id is not configured')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: rappiOnboardingRedirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${rappiPartnersBaseUrl()}/authorize?${params.toString()}`
}

// ─── Merchant token (Step 4: exchange code → id_token) ────────────────────────
export async function exchangeMerchantCode(code: string, codeVerifier: string): Promise<string> {
  const clientId = rappiSelfClientId()
  if (!clientId) throw new RappiConfigError('RAPPI_SELF_CLIENT_ID_REQUIRED', 'Rappi self-onboarding client id is not configured')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: rappiOnboardingRedirectUri(),
  })
  const res = await fetch(`${rappiPartnersBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new RappiHttpError(res.status, { error: payload.error ?? payload.message ?? 'RAPPI_MERCHANT_TOKEN_FAILED' })
  // Use id_token (signed JWT, 2 dots), NOT access_token (opaque JWE → 401 on the API).
  const idToken = payload.id_token
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new RappiConfigError('RAPPI_MERCHANT_ID_TOKEN_MISSING', 'Merchant token response did not include a valid id_token')
  }
  return idToken
}

// ─── Integrator token (M2M) from the public-api country domain ────────────────
export async function getIntegratorPublicApiToken(): Promise<string> {
  const { clientId, clientSecret } = assertRappiConfigured()
  const res = await fetch(`${rappiPublicApiBaseUrl()}/restaurants/auth/v1/token/login/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: 'no-store',
  })
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new RappiHttpError(res.status, { error: payload.error ?? payload.message ?? 'RAPPI_INTEGRATOR_TOKEN_FAILED' })
  const token = payload.access_token ?? payload.accessToken ?? payload.token
  if (typeof token !== 'string' || !token) {
    throw new RappiConfigError('RAPPI_INTEGRATOR_TOKEN_MISSING', 'Integrator token response did not include an access_token')
  }
  return token
}

function selfOnboardHeaders(integratorToken: string, merchantIdToken: string): Record<string, string> {
  return {
    'X-Authorization': `Bearer ${integratorToken}`,
    'Authorization-Partners': `Bearer ${merchantIdToken}`,
  }
}

// ─── Step 2: retrieve which of the merchant's stores are already integrated ────
export type IntegrationStatusStore = {
  store_id: string
  name?: string
  brand?: string
  integrated?: boolean
  integration_id?: string
  children?: IntegrationStatusStore[]
}

export async function fetchIntegrationStatus(integratorToken: string, merchantIdToken: string): Promise<{ status: number; stores: IntegrationStatusStore[]; raw: unknown }> {
  const res = await fetch(`${rappiPublicApiBaseUrl()}${PUBLIC_API_PREFIX}/stores/integration-status`, {
    method: 'GET',
    headers: selfOnboardHeaders(integratorToken, merchantIdToken),
    cache: 'no-store',
  })
  const raw = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new RappiHttpError(res.status, raw)
  const stores = Array.isArray(raw.stores) ? raw.stores as IntegrationStatusStore[] : []
  return { status: res.status, stores, raw }
}

// Flatten parents + children into the stores that still need provisioning.
export function collectUnintegrated(stores: IntegrationStatusStore[]): { store_id: string; name: string }[] {
  const out: { store_id: string; name: string }[] = []
  const walk = (s: IntegrationStatusStore): void => {
    if (s && s.integrated === false && s.store_id) {
      out.push({ store_id: String(s.store_id), name: s.name || `Store ${s.store_id}` })
    }
    if (Array.isArray(s?.children)) s.children.forEach(walk)
  }
  stores.forEach(walk)
  return out
}

// ─── Step 3: provision stores (async → 202 + batch_id; result via webhook) ─────
export type ProvisionStoreInput = { store_id: string; name: string; status?: 'ACTIVE' | 'INACTIVE'; store_integration_id?: string }

export async function provisionStores(
  integratorToken: string,
  merchantIdToken: string,
  stores: ProvisionStoreInput[],
): Promise<{ status: number; raw: unknown }> {
  const body = {
    stores: stores.slice(0, 20).map(s => ({
      store_id: s.store_id,
      name: s.name,
      status: s.status || 'ACTIVE',
      ...(s.store_integration_id ? { store_integration_id: s.store_integration_id } : {}),
      // POS integration: we need order pings and cancellation events; we push menus
      // ourselves so get_menu stays off.
      ping_active: true,
      cancellation_events: true,
      get_menu_active: false,
    })),
  }
  const res = await fetch(`${rappiPublicApiBaseUrl()}${PUBLIC_API_PREFIX}/stores/provisioning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfOnboardHeaders(integratorToken, merchantIdToken) },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const raw = await res.json().catch(() => ({})) as unknown
  return { status: res.status, raw }
}
