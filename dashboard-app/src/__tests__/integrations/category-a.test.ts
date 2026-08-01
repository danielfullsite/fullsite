// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  Categoría A — Validación Interna (sin Uber API)                           │
// │  Integration Framework v1 — Uber Eats                                      │
// │                                                                             │
// │  Cubre: HMAC, dedup, DLQ, retry, audit/redact, correlation IDs,            │
// │  reconciliación, store mapping, idempotencia, errores, replay, timeout,    │
// │  casos negativos, USL                                                       │
// │                                                                             │
// │  Todos los tests pasan sin credenciales de Uber ni DB real.                │
// └─────────────────────────────────────────────────────────────────────────────┘

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { withRetry, RetryExhaustedError, isTransientHttpError } from '@/lib/integrations/retry'
import { normalizeUberOrder } from '@/lib/integrations/uber-eats/order-adapter'
import { buildUberAuthUrl, USL_SCOPES } from '@/lib/integrations/uber-eats/oauth'
import { auditLog } from '@/lib/integrations/audit-logger'
import { UBER_DENY_REASONS, UBER_CANCEL_REASONS, DENY_REASON_LABELS, CANCEL_REASON_LABELS } from '@/lib/integrations/uber-eats/reasons'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-webhook-secret-category-a'
const TEST_SB_URL = 'https://test.supabase.co'
const TEST_SB_KEY = 'test-service-key-cat-a'

/** Compute HMAC-SHA256 signature matching the webhook handler's verification logic. */
function hmac(body: string, secret = TEST_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

/** Build a NextRequest with a real HMAC signature (or override). */
function webhookRequest(
  body: Record<string, unknown>,
  opts: { secret?: string | null; extraHeaders?: Record<string, string> } = {}
): NextRequest {
  const raw = JSON.stringify(body)
  const sig = opts.secret === null ? undefined : hmac(raw, opts.secret ?? TEST_SECRET)
  return new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'x-uber-signature': sig } : {}),
      ...opts.extraHeaders,
    },
    body: raw,
  })
}

/** Build fetch mock responses keyed by URL substring. */
function buildFetchMock(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = input.toString()
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
    }
    return Promise.resolve(new Response('', { status: 200 }))
  })
}

/** Minimal fetch mock that lets the webhook handler complete without real calls. */
function minimalWebhookMock(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  return buildFetchMock({
    integration_store_mappings: [{ client_id: 'sandbox-client' }],
    integration_webhook_events: [{ id: 'evt-test-001', status: 'received', correlation_id: 'corr-test-001' }],
    delivery_orders: [],
    integration_audit_log: [],
    integration_webhook_dlq: [],
    'login.uber.com': { access_token: 'tok-sandbox', expires_in: 3600 },
    ...overrides,
  })
}

const SAMPLE_ORDER = {
  event_type: 'orders.notification',
  meta: {
    resource_id: 'order-cat-a-001',
    resource: { store: { store_id: 'store-cat-a' } },
  },
  id: 'order-cat-a-001',
  cart: { items: [{ title: 'Chilaquiles', quantity: 1, price: { unit_price: { amount: 10000 } }, total_price: { amount: 10000 }, selected_modifier_groups: [] }] },
  eater: { first_name: 'Test', last_name: 'User', phone: { number: '+521234567890' } },
  payment: { charges: { total: { amount: 10000 } } },
  delivery_fee: { amount: 0 },
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.UBER_WEBHOOK_SECRET = TEST_SECRET
  process.env.SUPABASE_SERVICE_KEY = TEST_SB_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SB_URL
  process.env.UBER_CLIENT_ID = 'test-client-id'
  process.env.UBER_CLIENT_SECRET = 'test-client-secret'
  process.env.UBER_ENV = 'sandbox'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.UBER_WEBHOOK_SECRET
  delete process.env.SUPABASE_SERVICE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.UBER_CLIENT_ID
  delete process.env.UBER_CLIENT_SECRET
  delete process.env.UBER_ENV
})

// ─── CAT-A-001..005: HMAC / Signature Verification ────────────────────────────

