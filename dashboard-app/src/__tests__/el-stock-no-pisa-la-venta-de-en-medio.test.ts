import { afterEach, describe, it, expect, vi } from 'vitest'
import { recordMovement, type MovementRequest } from '@/lib/inventory'
const request: MovementRequest = { client_id: 'a', actor: 'browser-name', movement_type: 'entry',
  idempotency_key: 'stable-operation', lines: [{ ingredient_id: 'ingredient', quantity: 40, unit_cost: 2 }] }
const receipt = { success: true, movements_created: 1, stock_updates: 1, cost_updates: 1,
  errors: [], was_duplicate: false, details: [{ ingredient_id: 'ingredient', stock_before: 9, stock_after: 49, cost_before: 1, cost_after: 1.8163265306 }] }
afterEach(() => vi.unstubAllGlobals())
describe('stock, costo y ledger se confirman en una sola transacción', () => {
  it('envía el delta al contrato autenticado y devuelve los importes confirmados', async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => Response.json(receipt)); vi.stubGlobal('fetch', fetcher)
    expect(await recordMovement(request)).toEqual(receipt)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('/api/pos/inventory/movement')
    expect(JSON.parse(options.body as string)).toEqual(request)
    expect(options.headers).toMatchObject({ 'x-fullsite-tenant': 'a' })
  })
  it('una respuesta perdida se reintenta con identidad exacta y no produce PATCH alternativo', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('lost ACK'))
      .mockResolvedValueOnce(Response.json({ ...receipt, was_duplicate: true }))
    vi.stubGlobal('fetch', fetcher)
    expect((await recordMovement(request)).success).toBe(false)
    const result = await recordMovement(request)
    expect(result.success).toBe(true); expect(result.was_duplicate).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
    expect(fetcher.mock.calls.every(([url]) => url === '/api/pos/inventory/movement')).toBe(true)
  })
  it('rechaza cantidades no finitas antes de serializarlas a null', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await recordMovement({ ...request, lines: [{ ingredient_id: 'ingredient', quantity: NaN }] })).success).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('insuficiencia o fallo transaccional nunca se reporta como éxito parcial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'INSUFFICIENT_STOCK' }, { status: 409 })))
    const result = await recordMovement(request)
    expect(result.success).toBe(false); expect(result.movements_created).toBe(0)
    expect(result.stock_updates).toBe(0); expect(result.errors).toEqual(['INSUFFICIENT_STOCK'])
  })
  it('no acepta un HTTP 200 sin recibo de negocio válido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))
    expect((await recordMovement(request)).success).toBe(false)
  })
})
