import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: authenticate,
  unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
  checkPosRole: (auth: { role: string }) => ({ ok: auth.role === 'gerente', mode: auth.role === 'gerente' ? 'role:gerente' : 'blocked' }),
  POS_ROLE_LVL: { gerente: 4 },
}))
import { POST } from '@/app/api/pos/adjust-market/route'

const request = (extra: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/pos/adjust-market', {
  method: 'POST', body: JSON.stringify({ menu_item_id: 'item-a', adjustment_type: 'entrada', quantity: 5,
    operation_id: 'market-op-1', actor: 'forjado', notes: 'Recepción', ...extra }),
})

beforeEach(() => {
  authenticate.mockResolvedValue({ clientId: 'tenant-a', staffId: 'manager-1', staffName: 'Gerente', role: 'gerente' })
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('ajuste market atómico', () => {
  it('envía identidad estable, tenant y actor verificados a una sola transacción', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, new_stock: 10, delta: 5, was_duplicate: false }))
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request({ client_id: 'otro' }))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://db.example/rest/v1/rpc/r1_adjust_market_stock_atomic')
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      p_client_id: 'tenant-a', p_menu_item_id: 'item-a', p_adjustment_type: 'entrada',
      p_quantity: 5, p_actor: 'manager-1', p_notes: 'Recepción', p_operation_id: 'market-op-1',
    })
  })

  it.each([
    [{ quantity: -1 }, 'INVALID_QUANTITY'],
    [{ quantity: '5' }, 'INVALID_QUANTITY'],
    [{ operation_id: '' }, 'INVALID_PAYLOAD'],
    [{ notes: 'a'.repeat(1001) }, 'INVALID_PAYLOAD'],
  ] as const)('rechaza payload fuera de contrato: %j', async (extra, error) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const response = await POST(request(extra))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('un ACK perdido conserva incertidumbre para repetir la misma operación', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost ACK') }))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: 'MARKET_UNCONFIRMED' })
  })
})