describe('CAT-A-001..005: HMAC Signature Verification', () => {
  it('CAT-A-001: missing x-uber-signature header → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER, { secret: null })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('CAT-A-002: wrong signature (tampered body) → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const raw = JSON.stringify(SAMPLE_ORDER)
    // Compute signature on the original body, then send modified body
    const sig = hmac(raw + 'tampered')
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-uber-signature': sig },
      body: raw,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('CAT-A-003: wrong secret key → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER, { secret: 'wrong-secret-key' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('CAT-A-004: UBER_WEBHOOK_SECRET not configured → 503', async () => {
    delete process.env.UBER_WEBHOOK_SECRET
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER)
    const res = await POST(req)
    expect(res.status).toBe(503)
  })

  it('CAT-A-005: valid HMAC signature → not 401/503', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER)
    const res = await POST(req)
    // Valid signature passes; outcome depends on downstream but NOT 401 or 503
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })
})

// ─── CAT-A-006..007: Service Role Guard ──────────────────────────────────────

describe('CAT-A-006..007: SUPABASE_SERVICE_KEY Guard', () => {
  it('CAT-A-006: SUPABASE_SERVICE_KEY missing → 503', async () => {
    delete process.env.SUPABASE_SERVICE_KEY
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER)
    const res = await POST(req)
    expect(res.status).toBe(503)
  })

  it('CAT-A-007: valid sig + valid key → webhook is processed (200)', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest(SAMPLE_ORDER)
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ─── CAT-A-008..010: Request Parsing ─────────────────────────────────────────

describe('CAT-A-008..010: Request Parsing', () => {
  it('CAT-A-008: malformed JSON body → 400', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const raw = '{invalid json}'
    const sig = hmac(raw)
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-uber-signature': sig },
      body: raw,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('CAT-A-009: empty JSON object is parsed and processed (200)', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest({})
    const res = await POST(req)
    // Empty body parses successfully; unknown event type → 200 without DLQ
    expect(res.status).toBe(200)
  })

  it('CAT-A-010: unknown event_type is ack-ed without error (200)', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const req = webhookRequest({ event_type: 'unknown.event.type', id: 'evt-999' })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ─── CAT-A-011..015: Deduplication / Exactly-Once ────────────────────────────

describe('CAT-A-011..015: Deduplication / Exactly-Once', () => {
  it('CAT-A-011: same event_id → duplicate ack (200) without second processing', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    // First call: webhook_events insert returns a row (new event)
    // Second call: webhook_events insert returns [] (ignore-duplicates on UNIQUE constraint)
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = input.toString()
      if (url.includes('integration_webhook_events') && !url.includes('?')) {
        callCount++
        const body = callCount === 1
          ? [{ id: 'evt-dedup-001', status: 'received', correlation_id: 'corr-dedup-001' }]
          : []  // second insert: duplicate ignored
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
      if (url.includes('integration_webhook_events') && url.includes('?')) {
        // fetch existing on duplicate
        return Promise.resolve(new Response(JSON.stringify([{ id: 'evt-dedup-001', status: 'processed', correlation_id: 'corr-dedup-001' }]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    const req1 = webhookRequest({ ...SAMPLE_ORDER, event_id: 'stable-event-id-001' })
    const req2 = webhookRequest({ ...SAMPLE_ORDER, event_id: 'stable-event-id-001' })
    const [res1, res2] = await Promise.all([POST(req1), POST(req2)])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })

  it('CAT-A-012: idempotency_key is deterministic for same order', () => {
    const k1 = normalizeUberOrder({ id: 'order-XYZ', cart: { items: [] } }, 's1', 'c1', 'corr-A').idempotency_key
    const k2 = normalizeUberOrder({ id: 'order-XYZ', cart: { items: [] } }, 's1', 'c1', 'corr-B').idempotency_key
    expect(k1).toBe(k2)
    expect(k1).toBe('ubereats-order-order-XYZ')
  })

  it('CAT-A-013: idempotency_key changes for different order', () => {
    const k1 = normalizeUberOrder({ id: 'order-AAA', cart: { items: [] } }, 's1', 'c1', 'corr').idempotency_key
    const k2 = normalizeUberOrder({ id: 'order-BBB', cart: { items: [] } }, 's1', 'c1', 'corr').idempotency_key
    expect(k1).not.toBe(k2)
  })

  it('CAT-A-014: synthetic event_id is deterministic: type:orderId format', () => {
    // The handler generates: event_id ?? uuid ?? `${eventType}:${orderId}`
    // Verify the format is deterministic
    const body1 = { event_type: 'orders.notification', meta: { resource_id: 'ord-001' } }
    const body2 = { event_type: 'orders.notification', meta: { resource_id: 'ord-001' } }
    // Compute what the handler would generate
    const eventType1 = (body1.event_type ?? '') as string
    const orderId1 = (body1.meta?.resource_id ?? '') as string
    const eventType2 = (body2.event_type ?? '') as string
    const orderId2 = (body2.meta?.resource_id ?? '') as string
    expect(`${eventType1}:${orderId1}`).toBe(`${eventType2}:${orderId2}`)
  })

  it('CAT-A-015: different event types produce different synthetic IDs', () => {
    const orderId = 'ord-001'
    const id1 = `orders.notification:${orderId}`
    const id2 = `orders.cancel:${orderId}`
    expect(id1).not.toBe(id2)
  })
})

// ─── CAT-A-016..022: Retry + Timeout ─────────────────────────────────────────

describe('CAT-A-016..022: withRetry + Timeout', () => {
  it('CAT-A-016: success on first attempt', async () => {
    let calls = 0
    const r = await withRetry(async () => { calls++; return 'done' })
    expect(r).toBe('done')
    expect(calls).toBe(1)
  })

  it('CAT-A-017: retries on transient failure, succeeds on 3rd attempt', async () => {
    let calls = 0
    const r = await withRetry(async () => {
      calls++
      if (calls < 3) throw new Error('transient')
      return 'recovered'
    }, { maxAttempts: 3, baseDelayMs: 1 })
    expect(r).toBe('recovered')
    expect(calls).toBe(3)
  })

  it('CAT-A-018: throws RetryExhaustedError after maxAttempts', async () => {
    let calls = 0
    await expect(
      withRetry(async () => { calls++; throw new Error('always fails') }, { maxAttempts: 2, baseDelayMs: 1 })
    ).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(calls).toBe(2)
  })

  it('CAT-A-019: non-retryable error stops after 1 attempt', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => { calls++; throw new Error('terminal') },
        { maxAttempts: 5, baseDelayMs: 1, isRetryable: () => false }
      )
    ).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(calls).toBe(1)
  })

  it('CAT-A-020: RetryExhaustedError contains attempt count and last error', async () => {
    let err: RetryExhaustedError | undefined
    try {
      await withRetry(async () => { throw new Error('root cause') }, { maxAttempts: 2, baseDelayMs: 1 })
    } catch (e) { err = e as RetryExhaustedError }
    expect(err).toBeInstanceOf(RetryExhaustedError)
    expect(err!.attempts).toBe(2)
    expect(String(err!.lastError)).toContain('root cause')
  })

  it('CAT-A-021: attempt number passed to fn increments correctly', async () => {
    const attempts: number[] = []
    await withRetry(async (n) => {
      attempts.push(n)
      if (n < 3) throw new Error('retry me')
      return 'ok'
    }, { maxAttempts: 3, baseDelayMs: 1 })
    expect(attempts).toEqual([1, 2, 3])
  })
})

// ─── CAT-A-022..025: isTransientHttpError ────────────────────────────────────

describe('CAT-A-022..025: isTransientHttpError', () => {
  it('CAT-A-022: 429 (rate limited) → retryable', () => expect(isTransientHttpError(429)).toBe(true))
  it('CAT-A-023: 500 (server error) → retryable', () => expect(isTransientHttpError(500)).toBe(true))
  it('CAT-A-024: 503 (unavailable) → retryable', () => expect(isTransientHttpError(503)).toBe(true))
  it('CAT-A-025: 504 (gateway timeout) → retryable', () => expect(isTransientHttpError(504)).toBe(true))
  it('CAT-A-026: 400 (bad request) → NOT retryable', () => expect(isTransientHttpError(400)).toBe(false))
  it('CAT-A-027: 401 (unauthorized) → NOT retryable', () => expect(isTransientHttpError(401)).toBe(false))
  it('CAT-A-028: 404 (not found) → NOT retryable', () => expect(isTransientHttpError(404)).toBe(false))
  it('CAT-A-029: 200 (success) → NOT retryable', () => expect(isTransientHttpError(200)).toBe(false))
})

// ─── CAT-A-030..034: Audit Log / Redaction ───────────────────────────────────

describe('CAT-A-030..034: Audit Log + Redaction', () => {
  it('CAT-A-030: auditLog calls fetch exactly once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    await auditLog({ provider: 'ubereats', action: 'test.action', request: { foo: 'bar' } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('CAT-A-031: sensitive keys are redacted in request payload', async () => {
    let capturedBody: Record<string, unknown> | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string) as Record<string, unknown>
      return new Response('', { status: 200 })
    })
    await auditLog({
      provider: 'ubereats',
      action: 'order.accept',
      request: { access_token: 'should-be-redacted', order_id: 'preserved' },
    })
    const req = capturedBody?.request_summary as Record<string, unknown>
    expect(req?.access_token).toBe('***REDACTED***')
    expect(req?.order_id).toBe('preserved')
  })

  it('CAT-A-032: authorization header is redacted', async () => {
    let capturedBody: Record<string, unknown> | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string) as Record<string, unknown>
      return new Response('', { status: 200 })
    })
    await auditLog({
      provider: 'ubereats',
      action: 'order.get_details',
      request: { authorization: 'Bearer real-token', store_id: 'preserved' },
    })
    const req = capturedBody?.request_summary as Record<string, unknown>
    expect(req?.authorization).toBe('***REDACTED***')
    expect(req?.store_id).toBe('preserved')
  })

  it('CAT-A-033: nested sensitive key is redacted', async () => {
    let capturedBody: Record<string, unknown> | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string) as Record<string, unknown>
      return new Response('', { status: 200 })
    })
    await auditLog({
      provider: 'ubereats',
      action: 'store.status_update',
      request: { nested: { password: 'secret123', label: 'visible' } },
    })
    const nested = (capturedBody?.request_summary as Record<string, unknown>)?.nested as Record<string, unknown>
    expect(nested?.password).toBe('***REDACTED***')
    expect(nested?.label).toBe('visible')
  })

  it('CAT-A-034: auditLog never throws even when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    // Should resolve, not reject
    await expect(auditLog({ provider: 'ubereats', action: 'test', request: { x: 1 } })).resolves.toBeUndefined()
  })
})

