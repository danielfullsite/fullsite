import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deductIngredientsForOrder, reverseIngredientDeduction, type OrderItem } from '@/lib/pos-data'

const item = { id: 'line-a', menuItemId: 'menu-a', nombre: 'Café', cantidad: 2 } as OrderItem
const complete = () => Response.json({ inventory_pending: false, inventory_status: 'COMPLETE' })
beforeEach(() => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'pos_shift_token' ? 'synthetic-shift' : null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('automatic sale inventory uses canonical server reconciliation', () => {
  it('whole-order reversal cannot use current recipes or browser quantities to return stock', async () => {
    const requests = vi.fn(async () => complete())
    vi.stubGlobal('fetch', requests)
    await reverseIngredientDeduction({ ...item, cantidad: 999 }, 'void-a', 'browser-manager', 'void')
    expect(requests).toHaveBeenCalledTimes(1)
    const [url, options] = requests.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/pos/inventory/reconcile')
    expect(JSON.parse(String(options.body))).toEqual({ order_id: 'void-a' })
  })
  it('unresolved cancellation disposition does not report a successful stock return', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ inventory_pending: true, inventory_status: 'PENDING' })))
    await expect(reverseIngredientDeduction(item, 'void-a', 'manager', 'void')).rejects.toThrow('pendiente')
  })
  it('sends only order identity and authenticated session, never supplied items, actor, batch or stock', async () => {
    const requests = vi.fn(async () => complete())
    vi.stubGlobal('fetch', requests)
    const result = await deductIngredientsForOrder([item], 'order-a', 'browser-actor', 'batch-a')
    expect(result.success).toBe(true)
    expect(result.inventory_status).toBe('COMPLETE')
    expect(result.deductions).toEqual([])
    expect(result.resolution.FUZZY_FALLBACK).toEqual([])
    expect(requests).toHaveBeenCalledTimes(1)
    const [url, options] = requests.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/pos/inventory/reconcile')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-shift' })
    expect(JSON.parse(String(options.body))).toEqual({ order_id: 'order-a' })
  })
  it('retries and concurrent calls always reach durable authority, including subsequent batches', async () => {
    const requests = vi.fn(async () => complete())
    vi.stubGlobal('fetch', requests)
    await Promise.all([deductIngredientsForOrder([item], 'order-a', 'A', 'batch-a'), deductIngredientsForOrder([item], 'order-a', 'B', 'batch-a')])
    await deductIngredientsForOrder([item], 'order-a', 'A', 'batch-b')
    expect(requests).toHaveBeenCalledTimes(3)
    for (const call of requests.mock.calls) {
      const [url, options] = call as unknown as [string, RequestInit]
      expect(url).toBe('/api/pos/inventory/reconcile')
      expect(JSON.parse(String(options.body))).toEqual({ order_id: 'order-a' })
    }
  })
  it.each(['PENDING', 'BLOCKED'])('does not label %s inventory successful or invent deductions', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ inventory_pending: true, inventory_status: status })))
    const result = await deductIngredientsForOrder([item], 'order-a', 'A')
    expect(result.success).toBe(false)
    expect(result.inventory_status).toBe(status)
    expect(result.alerts.length).toBeGreaterThan(0)
    expect(result.deductions).toEqual([])
    expect(Object.values(result.resolution).flat()).toEqual([])
  })
  it('a lost response remains pending and the same identity can recover on the next call', async () => {
    const requests = vi.fn().mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(complete())
    vi.stubGlobal('fetch', requests)
    expect((await deductIngredientsForOrder([item], 'order-a', 'A')).success).toBe(false)
    expect((await deductIngredientsForOrder([item], 'order-a', 'A')).success).toBe(true)
    expect(JSON.parse(requests.mock.calls[0][1].body)).toEqual(JSON.parse(requests.mock.calls[1][1].body))
  })
  it.each([
    { inventory_status: 'COMPLETE', inventory_pending: true },
    { success: true }, null, [],
  ])('rejects an unconfirmed response without direct-write fallback: %j', async body => {
    const requests = vi.fn(async () => Response.json(body))
    vi.stubGlobal('fetch', requests)
    const result = await deductIngredientsForOrder([item], 'order-a', 'A')
    expect(result.success).toBe(false)
    expect(result.alerts.length).toBeGreaterThan(0)
    expect(requests).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 500])('HTTP %s is pending and cannot trigger client stock writes', async status => {
    const requests = vi.fn(async () => new Response('', { status }))
    vi.stubGlobal('fetch', requests)
    expect((await deductIngredientsForOrder([item], 'order-a', 'A')).success).toBe(false)
    expect(requests).toHaveBeenCalledTimes(1)
  })
  it('rejects missing order identity without attempting a mutation', async () => {
    const requests = vi.fn()
    vi.stubGlobal('fetch', requests)
    expect((await deductIngredientsForOrder([item], '', 'A')).success).toBe(false)
    expect(requests).not.toHaveBeenCalled()
  })
})
