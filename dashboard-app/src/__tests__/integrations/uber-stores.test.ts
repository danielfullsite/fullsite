// Tests for GET /api/integrations/uber-eats/stores
// Covers: auth guards, sandbox guard, credential guards, response shape,
// count:0, and Uber API error handling.

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

const VALID_KEY = 'test-service-role-key-abc123'

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
    SUPABASE_SERVICE_KEY: VALID_KEY,
    UBER_ENV: 'sandbox',
    UBER_CLIENT_ID: 'test-client-id',
    UBER_CLIENT_SECRET: 'test-client-secret',
  }
  for (const key of Object.keys(process.env)) {
    if (key in base || key in overrides) delete process.env[key]
  }
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== undefined) process.env[k] = v
    else delete process.env[k]
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setEnv()
})

describe('GET /api/integrations/uber-eats/stores — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
    expect(body.correlation_id).toBeDefined()
  })

  it('returns 401 when Authorization header has wrong token', async () => {
    const res = await GET(makeRequest('Bearer wrong-key'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization is not Bearer scheme', async () => {
    const res = await GET(makeRequest('Basic dXNlcjpwYXNz'))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/integrations/uber-eats/stores — credential guards', () => {
  it('returns 503 when SUPABASE_SERVICE_KEY is not configured', async () => {
    setEnv({ SUPABASE_SERVICE_KEY: undefined })
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('not_configured')
  })

  it('returns 503 when UBER_CLIENT_ID is missing', async () => {
    setEnv({ UBER_CLIENT_ID: undefined })
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('uber_credentials_missing')
  })

  it('returns 503 when UBER_CLIENT_SECRET is missing', async () => {
    setEnv({ UBER_CLIENT_SECRET: undefined })
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('uber_credentials_missing')
  })
})

describe('GET /api/integrations/uber-eats/stores — sandbox guard', () => {
  it('returns 403 when UBER_ENV is not sandbox', async () => {
    setEnv({ UBER_ENV: 'production' })
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('sandbox_only')
    expect(body.env).toBe('production')
  })

  it('returns 403 when UBER_ENV is unset', async () => {
    setEnv({ UBER_ENV: undefined })
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('sandbox_only')
  })
})

describe('GET /api/integrations/uber-eats/stores — success', () => {
  it('returns store_id and name only — no POS data, no credentials', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([
      { store_id: 'store-uuid-001', name: 'AMALAY Test', status: 'active',
        contact_emails: ['owner@amalay.com'], pos_data: { secret: 'hidden' } },
    ]))
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.env).toBe('sandbox')
    expect(body.count).toBe(1)
    expect(body.stores[0].store_id).toBe('store-uuid-001')
    expect(body.stores[0].name).toBe('AMALAY Test')
    // Sensitive fields must not be present
    expect(body.stores[0].contact_emails).toBeUndefined()
    expect(body.stores[0].pos_data).toBeUndefined()
    expect(body.stores[0].status).toBeUndefined()
    expect(body.correlation_id).toBeDefined()
  })

  it('returns count:0 and empty stores array when Uber returns no stores', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([]))
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(0)
    expect(body.stores).toEqual([])
  })

  it('returns count:0 when Uber response has no stores field', async () => {
    vi.mocked(uberFetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    )
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(0)
  })

  it('calls auditLog with count and env on success', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberOk([{ store_id: 's1', name: 'Store 1' }]))
    await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'uber.stores.list',
      response: expect.objectContaining({ count: 1, env: 'sandbox' }),
    }))
  })
})

describe('GET /api/integrations/uber-eats/stores — Uber API errors', () => {
  it('returns 502 when Uber API returns 401', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberError(401, 'unauthorized'))
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('uber_api_error')
    expect(body.uber_status).toBe(401)
    expect(body.correlation_id).toBeDefined()
  })

  it('returns 502 when Uber API returns 403', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberError(403, 'forbidden'))
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(502)
    expect((await res.json()).uber_status).toBe(403)
  })

  it('returns 500 when uberFetch throws', async () => {
    vi.mocked(uberFetch).mockRejectedValue(new Error('network failure'))
    const res = await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal_error')
    // Error detail must not leak raw error string to client
    expect(JSON.stringify(body)).not.toContain('network failure')
    expect(body.correlation_id).toBeDefined()
  })

  it('calls auditLog on Uber API error', async () => {
    vi.mocked(uberFetch).mockResolvedValue(uberError(500, 'server error'))
    await GET(makeRequest(`Bearer ${VALID_KEY}`))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'uber.stores.list',
    }))
  })
})
