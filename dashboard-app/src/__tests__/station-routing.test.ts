import { describe, it, expect } from 'vitest'
import { splitOrderByStation } from '@/lib/printer'
import { getStationForItem, getStationByName, TIEMPO_ITEM_ID } from '@/lib/pos-constants'
import type { Order, OrderItem } from '@/lib/pos-data'

// ── Ruteo por estación con item.station persistido ──────────────────────────
// Bug original (2026-06-12): Heineken llegaba a cocina porque ni los keywords
// ni el lookup estático MENU_CATEGORIES conocían items importados de Wansoft.
// Fix: el POS fija item.station al agregar (por categoría real de BD) y todo
// el ruteo downstream (impresión, KDS) lo respeta.

function makeItem(overrides: Partial<OrderItem>): OrderItem {
  return {
    id: 'x1',
    menuItemId: 'ws-123',
    nombre: 'Item',
    precio: 100,
    cantidad: 1,
    modificadores: [],
    notas: '',
    precioExtra: 0,
    subtotal: 100,
    ...overrides,
  } as OrderItem
}

function makeOrder(items: OrderItem[]): Order {
  return {
    id: 'o1',
    mesa: 1,
    mesero: 'Test',
    personas: 2,
    items,
    subtotal: 0,
    iva: 0,
    total: 0,
    metodoPago: '',
    propina: 0,
    timestamp: new Date().toISOString(),
  } as unknown as Order
}

describe('splitOrderByStation con item.station', () => {
  it('respeta item.station explícito aunque el nombre no tenga keywords (Heineken)', () => {
    const heineken = makeItem({ nombre: 'HEINEKEN', station: 'barra' })
    const result = splitOrderByStation(makeOrder([heineken]))
    expect(result.barra).toHaveLength(1)
    expect(result.cocina).toHaveLength(0)
  })

  it('item.station tiene prioridad sobre keywords del nombre', () => {
    // "cafe" en el nombre normalmente iría a barra, pero station=caja gana
    const item = makeItem({ nombre: 'Cafe grano 250g', station: 'caja' })
    const result = splitOrderByStation(makeOrder([item]))
    expect(result.caja).toHaveLength(1)
    expect(result.barra).toHaveLength(0)
  })

  it('sin station usa fallback (keywords de bebida → barra)', () => {
    const item = makeItem({ nombre: 'Latte Vainilla' })
    const result = splitOrderByStation(makeOrder([item]))
    expect(result.barra).toHaveLength(1)
  })

  it('sin station y sin keywords cae en cocina', () => {
    const item = makeItem({ nombre: 'Platillo Misterioso' })
    const result = splitOrderByStation(makeOrder([item]))
    expect(result.cocina).toHaveLength(1)
  })

  it('separadores de tiempo van a todas las estaciones con platillos', () => {
    const tiempo = makeItem({ id: 't1', menuItemId: TIEMPO_ITEM_ID, nombre: 'XX TIEMPO: 1 XX', precio: 0, subtotal: 0 })
    const comida = makeItem({ id: 'a', nombre: 'Chilaquiles Verdes', station: 'cocina' })
    const bebida = makeItem({ id: 'b', nombre: 'HEINEKEN', station: 'barra' })
    const result = splitOrderByStation(makeOrder([tiempo, comida, bebida]))
    expect(result.cocina.map(i => i.id)).toEqual(['t1', 'a'])
    expect(result.barra.map(i => i.id)).toEqual(['t1', 'b'])
    // caja solo tendría el separador → se limpia
    expect(result.caja).toHaveLength(0)
  })
})

describe('getStationForItem (fijado de station al agregar)', () => {
  it('categorías de alcohol Wansoft → barra', () => {
    for (const cat of ['cerveza', 'vinos', 'licores', 'alcohol']) {
      expect(getStationForItem(cat, 'HEINEKEN')).toBe('barra')
    }
  })

  it('categorías de comida → cocina', () => {
    expect(getStationForItem('chilaquiles', 'Chilaquiles Verdes')).toBe('cocina')
    expect(getStationForItem('promos', 'Promo Desayuno')).toBe('cocina')
  })

  it('categorías market → caja', () => {
    expect(getStationForItem('mkt-amalay', 'Semillas Mix')).toBe('caja')
    expect(getStationForItem('bakery', 'Concha')).toBe('caja')
  })

  it('categoría desconocida usa keywords de bebida como fallback', () => {
    expect(getStationForItem('categoria-rara', 'Jugo Verde')).toBe('barra')
    expect(getStationForItem('categoria-rara', 'Sandwich Club')).toBe('cocina')
  })
})

describe('getStationByName (legacy, solo órdenes viejas sin station)', () => {
  it('clasifica bebidas conocidas', () => {
    expect(getStationByName('Cappuccino Grande')).toBe('barra')
    expect(getStationByName('Limonada Mineral')).toBe('barra')
  })

  it('clasifica panadería/market por keyword', () => {
    expect(getStationByName('Avocado Toast')).toBe('caja')
    expect(getStationByName('Brownie de chocolate')).toBe('caja')
  })

  it('default a cocina', () => {
    expect(getStationByName('Enchiladas Suizas')).toBe('cocina')
  })
})
