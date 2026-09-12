import { beforeEach, describe, expect, it } from 'vitest'
import { guardarBorradorPOS } from '@/lib/pos-draft'

const TTL_MS = 4 * 60 * 60 * 1000
const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
}
const items = [{ id: 'a', nombre: 'CEVICHE DE ATÚN', cantidad: 1 }]
const payload = { items, orderId: 'order-1', mesero: 'Aldo', personas: 2 }
const read = () => JSON.parse(values.get('pos_draft_5')!)

describe('draft del POS — el TTL mide edición real', () => {
  beforeEach(() => values.clear())

  it('reabrir o restaurar la mesa no rejuvenece el borrador', () => {
    const firstEdit = 1_000_000
    guardarBorradorPOS(5, payload, storage, firstEdit)
    for (let hour = 1; hour <= 20; hour++) {
      guardarBorradorPOS(5, payload, storage, firstEdit + hour * 60 * 60 * 1000)
    }
    expect(read().ts).toBe(firstEdit)
    expect(firstEdit + 20 * 60 * 60 * 1000 - read().ts).toBeGreaterThan(TTL_MS)
  })

  it('agregar un platillo sí reinicia el reloj', () => {
    guardarBorradorPOS(5, payload, storage, 1_000_000)
    guardarBorradorPOS(5, { ...payload, items: [...items, { id: 'b', nombre: 'SOPA', cantidad: 1 }] }, storage, 2_000_000)
    expect(read().ts).toBe(2_000_000)
  })

  it('cambiar mesero, personas o cantidad también cuenta como edición', () => {
    const changes = [
      { ...payload, mesero: 'Daniel' },
      { ...payload, personas: 3 },
      { ...payload, items: [{ ...items[0], cantidad: 2 }] },
    ]
    changes.forEach((changed, index) => {
      values.clear()
      guardarBorradorPOS(5, payload, storage, 1_000_000)
      guardarBorradorPOS(5, changed, storage, 2_000_000 + index)
      expect(read().ts).toBe(2_000_000 + index)
    })
  })

  it('un valor anterior corrupto se reemplaza con un borrador válido', () => {
    values.set('pos_draft_5', '{roto')
    guardarBorradorPOS(5, payload, storage, 3_000_000)
    expect(read()).toMatchObject({ ...payload, ts: 3_000_000 })
  })
})
