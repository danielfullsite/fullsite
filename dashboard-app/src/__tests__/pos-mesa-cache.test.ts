// El cache de la mesa recuerda QUÉ orden se encoló y con QUÉ revisión.
// P0 del barrido 2026-09-10 (offline-queue LENTE-2). Ver lib/pos-mesa-cache.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recordarOrdenEncolada } from '@/lib/pos-mesa-cache'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } })
})

describe('recordarOrdenEncolada', () => {
  it('REGRESION: mesa nueva sin red → el cache trae id y revision 1 (antes: {ts, items} sin id)', () => {
    recordarOrdenEncolada(5, { id: 'A', items: [{ id: 'i1' }], mesero: 'Ana', personas: 2, discount: 0, notas: '', revision: 1 })
    const c = JSON.parse(store.get('pos_order_5')!)
    expect(c.id).toBe('A')
    expect(c.revision).toBe(1)
    expect(c.items).toHaveLength(1)
    expect(typeof c.ts).toBe('number')
  })
  it('REGRESION: orden que ya existía (rev 1) + ronda sin red → revision 2, para que el cobro no salga STALE', () => {
    store.set('pos_order_5', JSON.stringify({ id: 'A', revision: 1, items: [{ id: 'i1' }], ts: 1, updatedAt: 'x' }))
    recordarOrdenEncolada(5, { id: 'A', items: [{ id: 'i1' }, { id: 'i2' }], mesero: 'Ana', personas: 2, discount: 0, notas: '', revision: 2 })
    const c = JSON.parse(store.get('pos_order_5')!)
    expect(c.revision).toBe(2)
    expect(c.items).toHaveLength(2)
  })
  it('mesa 0 (cuenta sin mesa) no escribe nada; storage roto no lanza', () => {
    recordarOrdenEncolada(0, { id: 'A', items: [], mesero: '', personas: 1, discount: 0, notas: '', revision: 1 })
    expect(store.size).toBe(0)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') }, setItem: () => {}, removeItem: () => {} })
    expect(() => recordarOrdenEncolada(3, { id: 'A', items: [], mesero: '', personas: 1, discount: 0, notas: '', revision: 1 })).not.toThrow()
  })
  it('REGRESION (fuente): la rama OFFLINE_QUEUED del envío llama recordarOrdenEncolada con order.id y orderRevision + 1', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/pos/page.tsx'), 'utf8')
    const i = src.indexOf("saveResult.error === 'OFFLINE_QUEUED'")
    const rama = src.slice(i, src.indexOf("saveResult.error === 'SESSION_EXPIRED'", i))
    expect(rama).toMatch(/recordarOrdenEncolada\(order\.mesa, \{[\s\S]*id: order\.id[\s\S]*revision: orderRevision \+ 1/)
  })
})

describe('cobro offline: el descuento de market viaja en la cola', () => {
  it('REGRESION (fuente): la rama OFFLINE_QUEUED del cobro encola POST /api/pos/deduct-market para la misma orden', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/pos/page.tsx'), 'utf8')
    const i = src.indexOf("if (!saveResult.ok && saveResult.error === 'OFFLINE_QUEUED') {")
    const rama = src.slice(i, i + 3000)
    expect(rama).toMatch(/queueOperation\('pos_orders', 'POST', \{ order_id: payId, actor: mesero, items: mkt \}, '\/api\/pos\/deduct-market', undefined, 'APP_API'\)/)
  })
})
