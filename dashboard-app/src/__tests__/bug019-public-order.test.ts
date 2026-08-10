// BUG-019-C — secure public order: repricing/validation + abierta creation + idempotency.
/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks (fetch router, tampered lines) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { priceSubmission, normalizeSubmissionId, publicOrderId, MAX_QTY } from '@/lib/public-order'

const CID = 'amalay'
const menu = new Map<string, any>([
  ['it1', { id: 'it1', client_id: CID, name: 'Latte', price: 50, active: true, category_id: 'c1' }],
  ['it0', { id: 'it0', client_id: CID, name: 'Zero', price: 0, active: true, category_id: 'c1' }],
  ['itX', { id: 'itX', client_id: CID, name: 'Inactive', price: 30, active: false, category_id: 'c1' }],
])
const mods = new Map<string, any>([
  ['m1', { id: 'm1', client_id: CID, group_id: 'g1', name: 'Deslactosada', price: 10, active: true }],
  ['mF', { id: 'mF', client_id: CID, group_id: 'gForeign', name: 'Foreign', price: 5, active: true }],
])
const allowed = new Map<string, Set<string>>([['it1', new Set(['g1'])]])
let n = 0
const genId = () => `line-${++n}`
beforeEach(() => { n = 0 })

describe('priceSubmission — server reprices, ignores browser price', () => {
  it('uses canonical price even if the browser injects a fake price/total', () => {
    const line: any = { menu_item_id: 'it1', qty: 2, precio: 0.01, subtotal: 0.02, total: 0.02 }
    const r = priceSubmission([line], menu, mods, allowed, genId, 0.16)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.items[0].precio).toBe(50)          // canonical, not 0.01
      expect(r.items[0].subtotal).toBe(100)       // 50 * 2
      expect(r.subtotal).toBe(100)
      expect(r.iva).toBeCloseTo(16)               // 16%
      expect(r.total).toBeCloseTo(116)
    }
  })
  it('accepts a valid modifier and adds its canonical price', () => {
    const r = priceSubmission([{ menu_item_id: 'it1', qty: 1, modifier_ids: ['m1'] }], menu, mods, allowed, genId, 0.16)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.items[0].precioExtra).toBe(10); expect(r.items[0].subtotal).toBe(60) }
  })
  it('rejects foreign/invalid modifier (not valid for the item)', () => {
    expect(priceSubmission([{ menu_item_id: 'it1', qty: 1, modifier_ids: ['mF'] }], menu, mods, allowed, genId, 0.16))
      .toEqual({ ok: false, error: 'invalid_modifier' })
    expect(priceSubmission([{ menu_item_id: 'it1', qty: 1, modifier_ids: ['nope'] }], menu, mods, allowed, genId, 0.16))
      .toEqual({ ok: false, error: 'invalid_modifier' })
  })
  it('rejects unknown/inactive/zero-price items', () => {
    expect(priceSubmission([{ menu_item_id: 'nope', qty: 1 }], menu, mods, allowed, genId, 0.16).ok).toBe(false)
    expect(priceSubmission([{ menu_item_id: 'itX', qty: 1 }], menu, mods, allowed, genId, 0.16).ok).toBe(false)
    expect(priceSubmission([{ menu_item_id: 'it0', qty: 1 }], menu, mods, allowed, genId, 0.16).ok).toBe(false)
  })
  it('bounds quantity (0, negative, absurd, non-int all rejected)', () => {
    for (const q of [0, -1, MAX_QTY + 1, 1.5, NaN]) {
      expect(priceSubmission([{ menu_item_id: 'it1', qty: q as number }], menu, mods, allowed, genId, 0.16))
        .toEqual({ ok: false, error: 'invalid_quantity' })
    }
  })
  it('truncates oversized notes and empty order rejected', () => {
    const r = priceSubmission([{ menu_item_id: 'it1', qty: 1, notas: 'x'.repeat(500) }], menu, mods, allowed, genId, 0.16)
    expect(r.ok).toBe(true); if (r.ok) expect(r.items[0].notas.length).toBe(280)
    expect(priceSubmission([], menu, mods, allowed, genId, 0.16)).toEqual({ ok: false, error: 'empty_order' })
  })
})

