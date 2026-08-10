// BUG-019-C — server-mediated turno for server-owned QR drafts.
// Exercises the REAL save-order handler + turno resolver; only fetch (the network
// boundary) is mocked. Proves the contract:
//  - normal POS order with null turno → rejected (DB check; asserted in the SQL harness)
//  - a QR draft transition out of 'abierta' resolves the caller's turno SERVER-SIDE
//    and never trusts a client-supplied turno_id;
//  - enviar/cobrar sin turno abierto → rechazado (409 NO_OPEN_TURNO), sin efectos;
//  - staff acceptance assigns the turno and reconciles exactly once;
//  - idempotent replay does NOT re-fire inventory effects.
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for request + fetch */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isQrDraftId, resolveOpenTurnoId } from '@/lib/turno'

const URLBASE = 'https://staging.supabase.co'
const SERVICE = 'SERVICE_KEY_SENTINEL'
const ANON = 'ANON_KEY_SENTINEL'

interface Call { url: string; method: string; body: any; authorization: string | null; apikey: string | null }
let calls: Call[] = []

// Route fetch by (url, method). `openTurnos` lets each test control the tenant turno state.
function installFetch(opts: { openTurnos: Array<{ id: string; opened_by: string }>; save?: any; lineage?: any }) {
  const save = opts.save ?? { ok: true, first_execution: true, revision: 1 }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    const h = new Headers(init?.headers as HeadersInit)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: u, method, body, authorization: h.get('authorization'), apikey: h.get('apikey') })
    const json = (b: any) => ({ ok: true, status: 200, json: async () => b } as unknown as Response)
    if (u.includes('/auth/v1/user')) return json({ id: 'user-amalay' })
    if (u.includes('/rest/v1/client_users')) return json([{ client_id: 'amalay', role: 'dueño' }])
    if (u.includes('/rest/v1/pos_turnos')) return json(opts.openTurnos)
    if (u.includes('/rpc/r1_save_order')) return json(save)
    if (u.includes('/rpc/r1_reconcile_order')) return json([{ r_item_id: 'i1', r_result: 'RECONCILED', r_applied: 1, r_delta: -1 }])
    if (u.includes('/rest/v1/pos_orders') && method === 'GET') return json([{ last_inventory_processed_revision: opts.lineage ?? null, last_inventory_complete_revision: null }])
    return json([]) // pos_orders PATCH (comanda) etc.
  })
}

function makeReq(body: any) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer user-token' : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

const saveRpcCall = () => calls.find(c => c.url.includes('/rpc/r1_save_order'))
const reconcileCalls = () => calls.filter(c => c.url.includes('/rpc/r1_reconcile_order'))
const turnoLookups = () => calls.filter(c => c.url.includes('/rest/v1/pos_turnos'))

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); calls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  delete process.env.SHIFT_TOKEN_SECRET // force the supabase-session auth path
})

describe('turno resolver (pure)', () => {
  it('isQrDraftId: qr- draft vs real uuid order', () => {
    expect(isQrDraftId('qr-deadbeef')).toBe(true)
    expect(isQrDraftId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    expect(isQrDraftId('')).toBe(false)
  })
  it('resolves the OPEN turno, preferring the one the caller opened', async () => {
    const fetchFn = (async () => ({ ok: true, json: async () => [
      { id: 't-other', opened_by: 'someone-else' },
      { id: 't-mine', opened_by: 'user-amalay' },
    ] })) as unknown as typeof fetch
    expect(await resolveOpenTurnoId(URLBASE, SERVICE, 'amalay', 'user-amalay', fetchFn)).toBe('t-mine')
  })
  it('returns null when the tenant has NO open turno', async () => {
    const fetchFn = (async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
    expect(await resolveOpenTurnoId(URLBASE, SERVICE, 'amalay', 'user-amalay', fetchFn)).toBeNull()
  })
})

describe('save-order — QR draft adoption assigns the SESSION turno server-side', () => {
  it('staff send of a QR draft resolves the open turno and reconciles exactly once', async () => {
    installFetch({ openTurnos: [{ id: 't-amalay', opened_by: 'user-amalay' }] })
    const { POST } = await import('@/app/api/pos/save-order/route')
    const res = await POST(makeReq({ order_id: 'qr-deadbeef', expected_revision: 0, status: 'enviada', turno_id: 't-FORGED', items: [] }))
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(j.ok).toBe(true)
    expect(turnoLookups().length).toBe(1)                         // resolved server-side
    expect(saveRpcCall()!.body.p_turno_id).toBe('t-amalay')       // session turno, NOT 't-FORGED'
    expect(reconcileCalls().length).toBe(1)                       // effects exactly once
  })

  it('staff send WITHOUT an open turno → 409 NO_OPEN_TURNO, no save, no effects', async () => {
    installFetch({ openTurnos: [] })
    const { POST } = await import('@/app/api/pos/save-order/route')
    const res = await POST(makeReq({ order_id: 'qr-deadbeef', expected_revision: 0, status: 'enviada', turno_id: 't-FORGED', items: [] }))
    const j = await res.json()
    expect(res.status).toBe(409)
    expect(j.error).toBe('NO_OPEN_TURNO')
    expect(saveRpcCall()).toBeUndefined()                         // never sent
    expect(reconcileCalls().length).toBe(0)                       // nothing off the books
  })

  it('QR draft edit that stays abierta keeps it turno-null (server-owned draft, ignores client turno)', async () => {
    installFetch({ openTurnos: [{ id: 't-amalay', opened_by: 'user-amalay' }] })
    const { POST } = await import('@/app/api/pos/save-order/route')
    const res = await POST(makeReq({ order_id: 'qr-deadbeef', expected_revision: 0, status: 'abierta', turno_id: 't-FORGED', items: [] }))
    expect(res.status).toBe(200)
    expect(turnoLookups().length).toBe(0)                         // no transition → no resolution
    expect(saveRpcCall()!.body.p_turno_id).toBeNull()            // draft stays turno-null
  })

  it('normal POS order is unchanged: server never overrides its client turno_id', async () => {
    installFetch({ openTurnos: [{ id: 't-amalay', opened_by: 'user-amalay' }] })
    const { POST } = await import('@/app/api/pos/save-order/route')
    const res = await POST(makeReq({ order_id: '550e8400-e29b-41d4-a716-446655440000', expected_revision: 0, status: 'enviada', turno_id: 't-amalay', items: [] }))
    expect(res.status).toBe(200)
    expect(turnoLookups().length).toBe(0)                         // not a QR draft
    expect(saveRpcCall()!.body.p_turno_id).toBe('t-amalay')       // passthrough
  })

  it('idempotent replay does NOT re-fire inventory effects (exactly-once)', async () => {
    installFetch({ openTurnos: [{ id: 't-amalay', opened_by: 'user-amalay' }], save: { ok: true, idempotent_replay: true, revision: 1 }, lineage: 1 })
    const { POST } = await import('@/app/api/pos/save-order/route')
    const res = await POST(makeReq({ order_id: 'qr-deadbeef', expected_revision: 1, status: 'enviada', save_operation_id: 'op-1', items: [] }))
    expect(res.status).toBe(200)
    expect(reconcileCalls().length).toBe(0)                       // already processed rev 1 → no re-fire
  })
})
