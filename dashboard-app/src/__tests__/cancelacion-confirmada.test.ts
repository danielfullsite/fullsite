import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepararCancelacionItem } from '@/lib/cancelacion-item'
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => ({ clientId: 'lab', staffId: 'cashier' }), unauthorized: vi.fn() }))
vi.mock('@/lib/shift-token', () => ({ verifyShiftToken: vi.fn() }))
import { POST } from '@/app/api/pos/cancel-item/route'
const order = () => ({ id: 'order', order_revision: 4, updated_at: '2026-09-10T00:00:00Z',
  status: 'enviada', items: [{ id: 'cancel', subtotal: 50 }, { id: 'keep', subtotal: 100 }],
  subtotal: 150, descuento: 15, iva: 10.8, total: 145.8, saldo: 145.8, pagos: [] })
// Estas banderas cambian el contrato de autorización. La prueba no puede depender
// de que otro archivo haya dejado el proceso en GRACE o en modo estricto.
beforeEach(() => {
  vi.stubEnv('CANCEL_APPROVAL_STRICT', '')
  vi.stubEnv('POS_APPROVAL_STRICT', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('cancelación con importes canónicos', () => {
  it('persiste la disposición explícita sin devolver ingredientes preparados', () => {
    // undefined → retain_consumption (antes 'pending', que bloqueaba la orden entera).
    for (const [prepared, disposition] of [[true, 'retain_consumption'], [false, 'return_stock'], [undefined, 'retain_consumption']] as const) {
      const result = prepararCancelacionItem(order(), 'cancel', { prepared, voided: false, reason: 'Motivo confirmado' })
      expect(JSON.parse(result.patch!.items)[0]).toMatchObject({ cancelled: true, inventory_disposition: disposition, voided: false, cancellation_reason: 'Motivo confirmado' })
    }
  })
  it('conserva la tasa registrada y distribuye descuento e IVA en centavos', () => {
    const result = prepararCancelacionItem(order(), 'cancel')
    expect(result.patch).toMatchObject({ subtotal: 100, descuento: 10, iva: 7.2, total: 97.2, saldo: 97.2 })
    expect(JSON.parse(result.patch!.items)[0].cancelled).toBe(true)
    const last = prepararCancelacionItem({ ...order(), ...result.patch }, 'keep')
    expect(last.patch).toMatchObject({ subtotal: 0, descuento: 0, iva: 0, total: 0, saldo: 0 })
  })
  it('rechaza importes ausentes, inconsistentes o cuentas parcialmente pagadas', () => {
    for (const changes of [{ subtotal: undefined }, { total: 150 }, { iva: -1 }, { descuento: 160 },
      { pagos: [{ monto: 1 }] }, { payment_status: 'parcial' }, { saldo: 140 }, { status: 'pagada' }]) {
      expect(() => prepararCancelacionItem({ ...order(), ...changes }, 'cancel')).toThrow()
    }
  })
  it('un reintento no vuelve a descontar el renglón cancelado', () => {
    const first = prepararCancelacionItem(order(), 'cancel')
    expect(prepararCancelacionItem({ ...order(), ...first.patch }, 'cancel')).toMatchObject({ alreadyApplied: true, patch: null })
  })
})
it('persiste todos los importes con OCC y devuelve exactamente la fila confirmada; un reintento no produce otro PATCH', async () => {
  let current = order()
  const writes: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      expect(url).toContain('updated_at=eq.')
      expect(init.headers).toMatchObject({ Prefer: 'return=representation' })
      const patch = JSON.parse(String(init.body)); writes.push(patch)
      current = { ...current, ...patch }
      return Response.json([current])
    }
    if (init?.method === 'POST') return Response.json({})
    return Response.json([current])
  }))
  const request = () => new Request('http://test/api/pos/cancel-item', { method: 'POST', body: JSON.stringify({ order_id: 'order', item_id: 'cancel', offline_approved: true }) }) as any
  const result = await (await POST(request())).json()
  expect(result.order).toEqual(current)
  expect(result.revision).toBe(5)
  expect(writes[0]).toMatchObject({ subtotal: 100, descuento: 10, iva: 7.2, total: 97.2, saldo: 97.2, order_revision: 5 })
  expect(await (await POST(request())).json()).toMatchObject({ already_applied: true, revision: 5, order: current })
  expect(writes).toHaveLength(1)
})
it('el conflicto de OCC no devuelve una fila ni una revisión inventadas', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'PATCH' ? [] : [order()])))
  const result = await (await POST(new Request('http://test/api/pos/cancel-item', { method: 'POST', body: JSON.stringify({ order_id: 'order', item_id: 'cancel', offline_approved: true }) }) as any)).json()
  expect(result.conflict).toBe(true)
  expect(result.order).toBeUndefined()
  expect(result.revision).toBeUndefined()
})

it('CANCEL_APPROVAL_STRICT no permite que offline_approved salte la aprobación', async () => {
  vi.stubEnv('CANCEL_APPROVAL_STRICT', 'true')
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const response = await POST(new Request('http://test/api/pos/cancel-item', {
    method: 'POST', body: JSON.stringify({ order_id: 'order', item_id: 'cancel', offline_approved: true }),
  }) as unknown as Parameters<typeof POST>[0])
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' })
  expect(fetchMock).not.toHaveBeenCalled()
})