describe('submission id + deterministic order id', () => {
  it('normalizes uuid / 48-hex and rejects junk', () => {
    expect(normalizeSubmissionId('a'.repeat(48))).toBe('a'.repeat(48))
    expect(normalizeSubmissionId('11111111-2222-3333-4444-555555555555')).toBe('11111111222233334444555555555555')
    expect(normalizeSubmissionId('short')).toBeNull()
    expect(normalizeSubmissionId("'; DROP TABLE")).toBeNull()
    expect(normalizeSubmissionId(123)).toBeNull()
  })
  it('namespaces the order id with qr- (cannot collide with a real uuid order)', () => {
    expect(publicOrderId('abc')).toBe('qr-abc')
  })
})

describe('createPublicOrder — abierta, no side effects, idempotent', () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks() })

  function mockFetch(insertReturns: any[], existingReturns: any[] = []) {
    const calls: { url: string; body?: any }[] = []
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : undefined })
      const u = String(url)
      if (u.includes('/pos_mesas')) return json([{ client_id: 'amalay', location_id: 'amalay-spgg', number: 7 }])
      if (u.includes('/pos_menu_items')) return json([{ id: 'it1', client_id: 'amalay', name: 'Latte', price: 50, active: true, category_id: 'c1' }])
      if (u.includes('/pos_modifiers')) return json([])
      if (u.includes('/pos_item_modifier_groups')) return json([])
      if (u.includes('/pos_category_modifiers')) return json([])
      if (u.includes('/clients')) return json([{ iva_rate: 0.16 }])
      if (u.includes('/pos_orders') && opts?.method === 'POST') return json(insertReturns)
      if (u.includes('/pos_orders')) return json(existingReturns) // GET existing
      return json([])
    })
    vi.stubGlobal('fetch', fetchMock)
    return { calls, fetchMock }
  }
  const json = (b: any) => ({ ok: true, status: 200, json: async () => b } as any)

  it('creates status=abierta with server totals and NO kitchen side effects', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    const { calls } = mockFetch([{ id: 'qr-deadbeef', status: 'abierta', mesa: 7, total: 116 }])
    const { createPublicOrder } = await import('@/lib/public-order')
    const res = await createPublicOrder('a'.repeat(48), {
      submission_id: 'deadbeef'.repeat(4), items: [{ menu_item_id: 'it1', qty: 2, precio: 0.01 } as any],
    }, () => 'lid')
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('abierta')
    const insert = calls.find(c => c.url.includes('/pos_orders') && c.body)!.body
    expect(insert.status).toBe('abierta')       // never 'enviada'
    expect(insert.mesero).toBe('QR')
    expect(insert.turno_id).toBeNull()
    expect(insert.comanda_batches).toEqual({})  // no comanda batch
    expect(insert.total).toBeCloseTo(116)       // server price, not 0.01
    expect(insert.client_id).toBe('amalay')     // server-derived from token
    // Only pos_orders was written; nothing touched print jobs / reconcile / bridge.
    const writes = calls.filter(c => c.body).map(c => c.url)
    expect(writes.every(u => u.includes('/pos_orders'))).toBe(true)
    expect(calls.some(c => c.url.includes('pos_print_jobs') || c.url.includes('rpc/r1_reconcile') || c.url.includes('/events'))).toBe(false)
  })

  it('replay (duplicate) returns the existing order, not a second one', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    // insert returns [] (ignore-duplicates), GET returns existing (even if already sent)
    mockFetch([], [{ id: 'qr-deadbeef', status: 'enviada', mesa: 7, total: 116 }])
    const { createPublicOrder } = await import('@/lib/public-order')
    const res = await createPublicOrder('a'.repeat(48), { submission_id: 'deadbeef'.repeat(4), items: [{ menu_item_id: 'it1', qty: 2 }] }, () => 'lid')
    expect(res.status).toBe(200)
    expect(res.body.order_id).toBe('qr-deadbeef') // same order, no duplicate
  })

  it('invalid token -> generic 404', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    vi.stubGlobal('fetch', vi.fn(async () => json([]))) // pos_mesas returns no row
    const { createPublicOrder } = await import('@/lib/public-order')
    const res = await createPublicOrder('a'.repeat(48), { submission_id: 'd'.repeat(48), items: [{ menu_item_id: 'it1', qty: 1 }] }, () => 'lid')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not_found' })
  })
})
