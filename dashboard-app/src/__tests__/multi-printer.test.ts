import { describe, it, expect } from 'vitest'
import { splitOrderByStation } from '@/lib/printer'
import type { Order } from '@/lib/pos-data'

// ─── splitOrderByStation ───────────────────────────────────────────────────

function makeOrder(items: Array<{ nombre: string; menuItemId?: string }>): Order {
  return {
    id: 'test-order-1',
    mesa: '5',
    mesero: 'Test',
    items: items.map((i, idx) => ({
      id: `item-${idx}`,
      menuItemId: i.menuItemId || `mi-${idx}`,
      nombre: i.nombre,
      precio: 100,
      cantidad: 1,
      subtotal: 100,
      modificadores: [],
      notas: '',
      precioExtra: 0,
    })),
    subtotal: items.length * 100,
    descuento: 0,
    iva: items.length * 16,
    total: items.length * 116,
    status: 'open',
    createdAt: new Date().toISOString(),
  }
}

describe('splitOrderByStation', () => {
  it('splits beverage items to barra', () => {
    const order = makeOrder([
      { nombre: 'Cappuccino Grande' },
      { nombre: 'Jugo de Naranja' },
      { nombre: 'Smoothie Verde' },
    ])
    const split = splitOrderByStation(order)
    // All beverages should go to barra (via name fallback since no real menuItemId match)
    expect(split.barra.length).toBe(3)
    expect(split.cocina.length).toBe(0)
    expect(split.caja.length).toBe(0)
  })

  it('splits food items to cocina', () => {
    const order = makeOrder([
      { nombre: 'Chilaquiles Verdes' },
      { nombre: 'Huevos Rancheros' },
    ])
    const split = splitOrderByStation(order)
    // Non-beverage items default to cocina
    expect(split.cocina.length).toBe(2)
    expect(split.barra.length).toBe(0)
  })

  it('handles mixed orders', () => {
    const order = makeOrder([
      { nombre: 'Chilaquiles Rojos' },
      { nombre: 'Café Americano' },
      { nombre: 'Brownie de Chocolate' },
    ])
    const split = splitOrderByStation(order)
    // chilaquiles -> cocina, cafe -> barra, brownie -> cocina (no category match, not a beverage)
    expect(split.cocina.length).toBeGreaterThanOrEqual(1)
    expect(split.barra.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty order', () => {
    const order = makeOrder([])
    const split = splitOrderByStation(order)
    expect(split.cocina.length).toBe(0)
    expect(split.barra.length).toBe(0)
    expect(split.caja.length).toBe(0)
  })
})
