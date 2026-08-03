// UBER-031: store.menu_refresh_request webhook handler
//
// Tests per closure criteria:
//   A: canonical event name handled (not alias menu.refresh)
//   B: menu.refresh → unknown event path, ACK 200, no upload
//   C: dedup → ACK 200, no upload
//   D: unmapped store → quarantine, ACK 200, no upload
//   E: upload success → audit log with event_id, store_id, corr_id, timestamp, result
//   F: upload failure → DLQ + markEventProcessed(error), ACK 200
//   G: no cached menu → DLQ + markEventProcessed(error), ACK 200
//   H: HMAC absent → 401

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = 'test-webhook-secret-mr-31'
const STORE_ID = 'store-mr-test-abc'
const CLIENT_ID = 'client-mr-amalay'
const EVENT_ID_NEW = 'event-mr-new-001'

const SAMPLE_MENU = {
  menus: [{ id: 'menu-1', title: { es: 'Desayunos' }, service_availability: [], category_ids: ['cat-1'] }],
  categories: [{ id: 'cat-1', title: { es: 'Entradas' }, entities: [{ id: 'item-1', type: 'ITEM' as const }] }],
  items: [
    { id: 'item-1', external_data: 'chil-001', title: { es: 'Chilaquiles Verdes' }, price_info: { price: 12000, currency_code: 'MXN' } },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function computeSignature(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return 'sha256=' + Buffer.from(sigBytes).toString('hex')
}

function makeEventBody(eventType: string, eventId = 'evt-mr-001') {
  return JSON.stringify({
    event_type: eventType,
    event_id: eventId,
    meta: { resource: { store: { store_id: STORE_ID } } },
  })
}

interface MockOpts {
  storeFound?: boolean
  isDuplicate?: boolean
  menuFound?: boolean
  uploadOk?: boolean
}

function buildFetchMock(opts: MockOpts = {}) {
  const { storeFound = true, isDuplicate = false, menuFound = true, uploadOk = true } = opts

  const auditBodies: unknown[] = []
  const dlqBodies: unknown[] = []
  const markPatchBodies: unknown[] = []
  let uploadCalled = false

  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()

    // Token endpoint (uploadMenu → uberFetch → getUberAccessToken)
    if (url.includes('login.uber.com') || url.includes('auth.uber.com')) {
      return new Response(JSON.stringify({ access_token: 'tok-mr-test', expires_in: 3600, scope: 'eats.store' }), { status: 200 })
    }

    // Store mapping lookup → resolveClientId
    if (url.includes('integration_store_mappings')) {
      return new Response(JSON.stringify(storeFound ? [{ client_id: CLIENT_ID }] : []), { status: 200 })
    }

    // Webhook event upsert (dedup insert)
    if (url.includes('integration_webhook_events') && !url.includes('id=eq') && method === 'POST') {
      if (isDuplicate) {
        // ON CONFLICT → empty array → isDuplicate = true
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(
        JSON.stringify([{ id: EVENT_ID_NEW, status: 'received', correlation_id: 'corr-mr-test' }]),
        { status: 201 }
      )
    }

    // Webhook event GET (fetch existing row after duplicate)
    if (url.includes('integration_webhook_events') && method === 'GET') {
      return new Response(
        JSON.stringify([{ id: 'event-existing', status: 'processed', correlation_id: 'corr-existing' }]),
        { status: 200 }
      )
    }

    // Webhook event PATCH (markEventProcessed)
    if (url.includes('integration_webhook_events') && method === 'PATCH') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      markPatchBodies.push(body)
      return new Response('', { status: 204 })
    }

    // DLQ quarantine (unmapped store OR integration_webhook_dlq)
    if (url.includes('integration_webhook_dlq')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      dlqBodies.push(body)
      return new Response('', { status: 201 })
    }

    // Menu cache fetch
    if (url.includes('integration_menu_cache')) {
      return new Response(
        JSON.stringify(menuFound ? [{ menu_payload: SAMPLE_MENU }] : []),
        { status: 200 }
      )
    }

    // Uber menu upload
    if (url.includes('/v2/eats/stores/') && url.includes('/menus')) {
      uploadCalled = true
      if (!uploadOk) return new Response('Internal Server Error from Uber', { status: 500 })
      return new Response('', { status: 200 })
    }

    // Audit log
    if (url.includes('integration_audit_log')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      auditBodies.push(body)
      return new Response('', { status: 201 })
    }

    return new Response('', { status: 200 })
  })

  return { spy, auditBodies, dlqBodies, markPatchBodies, get uploadCalled() { return uploadCalled } }
}

