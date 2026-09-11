import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => ({ clientId: 'lab' }), unauthorized: vi.fn() }))
import { POST } from '@/app/api/pos/merge-orders/route'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('devuelve los campos aceptados por la RPC con su revisión, incluido el total validado en servidor', async () => {
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'fixture')
  let accepted: any
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('pos_orders?')) return Response.json([{ total: 100 }, { total: 50 }])
    if (url.endsWith('/r1_merge_orders')) {
      accepted = JSON.parse(String(init?.body))
      return Response.json({ ok: true, target_revision: 8, source_revision: 3 })
    }
    return Response.json([])
  }))
  const items = [{ id: 'one', subtotal: 100 }, { id: 'two', subtotal: 50 }]
  const request = new Request('http://test/api/pos/merge-orders', { method: 'POST', body: JSON.stringify({
    target_order_id: 'target', source_order_id: 'source', target_expected_revision: 7, source_expected_revision: 2,
    merged_items: items, total: 999, subtotal: 150, iva: 0, personas: 2,
  }) })
  const result = await (await POST(request as any)).json()
  expect(result.target_order).toMatchObject({ id: 'target', items, total: 150, order_revision: 8 })
  expect(result.target_order.items).toEqual(accepted.p_merged_items)
  expect(result.target_order.total).toBe(accepted.p_total)
})