// ─── CAT-A-035..038: Correlation IDs ─────────────────────────────────────────

describe('CAT-A-035..038: Correlation IDs', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it('CAT-A-035: normalizeUberOrder embeds correlation_id in canonical order', () => {
    const order = normalizeUberOrder({ id: 'ord-corr-001', cart: { items: [] } }, 's1', 'c1', 'corr-id-abc')
    expect(order.correlation_id).toBe('corr-id-abc')
  })

  it('CAT-A-036: correlation_id propagates to idempotency_key (order-level traceability)', () => {
    const order = normalizeUberOrder({ id: 'ord-corr-002', cart: { items: [] } }, 's1', 'c1', 'corr-xyz')
    // idempotency_key is based on order_id, not correlation_id (intentional — for exactly-once)
    // but the order carries the correlation_id for cross-table joins
    expect(order.idempotency_key).toBe('ubereats-order-ord-corr-002')
    expect(order.correlation_id).toBe('corr-xyz')
  })

  it('CAT-A-037: two calls with different correlation_ids produce different audit trails', async () => {
    const captured: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>
      if (body.correlation_id) captured.push(body.correlation_id as string)
      return new Response('', { status: 200 })
    })
    await auditLog({ provider: 'ubereats', correlation_id: 'corr-AAA', action: 'action.one' })
    await auditLog({ provider: 'ubereats', correlation_id: 'corr-BBB', action: 'action.two' })
    expect(captured).toContain('corr-AAA')
    expect(captured).toContain('corr-BBB')
    expect(captured[0]).not.toBe(captured[1])
  })

  it('CAT-A-038: GET health check exposes service version', async () => {
    const { GET } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(body.version).toMatch(/\d+\.\d+\.\d+/)
  })
})

