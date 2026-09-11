// The old GET + PATCH + rollback route is replaced by a single transaction.
// SQL failure must never fall back to removing the item through direct PATCH.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const auth = vi.hoisted(() => ({ clientId: 'tenant-lab', role: 'mesero' }))
const approval = vi.hoisted(() => ({ cid: 'tenant-lab', rol: 'gerente', nam: 'Ana', sub: 'supervisor' }))
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => auth, unauthorized: () => new Response(null, { status: 401 }) }))
vi.mock('@/lib/shift-token', () => ({ verifyShiftToken: async (token: string) => token === 'signed-lab' ? approval : null }))
import { POST } from '@/app/api/pos/transfer-item/route'
const request = (extra = {}) => new NextRequest('http://localhost/api/pos/transfer-item', { method: 'POST',
  body: JSON.stringify({ source_order_id: 'src', item_id: 'i1', target_mesa: 7, operation_id: 'stable-op', approval_token: 'signed-lab', ...extra }) })
beforeEach(() => {
  approval.cid = 'tenant-lab'; approval.rol = 'gerente'
  process.env.SUPABASE_SERVICE_KEY = 'synthetic-test-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9999'
})
afterEach(() => vi.unstubAllGlobals())
describe('transferencia atómica autorizada', () => {
  it('si falla la transacción no hay PATCH de origen ni compensación', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ message: 'target unavailable' }, { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(request())).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toContain('/rpc/r1_transfer_item_atomic')
  })
  it('el recibo perdido exige reintentar la misma identidad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost response') }))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('TRANSFER_UNCONFIRMED')
  })
  it('la identidad del tenant y aprobador salen de tokens, no del cuerpo', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, source_order: { id: 'src' }, target_order: { id: 'dst' } }))
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(request({ client_id: 'otro', approved_by: 'forjado' }))).status).toBe(200)
    const input = JSON.parse(fetcher.mock.calls[0][1].body as string)
    expect(input).toMatchObject({ p_client_id: 'tenant-lab', p_actor: 'Ana', p_operation_id: 'stable-op' })
  })
  it.each(['forjado', ''])('no acepta aprobación %s declarada por cliente', async token => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await POST(request({ approval_token: token, approved_role: 'admin' }))).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rechaza supervisor de otro restaurante antes de escribir', async () => {
    approval.cid = 'otro'
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await POST(request())).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rechaza un token firmado de mesero como aprobación', async () => {
    approval.rol = 'mesero'
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await POST(request())).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
