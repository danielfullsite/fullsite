// Uber Eats — Environment & client identity resolution.
//
// Contract: Fullsite operates two distinct Uber applications and they must
// never cross environments:
//
//   UBER_ENV=sandbox     → Test Client     (UBER_TEST_CLIENT_ID / UBER_TEST_CLIENT_SECRET)
//                          auth  → sandbox-login.uber.com   API → test-api.uber.com
//   UBER_ENV=production  → Production Client (UBER_PROD_CLIENT_ID / UBER_PROD_CLIENT_SECRET)
//                          auth  → auth.uber.com            API → api.uber.com
//
// Fail-closed rules (every violation throws UberConfigError):
//   - UBER_ENV missing or not exactly 'sandbox' | 'production'
//   - The credential pair for the active environment is missing
//   - Test and Production client IDs are identical (misconfigured copy/paste)
//   - production NEVER falls back to legacy UBER_CLIENT_ID — only the explicit
//     UBER_PROD_* pair is accepted, so a test client can never serve production.
//
// Legacy compatibility: UBER_CLIENT_ID / UBER_CLIENT_SECRET are accepted ONLY
// when UBER_ENV=sandbox and the UBER_TEST_* pair is absent. This keeps the
// current Vercel sandbox configuration working until the new vars are set,
// and is reported as clientAlias='legacy-as-test' so logs make it visible.
//
// Logging: NEVER log client IDs or secrets. Log only env + clientAlias.

export type UberEnv = 'sandbox' | 'production'
export type UberClientAlias = 'test-client' | 'prod-client' | 'legacy-as-test'

export class UberConfigError extends Error {
  constructor(message: string) {
    super(`[uber-config] ${message}`)
    this.name = 'UberConfigError'
  }
}

export interface UberIdentity {
  env: UberEnv
  clientAlias: UberClientAlias
  clientId: string
  clientSecret: string
  loginUrl: string
  authorizeUrl: string
  apiBase: string
}

export function resolveUberEnv(): UberEnv {
  const env = (process.env.UBER_ENV ?? '').trim()
  if (env !== 'sandbox' && env !== 'production') {
    throw new UberConfigError(
      `UBER_ENV must be exactly 'sandbox' or 'production' (got: '${env || 'unset'}')`
    )
  }
  return env
}

export interface UberDomains {
  loginUrl: string
  authorizeUrl: string
  apiBase: string
}

/** Domains depend only on the environment — never on credentials. */
export function uberDomains(env: UberEnv): UberDomains {
  return env === 'production'
    ? {
        loginUrl: 'https://auth.uber.com/oauth/v2/token',
        authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize',
        apiBase: 'https://api.uber.com',
      }
    : {
        loginUrl: 'https://sandbox-login.uber.com/oauth/v2/token',
        authorizeUrl: 'https://sandbox-login.uber.com/oauth/v2/authorize',
        apiBase: 'https://test-api.uber.com',
      }
}

function readPair(idVar: string, secretVar: string): { id: string; secret: string } | null {
  const id = (process.env[idVar] ?? '').trim()
  const secret = (process.env[secretVar] ?? '').trim()
  if (!id && !secret) return null
  if (!id || !secret) {
    throw new UberConfigError(`${idVar} and ${secretVar} must be set together (one is missing)`)
  }
  return { id, secret }
}

/**
 * Resolve the full Uber identity for the active environment.
 * This is the ONLY place client credentials are read — all other modules
 * must go through this function so environment/client cross-use is
 * structurally impossible.
 */
export function resolveUberIdentity(): UberIdentity {
  const env = resolveUberEnv()

  const testPair = readPair('UBER_TEST_CLIENT_ID', 'UBER_TEST_CLIENT_SECRET')
  const prodPair = readPair('UBER_PROD_CLIENT_ID', 'UBER_PROD_CLIENT_SECRET')

  if (testPair && prodPair && testPair.id === prodPair.id) {
    throw new UberConfigError(
      'UBER_TEST_CLIENT_ID and UBER_PROD_CLIENT_ID are identical — test and production must be distinct Uber applications'
    )
  }

  const domains = uberDomains(env)

  if (env === 'production') {
    if (!prodPair) {
      throw new UberConfigError(
        'UBER_ENV=production requires UBER_PROD_CLIENT_ID / UBER_PROD_CLIENT_SECRET — legacy UBER_CLIENT_ID is not accepted in production'
      )
    }
    return { env, clientAlias: 'prod-client', clientId: prodPair.id, clientSecret: prodPair.secret, ...domains }
  }

  // sandbox
  if (testPair) {
    return { env, clientAlias: 'test-client', clientId: testPair.id, clientSecret: testPair.secret, ...domains }
  }

  const legacyPair = readPair('UBER_CLIENT_ID', 'UBER_CLIENT_SECRET')
  if (legacyPair) {
    if (prodPair && legacyPair.id === prodPair.id) {
      throw new UberConfigError(
        'Legacy UBER_CLIENT_ID matches UBER_PROD_CLIENT_ID — refusing to use the production client in sandbox'
      )
    }
    console.warn('[uber-config] env=sandbox client=legacy-as-test — set UBER_TEST_CLIENT_ID/SECRET to remove this fallback')
    return { env, clientAlias: 'legacy-as-test', clientId: legacyPair.id, clientSecret: legacyPair.secret, ...domains }
  }

  throw new UberConfigError(
    'UBER_ENV=sandbox requires UBER_TEST_CLIENT_ID / UBER_TEST_CLIENT_SECRET (or legacy UBER_CLIENT_ID / UBER_CLIENT_SECRET)'
  )
}

/** Safe one-line description for logs — never contains IDs or secrets. */
export function describeUberIdentity(id: UberIdentity): string {
  return `env=${id.env} client=${id.clientAlias}`
}