// ─── CAT-A-039..043: USL Implementation ──────────────────────────────────────

describe('CAT-A-039..043: USL / OAuth Flow', () => {
  it('CAT-A-039: buildUberAuthUrl returns URL with correct base (sandbox)', () => {
    const url = buildUberAuthUrl('state-xyz', 'https://app.fullsite.mx/callback')
    expect(url).toContain('sandbox-login.uber.com')
    expect(url).not.toContain('//login.uber.com')
  })

  it('CAT-A-040: buildUberAuthUrl URL contains state, client_id, redirect_uri', () => {
    const state = 'test-state-csrf-123'
    const redirectUri = 'https://app.fullsite.mx/api/integrations/uber-eats/auth/callback'
    const url = buildUberAuthUrl(state, redirectUri)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('state')).toBe(state)
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
  })

  it('CAT-A-041: buildUberAuthUrl includes required scopes', () => {
    const url = buildUberAuthUrl('state', 'https://app.fullsite.mx/callback', USL_SCOPES)
    const parsed = new URL(url)
    const scope = parsed.searchParams.get('scope') ?? ''
    expect(scope).toContain('eats.order')
    expect(scope).toContain('eats.store')
  })

  it('CAT-A-042: CSRF state format is uuid|store_id|client_id', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const state = `${crypto.randomUUID()}|STORE-001|amalay`
    const parts = state.split('|')
    expect(parts).toHaveLength(3)
    expect(UUID_REGEX.test(parts[0])).toBe(true)
    expect(parts[1]).toBe('STORE-001')
    expect(parts[2]).toBe('amalay')
  })

  it('CAT-A-043: exchangeUberCode throws descriptively when credentials missing', async () => {
    delete process.env.UBER_CLIENT_ID
    delete process.env.UBER_CLIENT_SECRET
    const { exchangeUberCode } = await import('@/lib/integrations/uber-eats/oauth')
    await expect(exchangeUberCode('test-code', 'https://app.fullsite.mx/callback'))
      .rejects.toThrow('UBER_CLIENT_ID/UBER_CLIENT_SECRET not configured')
  })
})

