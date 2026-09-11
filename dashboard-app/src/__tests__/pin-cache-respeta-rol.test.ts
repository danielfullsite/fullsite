// La cache offline de PINs respeta el rol.
//
// Barrido 2026-09-10 (offline-queue LENTE-6): la cache guarda TODO PIN validado
// online, incluido el de un capitan que autorizo una transferencia (min_role
// capitan). Sin revisar el rol, ese capitan autorizaba anulaciones, descuentos y
// reapertura de corte durante 30 min en cuanto /api/pos/pin no contestaba.
// Online el servidor lo rechaza con 401; offline se aplica la misma regla.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

function servidorQue(responde: (body: Record<string, unknown>) => { ok: boolean; status: number; body?: unknown } | 'sin-red') {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const r = responde(JSON.parse(String(init?.body)))
    if (r === 'sin-red') throw new TypeError('Failed to fetch')
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} } as unknown as Response
  })
}

beforeEach(() => {
  vi.resetModules()
  store.clear()
  store.set('fullsite_client_id', 'amalay')
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls, location: { origin: 'https://pos.local' } })
})

describe('un PIN de capitan cacheado no vale como gerente sin red', () => {
  it('REGRESION: validado online como capitan → offline, verifyManagerPin devuelve null', async () => {
    const pd = await import('@/lib/pos-data')
    // 1. Online, el capitan autoriza una transferencia (min_role capitan).
    servidorQue(() => ({ ok: true, status: 200, body: { staff: { name: 'Cap', role: 'capitan' } } }))
    const cap = await pd.verifyPinWithMinRole('5555', 'capitan')
    expect(cap?.name).toBe('Cap')
    expect(Object.keys(JSON.parse(store.get('pos_manager_pin_cache')!)), 'quedo cacheado').toHaveLength(1)

    // 2. Se cae la red.
    servidorQue(() => 'sin-red')
    expect(await pd.verifyManagerPin('5555'), 'anular orden / descuento: NO').toBeNull()
    expect(await pd.verifyManagerPinWithRole('5555'), 'corte Z: NO').toBeNull()
    expect(await pd.verifyPinWithMinRole('5555', 'gerente'), 'permiso de gerente: NO').toBeNull()
    // Lo que si le toca sigue funcionando sin red.
    expect((await pd.verifyPinWithMinRole('5555', 'capitan'))?.name).toBe('Cap')
    expect((await pd.verifyPinWithMinRole('5555', 'cajero'))?.name).toBe('Cap')
  })

  it('un gerente cacheado si autoriza sin red (el fallback sigue existiendo)', async () => {
    const pd = await import('@/lib/pos-data')
    servidorQue(() => ({ ok: true, status: 200, body: { staff: { name: 'Gte', role: 'gerente' } } }))
    expect(await pd.verifyManagerPin('7777')).toBe('Gte')
    servidorQue(() => 'sin-red')
    expect(await pd.verifyManagerPin('7777')).toBe('Gte')
    expect((await pd.verifyManagerPinWithRole('7777'))?.role).toBe('gerente')
  })

  it('un 503 del servidor tampoco abre la puerta al capitan', async () => {
    const pd = await import('@/lib/pos-data')
    servidorQue(() => ({ ok: true, status: 200, body: { staff: { name: 'Cap', role: 'capitan' } } }))
    await pd.verifyPinWithMinRole('5555', 'capitan')
    servidorQue(() => ({ ok: false, status: 503, body: { error: 'authority_unavailable' } }))
    expect(await pd.verifyManagerPin('5555')).toBeNull()
  })
})
