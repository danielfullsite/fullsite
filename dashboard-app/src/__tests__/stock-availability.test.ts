import { describe, it, expect } from 'vitest'
import { hasInventoryBaseline, computeOutOfStockItems } from '@/lib/stock-availability'

describe('hasInventoryBaseline', () => {
  it('sin ningún insumo positivo = no hay línea base', () => {
    expect(hasInventoryBaseline([{ ingredient_id: 'a', stock: 0 }, { ingredient_id: 'b', stock: -6 }])).toBe(false)
  })
  it('un solo insumo positivo ya cuenta como línea base', () => {
    expect(hasInventoryBaseline([{ ingredient_id: 'a', stock: 0 }, { ingredient_id: 'b', stock: 3 }])).toBe(true)
  })
  it('sin filas = no hay línea base', () => {
    expect(hasInventoryBaseline([])).toBe(false)
  })
  it('PostgREST devuelve numeric como STRING — no romper', () => {
    expect(hasInventoryBaseline([{ ingredient_id: 'a', stock: '5.000000' }])).toBe(true)
    expect(hasInventoryBaseline([{ ingredient_id: 'a', stock: '0.000000' }])).toBe(false)
  })
})

describe('computeOutOfStockItems', () => {
  const recetas = [
    { menu_item_id: 'combo-1', ingredient_id: 'pollo' },
    { menu_item_id: 'combo-1', ingredient_id: 'papa' },
    { menu_item_id: 'refresco', ingredient_id: 'coca' },
  ]

  it('EL CASO CHICKIN: cliente nuevo con TODO en 0 puede vender (nada AGOTADO)', () => {
    const rows = [
      { ingredient_id: 'pollo', stock: 0 },
      { ingredient_id: 'papa', stock: 0 },
      { ingredient_id: 'coca', stock: -1 },
    ]
    expect(computeOutOfStockItems(rows, recetas).size).toBe(0)
  })

  it('con línea base real, un insumo en cero SÍ agota su platillo', () => {
    const rows = [
      { ingredient_id: 'pollo', stock: 10 },
      { ingredient_id: 'papa', stock: 0 },
      { ingredient_id: 'coca', stock: 24 },
    ]
    const oos = computeOutOfStockItems(rows, recetas)
    expect(oos.has('combo-1')).toBe(true)
    expect(oos.has('refresco')).toBe(false)
  })

  it('con línea base, stock negativo también agota', () => {
    const rows = [
      { ingredient_id: 'pollo', stock: 10 },
      { ingredient_id: 'papa', stock: 5 },
      { ingredient_id: 'coca', stock: -3 },
    ]
    expect(computeOutOfStockItems(rows, recetas).has('refresco')).toBe(true)
  })

  it('todo con stock = nada agotado', () => {
    const rows = [
      { ingredient_id: 'pollo', stock: 10 },
      { ingredient_id: 'papa', stock: 5 },
      { ingredient_id: 'coca', stock: 24 },
    ]
    expect(computeOutOfStockItems(rows, recetas).size).toBe(0)
  })

  it('un insumo sin fila de inventario no agota (no se sabe, no se bloquea)', () => {
    const rows = [{ ingredient_id: 'pollo', stock: 10 }]
    expect(computeOutOfStockItems(rows, recetas).size).toBe(0)
  })
})
