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
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Response.json([{ ...order, ...JSON.parse(String(init.body)) }])
      if (init?.method === 'POST') return Response.json({})
      return Response.json([order])
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request())
    expect(response.status).toBe(200)
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(write[0]).toContain('client_id=eq.tenant-a')
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