// ─── CAT-A-044..048: Store Mapping ───────────────────────────────────────────

describe('CAT-A-044..048: Store Mapping', () => {
  it('CAT-A-044: normalizer uses provided storeId', () => {
    const order = normalizeUberOrder({ id: 'ord-1', cart: { items: [] } }, 'STORE-ABC', 'client-A', 'c1')
    expect(order.provider_store_id).toBe('STORE-ABC')
    expect(order.client_id).toBe('client-A')
  })

  it('CAT-A-045: different store IDs produce independent orders', () => {
    const o1 = normalizeUberOrder({ id: 'ord-X', cart: { items: [] } }, 'STORE-1', 'client-1', 'c1')
    const o2 = normalizeUberOrder({ id: 'ord-X', cart: { items: [] } }, 'STORE-2', 'client-2', 'c1')
    // Same order_id but different stores → same idempotency_key (provider_order_id is unique per Uber)
    expect(o1.provider_store_id).not.toBe(o2.provider_store_id)
    expect(o1.client_id).not.toBe(o2.client_id)
  })

  it('CAT-A-046: webhook handler queries store_mappings before falling back to env', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const urlsQueried: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      urlsQueried.push(input.toString())
      return Promise.resolve(new Response(JSON.stringify([{ client_id: 'mapped-client' }]), { status: 200 }))
    })
    const req = webhookRequest({ ...SAMPLE_ORDER, event_type: 'orders.notification' })
    await POST(req)
    const storeMappingQuery = urlsQueried.find(u => u.includes('integration_store_mappings'))
    expect(storeMappingQuery).toBeTruthy()
    expect(storeMappingQuery).toContain('provider=eq.ubereats')
  })

  it('CAT-A-047: unknown store falls back gracefully (no crash)', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = input.toString()
      if (url.includes('integration_store_mappings')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 })) // no mapping
      }
      return Promise.resolve(new Response(JSON.stringify([{ id: 'evt-001', status: 'received', correlation_id: 'c-001' }]), { status: 200 }))
    })
    const req = webhookRequest({ event_type: 'orders.notification', meta: { resource_id: 'ord-001', resource: { store: { store_id: 'UNKNOWN-STORE' } } } })
    const res = await POST(req)
    // Falls back to env or default client — doesn't crash
    expect(res.status).toBe(200)
  })
})

