import { afterEach, expect, it, vi } from 'vitest'
import { confirmarCancelacionItem } from '@/lib/cancelacion-cliente'
const intent = { client_id: 'lab', order_id: 'order', item_id: 'item', reason: 'Error', manager: 'Manager', mesero: 'Waiter', prepared: true, voided: false }
const receipt = { ok: true, revision: 5, inventory_pending: true,
  order: { id: 'order', order_revision: 5, items: [{ id: 'item', cancelled: true, inventory_disposition: 'retain_consumption', cancellation_reason: 'Error' }] } }
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each([409, 502])('HTTP %s never yields a confirmation or writes stock', async status => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: false, error: 'REJECTED' }, { status }))
  vi.stubGlobal('fetch', request)
  await expect(confirmarCancelacionItem(intent, {}, 'manager-token')).rejects.toThrow('REJECTED')
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('/api/pos/cancel-item')
  expect(JSON.stringify(localStorage)).not.toContain('manager-token')
})
it('a lost acknowledgment retains the immutable operation and original options across another visit', async () => {
  const bodies: any[] = []
  let lost = true
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    if (lost) { lost = false; throw new Error('ACK lost after commit') }
    return Response.json(receipt)
  }))
  await expect(confirmarCancelacionItem(intent, {}, 'first-approval')).rejects.toThrow('sin confirmar')
  const retry = await confirmarCancelacionItem({ ...intent, reason: 'New draft reason', voided: true }, {}, 'fresh-approval')
  expect(retry.recovered).toBe(true)
  expect(retry.intent.reason).toBe('Error')
  expect(retry.intent.voided).toBe(false)
  expect(bodies[0].operation_id).toBe(bodies[1].operation_id)
  expect(bodies[1].approval_token).toBe('fresh-approval')
  expect(retry.result.inventory_pending).toBe(true)
  expect(retry.item).toMatchObject({ inventory_disposition: 'retain_consumption', cancellation_reason: 'Error' })
  retry.confirmada()
  expect(localStorage.length).toBe(0)
})
it('sin prueba firmada conserva el intento pero ni siquiera llama al servidor', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  await expect(confirmarCancelacionItem(intent, {})).rejects.toThrow('Autoriza con PIN')
  expect(request).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(1)
})
it('does not reinterpret a missing or transferred item as another cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...receipt, order: { ...receipt.order, items: [{ id: 'other' }] } })))
  await expect(confirmarCancelacionItem(intent, {}, 'manager-token')).rejects.toThrow('ya no pertenece')
  expect(localStorage.length).toBe(0)
})
