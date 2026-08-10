// Proves the Uber validation runner is fail-closed: it returns a non-zero exit
// code whenever any executed lifecycle step fails, and 0 ONLY on a full green run.
// Also proves the sanitizer never lets secrets through.

import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs runner, no type decls
import { runValidation, makeSanitizer } from '../../../scripts/uber-validation/runner.mjs'

type MockResp = { status: number; body: unknown }

/** Build a fetch mock keyed by the request's action (sandbox) or path (order route). */
function mockFetch(responder: (action: string, url: string) => MockResp) {
  return async (url: string, opts: { body: string }) => {
    const parsed = JSON.parse(opts.body) as { action?: string }
    const action = parsed.action ?? 'unknown'
    const { status, body } = responder(action, url)
    return {
      status,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }
}

const okProbe = {
  correlation_id: 'c-probe',
  phases: { phase2_marketplace: { token_probe: { ok: true, granted_scope: 'eats.store eats.order eats.store.orders.read' } } },
}
const okLifecycle = { correlation_id: 'c-life', result: { ok: true } }
const okResolve = { correlation_id: 'c-res', ok: true }

const CONFIG = {
  sandboxUrl: 'https://sandbox.example',
  adminSecret: 'admin-secret-value-1234567890',
  storeId: '633b57d4-237a-5a32-b249-7ceb795f1d35',
  orderId: 'REAL-ORDER-123',
  itemId: 'item-1',
}

describe('uber validation runner — fail-closed', () => {
  it('RUN-001: full green → exit 0, all six steps PASS', async () => {
    const fetchImpl = mockFetch((action, url) => {
      if (action === 'scope_probe') return { status: 200, body: okProbe }
      if (url.includes('/uber-eats/order')) return { status: 200, body: okResolve }
      return { status: 200, body: okLifecycle }
    })
    const r = await runValidation({ fetchImpl, config: CONFIG })
    expect(r.exitCode).toBe(0)
    expect(r.summary).toEqual({ pass: 6, fail: 0, blocked: 0 })
  })

  it('RUN-002: a lifecycle step failing (accept result.ok=false) → exit 1', async () => {
    const fetchImpl = mockFetch((action, url) => {
      if (action === 'scope_probe') return { status: 200, body: okProbe }
      if (action === 'delivery_order_accept') return { status: 200, body: { correlation_id: 'x', result: { ok: false, error: 'boom' } } }
      if (url.includes('/uber-eats/order')) return { status: 200, body: okResolve }
      return { status: 200, body: okLifecycle }
    })
    const r = await runValidation({ fetchImpl, config: CONFIG })
    expect(r.exitCode).toBe(1)
    expect(r.steps.find(s => s.name === 'accept')?.status).toBe('FAIL')
  })

  it('RUN-003: a lifecycle step returning non-200 (ready HTTP 422) → exit 1', async () => {
    const fetchImpl = mockFetch((action, url) => {
      if (action === 'scope_probe') return { status: 200, body: okProbe }
      if (action === 'delivery_order_ready') return { status: 422, body: { result: { ok: false } } }
      if (url.includes('/uber-eats/order')) return { status: 200, body: okResolve }
      return { status: 200, body: okLifecycle }
    })
    const r = await runValidation({ fetchImpl, config: CONFIG })
    expect(r.exitCode).toBe(1)
    expect(r.steps.find(s => s.name === 'ready')?.status).toBe('FAIL')
  })

  it('RUN-004: probe without eats.order → probe FAIL → exit 1 (never PASS on missing scope)', async () => {
    const fetchImpl = mockFetch((action, url) => {
      if (action === 'scope_probe') return { status: 200, body: { phases: { phase2_marketplace: { token_probe: { ok: false, error: 'invalid_scope' } } } } }
      if (url.includes('/uber-eats/order')) return { status: 200, body: okResolve }
      return { status: 200, body: okLifecycle }
    })
    const r = await runValidation({ fetchImpl, config: CONFIG })
    expect(r.exitCode).toBe(1)
    expect(r.steps.find(s => s.name === 'probe')?.status).toBe('FAIL')
  })

  it('RUN-005: no order id → probe PASS but lifecycle BLOCKED → exit 2 (incomplete, never 0)', async () => {
    const fetchImpl = mockFetch((action) => (action === 'scope_probe' ? { status: 200, body: okProbe } : { status: 200, body: okLifecycle }))
    const r = await runValidation({ fetchImpl, config: { ...CONFIG, orderId: null } })
    expect(r.exitCode).toBe(2)
    expect(r.summary.blocked).toBe(5)
    expect(r.steps.find(s => s.name === 'probe')?.status).toBe('PASS')
  })

  it('RUN-006: a request throwing → that step FAILs → exit 1', async () => {
    const fetchImpl = mockFetch((action) => {
      if (action === 'delivery_order_cancel') throw new Error('network down')
      if (action === 'scope_probe') return { status: 200, body: okProbe }
      return { status: 200, body: okLifecycle }
    }) as unknown as typeof fetch
    // resolve goes to /order path — return ok
    const wrapped = (async (url: string, opts: { body: string }) => {
      if (url.includes('/uber-eats/order')) return { status: 200, text: async () => JSON.stringify(okResolve) } as unknown as Response
      return fetchImpl(url as unknown as RequestInfo, opts as unknown as RequestInit)
    })
    const r = await runValidation({ fetchImpl: wrapped as unknown as typeof fetch, config: CONFIG })
    expect(r.exitCode).toBe(1)
    expect(r.steps.find(s => s.name === 'cancel')?.status).toBe('FAIL')
  })
})

describe('uber validation runner — sanitizer never leaks secrets', () => {
  it('SAN-001: redacts admin secret, service key, bearer tokens, JWTs and long blobs', () => {
    const sanitize = makeSanitizer(['admin-secret-value-1234567890', 'service-key-abcdef'])
    const dirty = [
      'Authorization: Bearer eyJhbGciOiJVERYLONGTOKENvalue1234567890abcdefghij',
      'admin-secret-value-1234567890',
      'service-key-abcdef',
      '{"access_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      'plain readable text ok',
    ].join(' | ')
    const clean = sanitize(dirty)
    expect(clean).not.toContain('admin-secret-value-1234567890')
    expect(clean).not.toContain('service-key-abcdef')
    expect(clean).not.toMatch(/Bearer\s+eyJ/)
    expect(clean).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(clean).toContain('plain readable text ok') // non-secret content survives
  })

  it('SAN-002: runner step details never contain the admin secret', async () => {
    const fetchImpl = mockFetch((action) => (action === 'scope_probe'
      ? { status: 200, body: { note: 'admin-secret-value-1234567890 leaked?', phases: { phase2_marketplace: { token_probe: { ok: true, granted_scope: 'eats.order' } } } } }
      : { status: 200, body: okLifecycle }))
    const r = await runValidation({ fetchImpl, config: CONFIG })
    for (const s of r.steps) expect(s.detail).not.toContain('admin-secret-value-1234567890')
  })
})
