import { afterEach, describe, expect, it, vi } from 'vitest'
import { leerCuenta, seleccionarCuenta, cuentaConfirmada, aOrdenesDelSalon, type LecturaDelSalon } from '@/lib/pedro-cliente'
import { localNetworkFetch } from '@/lib/local-network-fetch'
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:8721' }))
afterEach(() => vi.resetAllMocks())
const order = { id: 'A', mesa: 7, status: 'entregada', total: 116, saldo: 100,
  order_revision: 4, personas: 3, customer_name: null, items: [{ id: 'item-A', nombre: 'Sopa' }] }
const snapshot = (ordenes: Record<string, unknown>[], completa = true): LecturaDelSalon => ({
  autoritativa: true, completa, procedencia: 'caja', sequence: 12, turno: { id: 'shift' }, ordenes,
})

describe('same operational account from every POS', () => {
  it('delivered order comes from complete salon rather than empty kitchen and skips stale cache on custom ports', async () => {
    vi.mocked(localNetworkFetch).mockResolvedValue(new Response(JSON.stringify({
      authoritative: true, order_snapshot_complete: true, salon_orders: [order], kds_orders: [], sequence: 12,
    })))
    const found = await leerCuenta({ mesa: 7 })
    expect(found.estado).toBe('existente')
    expect(found.orden).toEqual(order)
    expect(cuentaConfirmada(found)).toBe(true)
    expect(localNetworkFetch).toHaveBeenCalledWith('http://127.0.0.1:8721/state', expect.objectContaining({ cache: 'no-store' }))
  })
  it('named accounts retain name, guests, revision and remaining balance in the salon', () => {
    const named = { ...order, mesa: 0, customer_name: 'SR RAUL' }
    expect(seleccionarCuenta(snapshot([named]), { mesa: 0, customerName: 'SR RAUL' }).orden?.id).toBe('A')
    expect(aOrdenesDelSalon([named])[0]).toMatchObject({ customer_name: 'SR RAUL', personas: 3, saldo: 100, order_revision: 4 })
  })
  it('ID pins the account even if another order takes the same mesa', () => {
    const newer = { ...order, id: 'B' }
    expect(seleccionarCuenta(snapshot([newer]), { mesa: 7, orderId: 'A' }).estado).toBe('cerrada')
    expect(seleccionarCuenta(snapshot([newer, order]), { mesa: 7, orderId: 'A' }).orden?.id).toBe('A')
    expect(seleccionarCuenta(snapshot([newer, order]), { mesa: 7 }).estado).toBe('incierta')
  })
  it('actually empty item arrays retain existing order identity and revision', () => {
    const found = seleccionarCuenta(snapshot([{ ...order, items: [] }]), { mesa: 7 })
    expect(found.estado).toBe('existente')
    expect(found.orden?.items).toEqual([])
    expect(cuentaConfirmada(found)).toBe(true)
  })
  it.each([undefined, 'broken json', { invalid: true }])('missing/corrupt items never turn an occupied mesa into an empty new account (%j)', items => {
    const found = seleccionarCuenta(snapshot([{ ...order, items }]), { mesa: 7 })
    expect(found.estado).toBe('incierta')
    expect(found.orden).toBeNull()
  })
  it('only a complete authoritative snapshot can prove an empty mesa', () => {
    expect(seleccionarCuenta(snapshot([]), { mesa: 7 }).estado).toBe('libre')
    expect(seleccionarCuenta(snapshot([], false), { mesa: 7 }).estado).toBe('incierta')
    expect(seleccionarCuenta({ ...snapshot([]), autoritativa: false }, { mesa: 7 }).estado).toBe('incierta')
  })
  it.each([401, 403, 503])('HTTP %s forbids creating/charging even if cached state used to be empty', async status => {
    vi.mocked(localNetworkFetch).mockResolvedValue(new Response('{}', { status }))
    const found = await leerCuenta({ mesa: 7 })
    expect(found.estado).toBe('incierta')
    expect(found.lectura.autoritativa).toBe(false)
    expect(cuentaConfirmada(found)).toBe(false)
  })
  it('network loss and invalid JSON are unknown, not empty', async () => {
    vi.mocked(localNetworkFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('not json'))
    expect((await leerCuenta({ mesa: 7 })).estado).toBe('incierta')
    expect((await leerCuenta({ mesa: 7 })).estado).toBe('incierta')
  })
  it('legacy complete items may be read but missing revision cannot authorize payment', () => {
    const found = seleccionarCuenta(snapshot([{ ...order, order_revision: undefined }]), { mesa: 7 })
    expect(found.estado).toBe('existente')
    expect(cuentaConfirmada(found)).toBe(false)
  })
})
