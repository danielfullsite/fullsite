import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withPOSAuth } from '@/lib/api-auth'
import { POST } from '@/app/api/pos/inventory-movement/route'

vi.mock('@/lib/api-auth', () => ({ withPOSAuth: vi.fn(), unauthorized: () => Response.json({ error: 'No autorizado' }, { status: 401 }) }))
const command = { client_id: 'inventory-lab', actor: 'Untrusted browser label', idempotency_key: 'atomic-test',
  movement_type: 'entry', lines: [{ ingredient_id: 'coffee', quantity: 2, unit_cost: 4 }] }
const auth = { clientId: 'inventory-lab', staffId: 'manager-real', staffName: 'Authenticated manager', role: 'gerente', authType: 'shift_token' as const }
const req = (body: unknown = command) => new NextRequest('https://fullsite.invalid/api/pos/inventory-movement', { method: 'POST', body: JSON.stringify(body) })
function transportResponse(init: RequestInit) {
  const { p_request, p_actor } = JSON.parse(String(init.body))
  return { version: 1, committed: true, operation_id: '11111111-1111-4111-8111-111111111111',
    client_id: p_request.client_id, idempotency_key: p_request.idempotency_key, request_echo: p_request, actor: p_actor,
    stock_scope: 'tenant', movements_created: 1, stock_updates: 1, cost_updates: 1, was_duplicate: false,
    details: [{ ingredient_id: 'coffee', quantity: 2, movement_id: '1', stock_before: 2, stock_after: 4, cost_before: 2, cost_after: 3 }] }
}

describe('inventory movement server boundary', () => {
  beforeEach(() => {
    vi.mocked(withPOSAuth).mockResolvedValue(auth)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid')
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'synthetic-server-key')
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('stamps actor and tenant from verified auth and makes one PostgREST RPC request', async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => Response.json(transportResponse(init))); vi.stubGlobal('fetch', transport)
    const response = await POST(req())
    expect(response.status).toBe(200); expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0]).toBe('https://synthetic.invalid/rest/v1/rpc/record_inventory_movement_atomic')
    const body = JSON.parse(String(transport.mock.calls[0][1].body))
    expect(body.p_actor).toEqual({ client_id: auth.clientId, id: auth.staffId, name: auth.staffName, role: auth.role, auth_type: auth.authType })
    expect(body.p_request.actor).toBe('Untrusted browser label')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['mesero', 'cajero', 'capitan', 'member', 'unknown'])('requires manager regardless of grace environment for %s', async role => {
    vi.mocked(withPOSAuth).mockResolvedValue({ ...auth, role }); vi.stubEnv('MARKET_ROLE_STRICT', 'false')
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    expect((await POST(req())).status).toBe(403); expect(transport).not.toHaveBeenCalled()
  })

  it('rejects missing identity, another tenant and forged actor fields before RPC', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    vi.mocked(withPOSAuth).mockResolvedValue(null); expect((await POST(req())).status).toBe(401)
    vi.mocked(withPOSAuth).mockResolvedValue(auth)
    expect((await POST(req({ ...command, client_id: 'another-tenant' }))).status).toBe(403)
    expect((await POST(req({ ...command, p_actor: { id: 'forged' } }))).status).toBe(400)
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects a mixed browser session actor before inventory can be committed', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport)
    const request = req(); request.headers.set('x-fullsite-inventory-actor', 'different-browser-user')
    const result = await POST(request)
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: 'INVENTORY_ACTOR_MISMATCH', outcome: 'not_executed' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('receipt recovery selects only the lookup RPC and accepts a scoped absence observation', async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const { p_request, p_actor } = JSON.parse(String(init.body))
      return Response.json({ version: 1, found: false, client_id: p_request.client_id,
        idempotency_key: p_request.idempotency_key, request_echo: p_request, actor: p_actor })
    }); vi.stubGlobal('fetch', transport)
    const request = new NextRequest('https://fullsite.invalid/api/pos/inventory-movement?receipt_only=true', { method: 'POST', body: JSON.stringify(command) })
    expect((await POST(request)).status).toBe(200)
    expect(transport.mock.calls[0][0]).toBe('https://synthetic.invalid/rest/v1/rpc/get_inventory_movement_receipt')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('never claims success for generic upstream OK or another authenticated actor receipt', async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const receipt = transportResponse(init); receipt.actor.id = 'forged'; return Response.json(receipt)
    }); vi.stubGlobal('fetch', transport)
    expect((await POST(req())).status).toBe(502); expect((await POST(req())).status).toBe(502)
  })

  it('returns controlled conflict without exposing SQL internals or retrying partial writes', async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ message: 'INVENTORY_IDEMPOTENCY_CONFLICT' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ message: 'sensitive upstream connection details' }, { status: 500 }))
    vi.stubGlobal('fetch', transport)
    const conflict = await POST(req()); expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'INVENTORY_IDEMPOTENCY_CONFLICT', outcome: 'rejected' })
    const unavailable = await POST(req()); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ error: 'INVENTORY_RPC_UNAVAILABLE' })
    expect(transport).toHaveBeenCalledTimes(2)
  })
})
