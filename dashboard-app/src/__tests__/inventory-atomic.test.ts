import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MovementRequest } from '@/lib/inventory'
import { IDBFactory } from 'fake-indexeddb'

const shift = (id = 'manager', tenant = 'inventory-lab', nonce = 1) => Buffer.from(JSON.stringify({ sub: id, cid: tenant, iat: nonce })).toString('base64url') + '.synthetic-signature'
const jwt = 'synthetic-header.' + Buffer.from(JSON.stringify({ sub: 'manager' })).toString('base64url') + '.synthetic-signature'

const command: MovementRequest = { client_id: 'inventory-lab', actor: 'Dashboard', idempotency_key: 'same-operation',
  movement_type: 'entry', lines: [{ ingredient_id: 'coffee', quantity: 2, unit_cost: 4 }] }
function receipt() {
  return { version: 1, committed: true, operation_id: '11111111-1111-4111-8111-111111111111', client_id: command.client_id,
    idempotency_key: command.idempotency_key, stock_scope: 'tenant', request_echo: structuredClone(command),
    actor: { client_id: command.client_id, id: 'manager', name: 'Manager', role: 'gerente', auth_type: 'shift_token' },
    movements_created: 1, stock_updates: 1, cost_updates: 1, was_duplicate: false,
    details: [{ ingredient_id: 'coffee', quantity: 2, movement_id: '123', stock_before: 2, stock_after: 4, cost_before: 2, cost_after: 3 }] }
}

