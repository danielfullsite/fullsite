import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, withPOSAuth: authenticate, unauthorized: () => Response.json({}, { status: 401 }) }
})
vi.mock('@/lib/inventory-reconcile-server', () => ({
  reconciliarInventarioConfirmado: async () => ({ inventory_pending: false, inventory_status: 'COMPLETE' }),
}))
import { POST } from '@/app/api/pos/cancel-item/route'

const request = () => new NextRequest('http://localhost/api/pos/cancel-item', {
  method: 'POST', body: JSON.stringify({ order_id: 'order-1', item_id: 'item-1', operation_id: 'cancel-op-1' }),
})
const order = { id: 'order-1', client_id: 'tenant-a', order_revision: 2, updated_at: '2026-09-12T10:00:00Z',
  status: 'enviada', items: [{ id: 'item-1', subtotal: 10, cantidad: 1 }], subtotal: 10,
  descuento: 0, iva: 1.6, total: 11.6, saldo: 11.6, pagos: [] }

beforeEach(() => {
  authenticate.mockResolvedValue({ clientId: 'tenant-a', staffId: 'owner-1', staffName: 'Dueño', role: 'dueño' })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-public')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('frontera de cancelación', () => {
  it('un dueño autenticado usa service role y repite tenant en lectura y escritura OCC', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('pos_cancel_item_operations')) return Response.json([])
      if (url.includes('/rpc/r1_cancel_item_atomic')) {
        const input = JSON.parse(String(init?.body))
        const updated = { ...order, ...input.p_patch }
        return Response.json({ ok: true, revision: updated.order_revision, order: updated })
      }
      return Response.json([order])
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request())
    expect(response.status).toBe(200)
    const write = fetcher.mock.calls.find(([url]) => url.includes('/rpc/r1_cancel_item_atomic'))!
    expect(JSON.parse(String(write[1]?.body))).toMatchObject({ p_client_id: 'tenant-a', p_order_id: 'order-1' })
    expect((write[1]?.headers as Record<string, string>).Authorization).toBe('Bearer service-test')
  })

  it('sin service key falla cerrado antes de leer o mutar', async () => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', '')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: 'CANCEL_UNAVAILABLE' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