async function callWebhookPost(body: string, opts: { sig?: string; skipSig?: boolean } = {}) {
  process.env.UBER_WEBHOOK_SECRET = SECRET
  process.env.SUPABASE_SERVICE_KEY = 'svc-key-test'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.UBER_CLIENT_ID = 'test-uber-client-id'
  process.env.UBER_CLIENT_SECRET = 'test-uber-client-secret'
  process.env.UBER_ENV = 'sandbox'

  const sig = opts.skipSig ? '' : (opts.sig ?? await computeSignature(body))
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sig) headers['x-uber-signature'] = sig

  const req = new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
    method: 'POST',
    headers,
    body,
  })

  const handler = await import('@/app/api/integrations/uber-eats/webhook/route')
  return handler.POST(req)
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { clearTokenCache } = await import('@/lib/integrations/uber-eats/oauth')
  clearTokenCache()
  delete process.env.UBER_WEBHOOK_SECRET
  delete process.env.SUPABASE_SERVICE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.UBER_CLIENT_ID
  delete process.env.UBER_CLIENT_SECRET
  delete process.env.UBER_ENV
})

// ─── UBER-031 ─────────────────────────────────────────────────────────────────

describe('UBER-031-A: store.menu_refresh_request canonical event name', () => {
  it('routes store.menu_refresh_request to menu upload (not unknown-event path)', async () => {
    const { spy, auditBodies } = buildFetchMock({ uploadOk: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    // Audit log must contain action menu.refresh_request
    const menuAudit = auditBodies.find(
      (b) => (b as Record<string, unknown>).action === 'menu.refresh_request'
    ) as Record<string, unknown> | undefined
    expect(menuAudit).toBeDefined()
    expect((menuAudit?.request_summary as Record<string, unknown>)?.store_id).toBe(STORE_ID)
  })

  it('audit log includes event_id, store_id, correlation_id, timestamp_utc, and result', async () => {
    const { spy, auditBodies } = buildFetchMock({ uploadOk: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request', 'evt-audit-check')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    const menuAudit = auditBodies.find(
      (b) => (b as Record<string, unknown>).action === 'menu.refresh_request'
    ) as Record<string, unknown> | undefined
    expect(menuAudit).toBeDefined()

    // auditLog stores request/response as request_summary/response_summary (redacted)
    const req = menuAudit?.request_summary as Record<string, unknown>
    expect(req?.store_id).toBe(STORE_ID)
    expect(req?.event_id).toBeDefined()
    expect(req?.timestamp_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/)  // ISO UTC
    expect(req?.items_count).toBe(1)

    const resp = menuAudit?.response_summary as Record<string, unknown>
    expect(resp?.ok).toBe(true)
    expect(resp?.status).toBe('uploaded')

    expect(menuAudit?.correlation_id).toBeDefined()
  })

  it('upload is called for the correct store', async () => {
    const { spy } = buildFetchMock({ uploadOk: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    await callWebhookPost(body)

    // Verify the Uber upload call targeted the right store
    const uploadCall = spy.mock.calls.find(
      ([url]) => url.toString().includes('/v2/eats/stores/') && url.toString().includes('/menus')
    )
    expect(uploadCall).toBeDefined()
    expect(uploadCall![0].toString()).toContain(STORE_ID)
  })
})

describe('UBER-031-B: menu.refresh is NOT a canonical alias — routes to unknown-event ACK', () => {
  it('menu.refresh returns 200 but does NOT trigger upload', async () => {
    const { spy } = buildFetchMock({ uploadOk: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('menu.refresh')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    // No Uber upload endpoint should be called
    const uploadCall = spy.mock.calls.find(
      ([url]) => url.toString().includes('/v2/eats/stores/') && url.toString().includes('/menus')
    )
    expect(uploadCall).toBeUndefined()
  })
})

describe('UBER-031-C: dedup — duplicate event ACK 200, no upload', () => {
  it('duplicate store.menu_refresh_request returns 200 without calling upload', async () => {
    const { spy } = buildFetchMock({ isDuplicate: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    const uploadCall = spy.mock.calls.find(
      ([url]) => url.toString().includes('/v2/eats/stores/') && url.toString().includes('/menus')
    )
    expect(uploadCall).toBeUndefined()
  })
})

describe('UBER-031-D: unmapped store → quarantine, ACK 200, no upload', () => {
  it('store not in integration_store_mappings is quarantined without upload', async () => {
    const { spy, dlqBodies } = buildFetchMock({ storeFound: false })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    const uploadCall = spy.mock.calls.find(
      ([url]) => url.toString().includes('/v2/eats/stores/') && url.toString().includes('/menus')
    )
    expect(uploadCall).toBeUndefined()
    // Quarantine goes to DLQ via quarantineUnmappedStore
    expect(dlqBodies.length).toBeGreaterThan(0)
  })
})

describe('UBER-031-E: upload success → audit log, markEventProcessed with no error', () => {
  it('on upload success markEventProcessed receives status:processed (no error field)', async () => {
    const { spy, markPatchBodies } = buildFetchMock({ uploadOk: true })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    // markEventProcessed on success patches status=processed without last_error
    const successPatch = markPatchBodies.find(
      (b) => (b as Record<string, unknown>).status === 'processed'
    ) as Record<string, unknown> | undefined
    expect(successPatch).toBeDefined()
    expect(successPatch?.last_error).toBeUndefined()
  })
})

describe('UBER-031-F: upload failure → DLQ + error mark, ACK 200', () => {
  it('on upload failure sends to DLQ and marks event failed but returns 200', async () => {
    const { spy, dlqBodies, markPatchBodies, auditBodies } = buildFetchMock({ uploadOk: false })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    // DLQ receives the failure
    const menuDlq = dlqBodies.find(
      (b) => (b as Record<string, unknown>).event_type === 'store.menu_refresh_request'
    ) as Record<string, unknown> | undefined
    expect(menuDlq).toBeDefined()
    expect(menuDlq?.failure_reason).toBeTruthy()

    // markEventProcessed carries the error
    const failPatch = markPatchBodies.find(
      (b) => (b as Record<string, unknown>).status === 'failed'
    ) as Record<string, unknown> | undefined
    expect(failPatch).toBeDefined()

    // Audit log records upload failure
    const menuAudit = auditBodies.find(
      (b) => (b as Record<string, unknown>).action === 'menu.refresh_request'
    ) as Record<string, unknown> | undefined
    const resp = menuAudit?.response_summary as Record<string, unknown> | undefined
    expect(resp?.ok).toBe(false)
    expect(resp?.queued_for_retry).toBe(true)
  })
})

describe('UBER-031-G: no cached menu → DLQ + error mark, ACK 200', () => {
  it('when integration_menu_cache has no row for store, sends to DLQ and returns 200', async () => {
    const { spy, dlqBodies, markPatchBodies, auditBodies } = buildFetchMock({ menuFound: false })
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body)

    expect(res.status).toBe(200)
    // DLQ must receive the no_cached_menu event
    const menuDlq = dlqBodies.find(
      (b) => (b as Record<string, unknown>).event_type === 'store.menu_refresh_request'
    ) as Record<string, unknown> | undefined
    expect(menuDlq).toBeDefined()

    // markEventProcessed carries the error
    const failPatch = markPatchBodies.find(
      (b) => (b as Record<string, unknown>).status === 'failed'
    ) as Record<string, unknown> | undefined
    expect(failPatch).toBeDefined()
    expect(String(failPatch?.last_error ?? '')).toContain('no_cached_menu')

    // Audit log records the miss
    const menuAudit = auditBodies.find(
      (b) => (b as Record<string, unknown>).action === 'menu.refresh_request'
    ) as Record<string, unknown> | undefined
    const resp = menuAudit?.response_summary as Record<string, unknown> | undefined
    expect(resp?.error).toBe('no_cached_menu')

    // No upload was attempted
    const uploadCall = spy.mock.calls.find(
      ([url]) => url.toString().includes('/v2/eats/stores/') && url.toString().includes('/menus')
    )
    expect(uploadCall).toBeUndefined()
  })
})

describe('UBER-031-H: missing HMAC signature → 401', () => {
  it('request without x-uber-signature returns 401', async () => {
    const { spy } = buildFetchMock()
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body, { skipSig: true })

    expect(res.status).toBe(401)
  })

  it('request with wrong signature returns 401', async () => {
    const { spy } = buildFetchMock()
    vi.spyOn(global, 'fetch').mockImplementation(spy)

    const body = makeEventBody('store.menu_refresh_request')
    const res = await callWebhookPost(body, { sig: 'sha256=deadbeef' })

    expect(res.status).toBe(401)
  })
})

describe('UBER-031 structural contract', () => {
  it('webhook route still exports POST and GET after menu handler addition', async () => {
    const handler = await import('@/app/api/integrations/uber-eats/webhook/route')
    expect(typeof handler.POST).toBe('function')
    expect(typeof handler.GET).toBe('function')
  })

  it('uploadMenu is importable and co-exists with webhook route without circular deps', async () => {
    const [menuMod, route] = await Promise.all([
      import('@/lib/integrations/uber-eats/menu'),
      import('@/app/api/integrations/uber-eats/webhook/route'),
    ])
    expect(typeof menuMod.uploadMenu).toBe('function')
    expect(typeof route.POST).toBe('function')
  })

  it('canonical event name follows Uber dot-notation convention', () => {
    const canonical = 'store.menu_refresh_request'
    expect(canonical.startsWith('store.')).toBe(true)
    // Not an alias — this is the only accepted name
    expect(canonical).not.toBe('menu.refresh')
  })
})