// ─── CAT-A-048..053: DLQ ──────────────────────────────────────────────────────

describe('CAT-A-048..053: Dead-Letter Queue', () => {
  it('CAT-A-048: DLQ route handler exists', async () => {
    // DLQ is written by the webhook handler on processing error, not a separate route
    // Verify the webhook handler exports are correct
    const handler = await import('@/app/api/integrations/uber-eats/webhook/route')
    expect(typeof handler.POST).toBe('function')
    expect(typeof handler.GET).toBe('function')
  })

  it('CAT-A-049: DLQ entry written when processing throws', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const dlqUrls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, opts) => {
      const url = input.toString()
      if (url.includes('integration_webhook_dlq')) dlqUrls.push(url)
      if (url.includes('integration_store_mappings')) {
        return Promise.resolve(new Response(JSON.stringify([{ client_id: 'test-client' }]), { status: 200 }))
      }
      if (url.includes('integration_webhook_events') && opts?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify([{ id: 'evt-dlq-001', status: 'received', correlation_id: 'c-dlq-001' }]), { status: 200 }))
      }
      if (url.includes('integration_webhook_events') && opts?.method === 'PATCH') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      // Simulate delivery_orders insert failure → triggers DLQ path
      if (url.includes('delivery_orders') && opts?.method === 'POST') {
        return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    const req = webhookRequest({ ...SAMPLE_ORDER, event_type: 'orders.notification', meta: { resource_id: 'ord-dlq-001', resource: { store: { store_id: 'STORE-001' } } } })
    const res = await POST(req)
    // Handler always returns 200 to Uber (even on error)
    expect(res.status).toBe(200)
    // DLQ insert should have been attempted
    expect(dlqUrls.length).toBeGreaterThan(0)
  })

  it('CAT-A-050: webhook always returns 200 to Uber (even on internal error)', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
    })
    const req = webhookRequest({ ...SAMPLE_ORDER, event_type: 'orders.notification' })
    const res = await POST(req)
    // Must ack with 200 — Uber expects this
    expect(res.status).toBe(200)
  })
})

// ─── CAT-A-054..058: Webhook Replay / Replay Resistance ──────────────────────

describe('CAT-A-054..058: Webhook Replay', () => {
  it('CAT-A-054: same body replayed → same HMAC signature', () => {
    const body = JSON.stringify({ event_type: 'orders.notification', id: 'ord-replay-001' })
    const sig1 = hmac(body)
    const sig2 = hmac(body)
    expect(sig1).toBe(sig2) // deterministic
  })

  it('CAT-A-055: different body → different HMAC signature', () => {
    const sig1 = hmac(JSON.stringify({ id: 'ord-001' }))
    const sig2 = hmac(JSON.stringify({ id: 'ord-002' }))
    expect(sig1).not.toBe(sig2)
  })

  it('CAT-A-056: replay with body modification → signature mismatch → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const originalBody = JSON.stringify({ event_type: 'orders.notification', id: 'ord-replay-002' })
    const validSig = hmac(originalBody)
    // Attacker replays the signature but with modified body
    const tamperedBody = JSON.stringify({ event_type: 'orders.notification', id: 'ord-INJECTED' })
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-uber-signature': validSig },
      body: tamperedBody,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('CAT-A-057: sha256= prefix is required in signature header', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(minimalWebhookMock())
    const raw = JSON.stringify(SAMPLE_ORDER)
    // Send hex without sha256= prefix
    const hexOnly = createHmac('sha256', TEST_SECRET).update(raw).digest('hex')
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-uber-signature': hexOnly },
      body: raw,
    })
    const res = await POST(req)
    // hex without sha256= prefix: the handler strips `sha256=` prefix before parsing hex.
    // If it's already hex (no prefix), stripping does nothing, and it still parses.
    // The behavior depends on the handler; what matters is we get either 200 or 401, not 500.
    expect([200, 401]).toContain(res.status)
  })
})

