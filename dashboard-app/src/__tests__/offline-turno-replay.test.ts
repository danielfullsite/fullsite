import { beforeEach, describe, expect, it, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

type Call = { url: string; method: string; body?: Record<string, unknown> }
let calls: Call[] = []
let requestedTurnClosed = true
let activeTurnId: string | null = 'turn-new'
let committedOperation = false

vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return {
    ...real,
    withPOSAuth: async () => ({
      clientId: 'amalay', staffId: 's1', staffName: 'Daniel', role: 'admin', authType: 'session',
    }),
  }
})

function installFetch() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: u, method: init?.method ?? 'GET', body })

    if (u.includes('/rest/v1/pos_turnos?id=eq.turn-old')) {
      return response([{ id: 'turn-old', closed_at: requestedTurnClosed ? '2026-08-30T18:59:14Z' : null, location_id: 'amalay-spgg' }])
    }
    if (u.includes('/rest/v1/pos_save_operations')) {
      return response(committedOperation ? [{ state: 'COMMITTED' }] : [])
    }
    if (u.includes('/rest/v1/pos_turnos?client_id=eq.amalay')) {
      return response(activeTurnId ? [{ id: activeTurnId }] : [])
    }
    if (u.includes('/rest/v1/rpc/r1_save_order')) {
      return response({ ok: true, revision: 1, first_execution: false, idempotent_replay: committedOperation })
    }
    return response([])
  })
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

async function save(extra: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/pos/save-order/route')
  return POST({
    json: async () => ({
      order_id: 'order-offline', expected_revision: 0, turno_id: 'turn-old',
      save_operation_id: 'save-1', status: 'enviada', total: 100,
      captured_at: '2026-08-30T20:15:00.000Z',
      ...extra,
    }),
  } as unknown as import('next/server').NextRequest)
}

beforeEach(() => {
  vi.resetModules()
  calls = []
  requestedTurnClosed = true
  activeTurnId = 'turn-new'
  committedOperation = false
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  installFetch()
})

describe('offline replay cannot mutate a closed cash shift', () => {
  it('moves a brand-new queued order only to the open shift at the same location', async () => {
    const res = await save()
    expect(res.status).toBe(200)

    const rpc = calls.find(c => c.url.includes('/rest/v1/rpc/r1_save_order'))
    expect(rpc?.body?.p_turno_id).toBe('turn-new')

    const supplemental = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/pos_orders'))
    expect(supplemental?.body?.captured_at).toBe('2026-08-30T20:15:00.000Z')
  })

  it('preserves the queue as a conflict when no replacement shift is open', async () => {
    activeTurnId = null
    const res = await save()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, conflict: true, error: 'TURN_CLOSED_NO_ACTIVE' })
    expect(calls.some(c => c.url.includes('/rest/v1/rpc/'))).toBe(false)
  })

  it('does not silently move an update or payment to another shift', async () => {
    const res = await save({ expected_revision: 2, status: 'cerrada' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'TURN_CLOSED_CONFLICT' })
    expect(calls.some(c => c.url.includes('/rest/v1/rpc/'))).toBe(false)
  })

  it('does not overwrite capture provenance on an existing order update', async () => {
    requestedTurnClosed = false
    const res = await save({ expected_revision: 2 })
    expect(res.status).toBe(200)
    const supplemental = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/pos_orders'))
    expect(supplemental?.body?.captured_at).toBeUndefined()
  })

  it('does not move a late sync captured before the old shift closed', async () => {
    const res = await save({ captured_at: '2026-08-30T18:30:00.000Z' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'TURN_CLOSED_CONFLICT' })
    expect(calls.some(c => c.url.includes('/rest/v1/rpc/'))).toBe(false)
  })

  it('fails closed for legacy queue items without a capture timestamp', async () => {
    const res = await save({ captured_at: null })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'TURN_CLOSED_CONFLICT' })
  })

  it('allows an already-committed operation to return idempotently after the shift closes', async () => {
    committedOperation = true
    const res = await save()
    expect(res.status).toBe(200)
    const rpc = calls.find(c => c.url.includes('/rest/v1/rpc/r1_save_order'))
    expect(rpc?.body?.p_turno_id).toBe('turn-old')
  })
})
