// Tests del inventario Market: lógica pura de descuento retail 1:1.
import { describe, it, expect } from 'vitest'
import { computeMarketDeductions } from '@/lib/pos-data'

const mkt = (ids: string[]) => new Set(ids)
const stock = (entries: [string, number, number?][]) =>
  new Map(entries.map(([id, s, rp]) => [id, { stock: s, reorder_point: rp ?? 0 }]))

describe('computeMarketDeductions', () => {
  it('descuenta 1:1 solo items Market', () => {
    const out = computeMarketDeductions(
      [
        { menuItemId: 'ws-sda030', cantidad: 2 },     // Market
        { menuItemId: 'chilaquiles-v', cantidad: 1 }, // cocina — no Market
      ],
      mkt(['ws-sda030']),
      stock([['ws-sda030', 10]]),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ menu_item_id: 'ws-sda030', cantidad: 2, newStock: 8, faltante: 0 })
  })

  it('agrega cantidades del mismo item en líneas separadas', () => {
    const out = computeMarketDeductions(
      [
        { menuItemId: 'ws-a', cantidad: 1 },
        { menuItemId: 'ws-a', cantidad: 3 },
      ],
      mkt(['ws-a']),
      stock([['ws-a', 5]]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].cantidad).toBe(4)
    expect(out[0].newStock).toBe(1)
  })

  it('nunca deja stock negativo y reporta faltante', () => {
    const out = computeMarketDeductions(
      [{ menuItemId: 'ws-a', cantidad: 5 }],
      mkt(['ws-a']),
      stock([['ws-a', 2]]),
    )
    expect(out[0].newStock).toBe(0)
    expect(out[0].faltante).toBe(3)
  })

  it('item sin fila de stock → stock 0, faltante completo', () => {
    const out = computeMarketDeductions(
      [{ menuItemId: 'ws-nuevo', cantidad: 2 }],
      mkt(['ws-nuevo']),
      stock([]),
    )
    expect(out[0].newStock).toBe(0)
    expect(out[0].faltante).toBe(2)
    expect(out[0].alert).toBe(true) // 0 <= reorder_point 0
  })

  it('alerta cuando cae al punto de reorden', () => {
    const out = computeMarketDeductions(
      [{ menuItemId: 'ws-a', cantidad: 3 }],
      mkt(['ws-a']),
      stock([['ws-a', 5, 2]]),
    )
    expect(out[0].newStock).toBe(2)
    expect(out[0].alert).toBe(true)
  })

  it('sin alerta cuando queda arriba del punto de reorden', () => {
    const out = computeMarketDeductions(
      [{ menuItemId: 'ws-a', cantidad: 1 }],
      mkt(['ws-a']),
      stock([['ws-a', 5, 2]]),
    )
    expect(out[0].newStock).toBe(4)
    expect(out[0].alert).toBe(false)
  })

  it('orden sin items Market → vacío', () => {
    const out = computeMarketDeductions(
      [{ menuItemId: 'cafe-americano', cantidad: 2 }],
      mkt(['ws-a']),
      stock([['ws-a', 5]]),
    )
    expect(out).toHaveLength(0)
  })
})