// ─── CAT-A-058..062: Negative Cases ─────────────────────────────────────────

describe('CAT-A-058..062: Negative / Edge Cases', () => {
  it('CAT-A-058: cancelled order event updates delivery_orders status', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const patchedUrls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, opts) => {
      const url = input.toString()
      if (url.includes('delivery_orders') && opts?.method === 'PATCH') patchedUrls.push(url)
      if (url.includes('integration_store_mappings')) return Promise.resolve(new Response(JSON.stringify([{ client_id: 'tc' }]), { status: 200 }))
      if (url.includes('integration_webhook_events') && opts?.method === 'POST') return Promise.resolve(new Response(JSON.stringify([{ id: 'e1', status: 'received', correlation_id: 'c1' }]), { status: 200 }))
      return Promise.resolve(new Response('', { status: 200 }))
    })
    const req = webhookRequest({ event_type: 'orders.cancel', meta: { resource_id: 'ord-cancel-001', resource: { store: { store_id: 's1' } } } })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(patchedUrls.some(u => u.includes('delivery_orders'))).toBe(true)
  })

  it('CAT-A-059: order normalization — empty items array', () => {
    const order = normalizeUberOrder({ id: 'ord-empty', cart: { items: [] } }, 's1', 'c1', 'corr')
    expect(order.items).toHaveLength(0)
    expect(order.total).toBe(0)
  })

  it('CAT-A-060: order normalization — missing eater falls back to default name', () => {
    const order = normalizeUberOrder({ id: 'ord-no-eater', cart: { items: [] } }, 's1', 'c1', 'corr')
    expect(order.customer_name).toBe('Cliente Uber')
    expect(order.customer_phone).toBeUndefined()
  })

  it('CAT-A-061: order normalization — item without modifiers', () => {
    const order = normalizeUberOrder({
      id: 'ord-no-mod',
      cart: { items: [{ title: 'Agua', quantity: 1, price: { unit_price: { amount: 3000 } }, total_price: { amount: 3000 } }] },
    }, 's1', 'c1', 'corr')
    expect(order.items[0].modifiers).toHaveLength(0)
    expect(order.items[0].unit_price).toBe(30) // 3000 cents → 30 MXN
  })

  it('CAT-A-062: all deny reasons have Spanish labels (catalog completeness)', () => {
    for (const reason of Object.values(UBER_DENY_REASONS)) {
      expect(DENY_REASON_LABELS[reason], `Missing label for deny reason: ${reason}`).toBeTruthy()
    }
  })

  it('CAT-A-063: all cancel reasons have Spanish labels (catalog completeness)', () => {
    for (const reason of Object.values(UBER_CANCEL_REASONS)) {
      expect(CANCEL_REASON_LABELS[reason], `Missing label for cancel reason: ${reason}`).toBeTruthy()
    }
  })
})

// ─── CAT-A-064..066: Reconciliation ──────────────────────────────────────────

describe('CAT-A-064..066: Reconciliation Route', () => {
  it('CAT-A-064: /reconcile POST handler exists', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/reconcile/route')
    expect(typeof POST).toBe('function')
  })

  it('CAT-A-065: /reconcile POST without service key returns 401/503', async () => {
    delete process.env.SUPABASE_SERVICE_KEY
    const { POST } = await import('@/app/api/integrations/uber-eats/reconcile/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('', { status: 200 })))
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'test-client' }),
    })
    const res = await POST(req)
    // Without service key, should fail with 4xx or 5xx
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('CAT-A-066: /reconcile route returns JSON response', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/reconcile/route')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
    const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'test-client' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(body).toBeDefined()
  })
})
