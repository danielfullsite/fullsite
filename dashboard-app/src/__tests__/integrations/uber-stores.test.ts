// Tests for GET /api/integrations/uber-eats/stores
// Covers: auth guards (INTEGRATION_ADMIN_SECRET + normalization), sandbox guard,
// credential guards, response shape, count:0, and Uber API error handling.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/integrations/uber-eats/stores/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/integrations/uber-eats/oauth', () => ({
  uberFetch: vi.fn(),
}))
vi.mock('@/lib/integrations/audit-logger', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

import { uberFetch } from '@/lib/integrations/uber-eats/oauth'
import { auditLog } from '@/lib/integrations/audit-logger'

const ADMIN_SECRET = 'test-integration-admin-secret-xyz789abcdef1234567890'

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/stores', { headers })
}

function uberOk(stores: unknown[]): Response {
  return new Response(JSON.stringify({ stores }), { status: 200 })
}

function uberError(status: number, body = ''): Response {
  return new Response(body, { status })
}

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    SUPABASE_SERVICE_KEY: 'test-service-role-key',
    INTEGRATION_ADMIN_SECRET: ADMIN_SECRET,
    UBER_ENV: 'sandbox',
    UBER_CLIENT_ID: 'test-client-id',
    UBER_CLIENT_SECRET: 'test-client-secret',
  }
  const allKeys = new Set([...Object.keys(base), ...Object.keys(overrides)])
  for (const key of allKeys) delete process.env[key]
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== undefined) process.env[k] = v
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setEnv()
})

describe('GET /api/integrations/uber-eats/stores — auth header parsing', () => {
  it('returns 200 with correct Bearer token', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
  })

  it('accepts bearer (lowercase) prefix — case-insensitive', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
  })

  it('accepts BEARER (uppercase) prefix', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`BEARER ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
  })

  it('accepts token with trailing space (trimmed)', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET} `))
    expect(res.status).toBe(200)
  })

  it('accepts token with trailing newline (trimmed)', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}\n`))
    expect(res.status).toBe(200)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  it('returns 401 with wrong token', async () => {
    const res = await GET(makeRequest('Bearer wrong-token-value'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when not using Bearer scheme', async () => {
    const res = await GET(makeRequest('Basic dXNlcjpwYXNz'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when SUPABASE_SERVICE_KEY is provided instead of INTEGRATION_ADMIN_SECRET', async () => {
    // Confirms the two secrets are not interchangeable
    const res = await GET(makeRequest('Bearer test-service-role-key'))
    expect(res.status).toBe(401)
  })

  it('accepts env secret with trailing whitespace (trimmed from env)', async () => {
    // Simulates Vercel env var saved with trailing newline
    setEnv({ INTEGRATION_ADMIN_SECRET: `${ADMIN_SECRET}\n` })
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/integrations/uber-eats/stores — credential guards', () => {
  it('returns 503 when SUPABASE_SERVICE_KEY is not configured', async () => {
    setEnv({ SUPABASE_SERVICE_KEY: undefined })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('not_configured')
  })

  it('returns 503 when INTEGRATION_ADMIN_SECRET is not configured', async () => {
    setEnv({ INTEGRATION_ADMIN_SECRET: undefined })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('not_configured')
  })

  it('returns 503 when UBER_CLIENT_ID is missing', async () => {
    setEnv({ UBER_CLIENT_ID: undefined })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('uber_credentials_missing')
  })

  it('returns 503 when UBER_CLIENT_SECRET is missing', async () => {
    setEnv({ UBER_CLIENT_SECRET: undefined })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('uber_credentials_missing')
  })
})

describe('GET /api/integrations/uber-eats/stores — sandbox guard', () => {
  it('returns 403 when UBER_ENV is production', async () => {
    setEnv({ UBER_ENV: 'production' })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('sandbox_only')
    expect(body.env).toBe('production')
  })

  it('returns 403 when UBER_ENV is unset', async () => {
    setEnv({ UBER_ENV: undefined })
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('sandbox_only')
  })
})

describe('GET /api/integrations/uber-eats/stores — response shape', () => {
  it('returns only store_id and name — strips all other Uber fields', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([
      {
        store_id: 'store-uuid-001',
        name: 'AMALAY Test Store',
        status: 'active',
        contact_emails: ['owner@amalay.com'],
        pos_data: { secret: 'hidden' },
        location: { address: '123 Main St' },
      },
    ]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.env).toBe('sandbox')
    expect(body.count).toBe(1)
    expect(body.stores[0].store_id).toBe('store-uuid-001')
    expect(body.stores[0].name).toBe('AMALAY Test Store')
    expect(body.stores[0].status).toBeUndefined()
    expect(body.stores[0].contact_emails).toBeUndefined()
    expect(body.stores[0].pos_data).toBeUndefined()
    expect(body.stores[0].location).toBeUndefined()
    expect(body.correlation_id).toBeDefined()
  })

  it('returns count:0 and empty array when Uber returns no stores', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(0)
    expect(body.stores).toEqual([])
  })

  it('returns count:0 when Uber response has no stores field', async () => {
    vi.mocked(uberFetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    )
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(0)
  })

  it('calls auditLog with count and env on success', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([{ store_id: 's1', name: 'Store 1' }]))
    await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'uber.stores.list',
      response: expect.objectContaining({ count: 1, env: 'sandbox' }),
    }))
  })
})

describe('GET /api/integrations/uber-eats/stores — Uber API errors', () => {
  it('returns 502 when Uber API returns 401', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberError(401, 'unauthorized'))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('uber_api_error')
    expect(body.uber_status).toBe(401)
  })

  it('returns 502 when Uber API returns 403', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberError(403, 'forbidden'))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(502)
    expect((await res.json()).uber_status).toBe(403)
  })

  it('returns 500 when uberFetch throws — detail not leaked to client', async () => {
    vi.mocked(uberFetch).mockRejectedValue(new Error('network failure'))
    const res = await GET(makeRequest(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain('network failure')
    expect(body.correlation_id).toBeDefined()
  })
})
