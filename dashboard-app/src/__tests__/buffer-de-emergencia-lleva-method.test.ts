// El buffer de emergencia de saveOrder se drena como POST, nunca como PATCH.
//
// Barrido 2026-09-10 (offline-queue LENTE-4): el buffer de localStorage no
// llevaba `method`; drainLocalStorageToIdb lo re-encolaba con el default PATCH y
// /api/pos/save-order (solo exporta POST) respondia 405 → transitorio → reintento
// eterno: el cobro nunca subia y quedaba 'pendiente' sin salida.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'

const store = new Map<string, string>()
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => {
  vi.resetModules()
  store.clear()
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls })
  globalThis.indexedDB = new IDBFactory()
})

describe('drainLocalStorageToIdb', () => {
  it('REGRESION: un item viejo SIN method hacia /api/pos/save-order se encola como POST', async () => {
    store.set('fullsite_offline_queue', JSON.stringify([
      { table: 'pos_orders', data: { order_id: 'A', expected_revision: 0, status: 'cerrada' }, endpoint: '/api/pos/save-order', transport: 'APP_API', timestamp: 1, synced: false },
    ]))
    const db = await import('@/lib/pos-offline-db')
    await db.drainLocalStorageToIdb()
    const cola = await db.getPendingQueue()
    expect(cola).toHaveLength(1)
    expect(cola[0].method).toBe('POST')
    expect(cola[0].endpoint).toBe('/api/pos/save-order')
    expect(store.has('fullsite_offline_queue'), 'el buffer se vacio').toBe(false)
  })

  it('un item REST viejo sin method conserva el default PATCH', async () => {
    store.set('fullsite_offline_queue', JSON.stringify([
      { table: 'pos_turnos', data: { id: 't1' }, endpoint: 'pos_turnos?id=eq.t1', transport: 'SUPABASE_REST', timestamp: 1, synced: false },
    ]))
    const db = await import('@/lib/pos-offline-db')
    await db.drainLocalStorageToIdb()
    expect((await db.getPendingQueue())[0].method).toBe('PATCH')
  })

  it('REGRESION (fuente): el buffer de saveOrder escribe method POST desde el origen', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/pos-data.ts'), 'utf8')
    expect(src).toMatch(/queue\.push\(\{ table: 'pos_orders', method: 'POST', data: payload, endpoint: '\/api\/pos\/save-order'/)
  })
})
