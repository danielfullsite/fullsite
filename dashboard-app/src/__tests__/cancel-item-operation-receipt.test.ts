import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticate = vi.hoisted(() => vi.fn())
const reconcile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: authenticate,
  unauthorized: () => Response.json({}, { status: 401 }),
}))
vi.mock('@/lib/inventory-reconcile-server', () => ({ reconciliarInventarioConfirmado: reconcile }))
vi.mock('@/lib/shift-token', () => ({ verifyShiftToken: vi.fn() }))
import { POST } from '@/app/api/pos/cancel-item/route'

const request = (extra: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/pos/cancel-item', {
  method: 'POST', body: JSON.stringify({ order_id: 'order-1', item_id: 'item-1', operation_id: 'cancel-op-1',
    prepared: true, voided: false, reason: 'Error de captura', ...extra }),
})

beforeEach(() => {
  authenticate.mockResolvedValue({ clientId: 'tenant-a', staffId: 'manager-1', staffName: 'Gerente', role: 'gerente' })
  reconcile.mockResolvedValue({ inventory_pending: false, inventory_status: 'COMPLETE' })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('recibo durable de cancelación', () => {
  it('recupera un ACK perdido aunque la orden actual ya no conserve el renglón', async () => {
    const receipt = { ok: true, revision: 7, item_name: 'Platillo', order: { id: 'order-1', order_revision: 7 } }
    const fetcher = vi.fn(async (_url: string) => Response.json([{
      client_id: 'tenant-a', operation_id: 'cancel-op-1',
      intent: { order_id: 'order-1', item_id: 'item-1', prepared: true, voided: false, reason: 'Error de captura' },
      result: receipt,
    }]))
    vi.stubGlobal('fetch', fetcher)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ...receipt, already_applied: true, inventory_status: 'COMPLETE' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toContain('/pos_cancel_item_operations?')
  })

  it('rechaza reutilizar la identidad con otro artículo antes de tocar la orden', async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json([{
      intent: { order_id: 'order-1', item_id: 'otro', prepared: true, voided: false, reason: 'Error de captura' },
      result: { ok: true },
    }]))
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: 'OPERATION_ID_REUSED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