describe('recordMovement — exact atomic receipt boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
    vi.stubGlobal('window', {})
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'pos_shift_token' ? shift() : null })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('preserves POS shift-token callers and sends one immutable request with explicit tenant', async () => {
    const transport = vi.fn(async () => Response.json(receipt())); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    const result = await recordMovement(command)
    expect(result.success).toBe(true); expect(result.receipt?.committed).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/pos/inventory-movement')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${shift()}`, 'x-fullsite-tenant': 'inventory-lab' })
    expect(JSON.parse(String(init.body))).toEqual(command)
  })

  it('uses dashboard JWT when present without replacing it with the shift token', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('sb-') ? JSON.stringify({ access_token: jwt }) : shift() })
    const transport = vi.fn(async () => { const r = receipt(); r.actor.auth_type = 'supabase_session'; return Response.json(r) }); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    expect((await recordMovement(command)).success).toBe(true)
    expect((transport.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: `Bearer ${jwt}` })
  })

  it.each(['generic-ok', 'wrong-key', 'wrong-command', 'missing-details', 'wrong-stock', 'wrong-cost', 'nonfinite', 'uncommitted'])('rejects HTTP 200 with %s receipt; performs no compensating writes', async variant => {
    const response = receipt()
    if (variant === 'wrong-key') response.idempotency_key = 'different'
    if (variant === 'wrong-command') response.request_echo.lines[0].quantity = 4
    if (variant === 'missing-details') response.details = []
    if (variant === 'wrong-stock') response.details[0].stock_after = 2
    if (variant === 'wrong-cost') response.details[0].cost_after = 99
    if (variant === 'nonfinite') response.details[0].cost_after = Infinity
    if (variant === 'uncommitted') response.committed = false
    const transport = vi.fn(async () => Response.json(variant === 'generic-ok' ? { ok: true } : response)); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    const result = await recordMovement(command)
    expect(result.success).toBe(false); expect(result.movements_created).toBe(0)
    expect(result.errors).toEqual(['INVENTORY_RECEIPT_MISMATCH']); expect(transport).toHaveBeenCalledTimes(1)
  })

  it('lost response remains unknown; identical retry accepts original committed receipt', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('Response lost after COMMIT'))
      .mockResolvedValueOnce(Response.json({ ...receipt(), was_duplicate: true }))
    vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    const unknown = await recordMovement(command)
    expect(unknown.success).toBe(false); expect(unknown.errors).toEqual(['INVENTORY_RESULT_UNKNOWN_RETRY_SAME_KEY'])
    const confirmed = await recordMovement(command)
    expect(confirmed.success).toBe(true); expect(confirmed.was_duplicate).toBe(true)
    expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body)
  })

  it('database unavailability fails closed without legacy table INSERT/PATCH fallback', async () => {
    const transport = vi.fn(async () => Response.json({ error: 'INVENTORY_RPC_UNAVAILABLE' }, { status: 503 })); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    expect((await recordMovement(command)).success).toBe(false); expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([NaN, Infinity, -Infinity, 0])('rejects invalid quantity %s before network', async quantity => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    expect((await recordMovement({ ...command, lines: [{ ingredient_id: 'coffee', quantity }] })).success).toBe(false)
    expect(transport).not.toHaveBeenCalled()
  })

  it('does not mistake manual requests for authorized sales depletion or warehouse transfer', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    for (const movement_type of ['deduction', 'transfer_in', 'transfer_out', 'reversal'] as const) {
      expect((await recordMovement({ ...command, movement_type })).errors).toEqual(['INVENTORY_SOURCE_RECEIPT_REQUIRED'])
    }
    expect(transport).not.toHaveBeenCalled()
  })

  it('retains the original key after module reload, renewed token and a fresh timestamp from the form', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('lost after commit')).mockResolvedValueOnce(Response.json({ ...receipt(), was_duplicate: true }))
    vi.stubGlobal('fetch', transport)
    const first = await import('@/lib/inventory')
    expect((await first.recordMovement(command)).success).toBe(false)
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'pos_shift_token' ? shift('manager', 'inventory-lab', 2) : null })
    const restarted = await import('@/lib/inventory')
    const result = await restarted.recordMovement({ ...command, idempotency_key: 'new-click-timestamp' })
    expect(result.success).toBe(true); expect(result.was_duplicate).toBe(true)
    expect(result.receipt?.idempotency_key).toBe(command.idempotency_key)
    expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body)
  })

  it('keeps an ambiguous intent and only inspects the original receipt when the form changes', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('unknown result')); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command)
    const result = await recordMovement({ ...command, idempotency_key: 'edited', lines: [{ ingredient_id: 'coffee', quantity: 3 }] })
    expect(result.errors).toEqual(['INVENTORY_PENDING_OTHER_OPERATION']); expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[1][0]).toBe('/api/pos/inventory-movement?receipt_only=true')
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual(command)
  })

  it.each(['receipt', 'database-rejection', 'fresh-auth-rejection'])('releases intent after %s and permits a distinct operation', async mode => {
    const transport = vi.fn()
    if (mode === 'receipt') transport.mockResolvedValueOnce(Response.json(receipt()))
    else transport.mockResolvedValueOnce(Response.json({ error: 'INVENTORY_INSUFFICIENT_STOCK', outcome: mode === 'database-rejection' ? 'rejected' : 'not_executed' }, { status: 409 }))
    transport.mockResolvedValueOnce(Response.json({ error: 'INVENTORY_TEST_REJECTED', outcome: 'rejected' }, { status: 409 }))
    vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command)
    const second = await recordMovement({ ...command, idempotency_key: 'distinct', lines: [{ ingredient_id: 'coffee', quantity: 3 }] })
    expect(second.errors).toEqual(['INVENTORY_TEST_REJECTED']); expect(transport).toHaveBeenCalledTimes(2)
    expect(JSON.parse(transport.mock.calls[1][1].body).idempotency_key).toBe('distinct')
  })

  it('an expired auth response after ambiguity does not erase the potentially committed intent', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(Response.json({ error: 'INVENTORY_AUTH_REQUIRED', outcome: 'not_executed' }, { status: 401 }))
    vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command); await recordMovement(command)
    const next = await recordMovement({ ...command, idempotency_key: 'edited', lines: [{ ingredient_id: 'coffee', quantity: 9 }] })
    expect(next.errors).toEqual(['INVENTORY_PENDING_OTHER_OPERATION']); expect(transport).toHaveBeenCalledTimes(3)
  })

  it('a changed form can discover the committed original without mutating either payload', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('lost after commit'))
      .mockResolvedValueOnce(Response.json({ ...receipt(), was_duplicate: true }))
      .mockResolvedValueOnce(Response.json({ error: 'INVENTORY_TEST_REJECTED', outcome: 'rejected' }, { status: 409 }))
    vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command)
    const different = { ...command, idempotency_key: 'new-operation', lines: [{ ingredient_id: 'coffee', quantity: 9 }] }
    const discovery = await recordMovement(different)
    expect(discovery.success).toBe(false); expect(discovery.receipt?.idempotency_key).toBe(command.idempotency_key)
    expect(discovery.errors).toEqual(['INVENTORY_PREVIOUS_OPERATION_CONFIRMED_REVIEW_CURRENT'])
    expect(transport.mock.calls[1][0]).toContain('?receipt_only=true')
    await recordMovement(different)
    expect(transport.mock.calls[2][0]).toBe('/api/pos/inventory-movement')
    expect(JSON.parse(transport.mock.calls[2][1].body)).toEqual(different)
  })

  it('an absent receipt never means the earlier intent was cancelled', async () => {
    const absent = { version: 1, found: false, client_id: command.client_id, idempotency_key: command.idempotency_key, request_echo: command, actor: receipt().actor }
    const transport = vi.fn().mockRejectedValueOnce(new Error('network delay')).mockResolvedValueOnce(Response.json(absent))
      .mockResolvedValueOnce(Response.json(receipt()))
    vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command)
    expect((await recordMovement({ ...command, idempotency_key: 'different', lines: [{ ingredient_id: 'coffee', quantity: 9 }] })).errors).toEqual(['INVENTORY_PENDING_OTHER_OPERATION'])
    expect((await recordMovement({ ...command, idempotency_key: 'another-clock-value' })).success).toBe(true)
    expect(JSON.parse(transport.mock.calls[2][1].body).idempotency_key).toBe(command.idempotency_key)
  })

  it('partitions pending intent by authenticated actor and restaurant without storing credentials', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network unavailable')); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    await recordMovement(command)
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'pos_shift_token' ? shift('second-manager') : null })
    await recordMovement({ ...command, idempotency_key: 'second-actor', lines: [{ ingredient_id: 'coffee', quantity: 3 }] })
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'pos_shift_token' ? shift('manager', 'second-tenant') : null })
    await recordMovement({ ...command, client_id: 'second-tenant', idempotency_key: 'second-tenant' })
    expect(transport).toHaveBeenCalledTimes(3)
    const rows = await new Promise<unknown[]>(resolve => {
      const open = indexedDB.open('fullsite-inventory-intents-v1', 1)
      open.onsuccess = () => { const db = open.result, tx = db.transaction('pending'), all = tx.objectStore('pending').getAll(); tx.oncomplete = () => { db.close(); resolve(all.result) } }
    })
    expect(rows).toHaveLength(3); expect(JSON.stringify(rows)).not.toContain('synthetic-signature')
  })

  it('requires durable storage before sending a movement', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    const { recordMovement } = await import('@/lib/inventory')
    expect((await recordMovement(command)).errors).toEqual(['INVENTORY_DURABLE_STORAGE_REQUIRED']); expect(transport).not.toHaveBeenCalled()
  })

  it('concurrent browser callers retain a single key for the same pending intent', async () => {
    const { retainInventoryIntent } = await import('@/lib/inventory-pending-intent')
    const attempts = await Promise.all([
      retainInventoryIntent('same-actor-and-tenant', command),
      retainInventoryIntent('same-actor-and-tenant', { ...command, idempotency_key: 'other-tab-key' }),
    ])
    expect(attempts.filter(a => a.fresh)).toHaveLength(1)
    expect(new Set(attempts.map(a => a.request.idempotency_key)).size).toBe(1)
    expect(attempts.every(a => a.sameIntent)).toBe(true)
  })

  it('a delayed ACK for an old command never deletes the next pending operation', async () => {
    const { retainInventoryIntent, releaseInventoryIntent } = await import('@/lib/inventory-pending-intent')
    const scope = 'same-actor-and-tenant', next = { ...command, idempotency_key: 'next', lines: [{ ingredient_id: 'coffee', quantity: 5 }] }
    await retainInventoryIntent(scope, command); await releaseInventoryIntent(scope, command)
    await retainInventoryIntent(scope, next); await releaseInventoryIntent(scope, command)
    const retained = await retainInventoryIntent(scope, command)
    expect(retained.request).toEqual(next); expect(retained.sameIntent).toBe(false)
  })
})
