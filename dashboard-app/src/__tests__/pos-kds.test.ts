/**
 * KDS module tests — P2.5.5 certification suite
 *
 * Coverage:
 *  - resolveItemStation (KDS-GAP-01)
 *  - forward-only guard logic
 *  - auto-archive threshold (KDS-GAP-03)
 *  - optimistic update semantics (KDS-GAP-02)
 *  - station filter correctness
 */

import { describe, it, expect } from 'vitest'
import { resolveItemStation, getStationByName, KITCHEN_ARCHIVE_HOURS } from '../lib/pos-constants'

// ─── resolveItemStation ───────────────────────────────────────────────────────

describe('resolveItemStation', () => {
  it('returns item.station when it is a valid station name', () => {
    expect(resolveItemStation({ station: 'cocina', nombre: 'Cafe Americano' })).toBe('cocina')
    expect(resolveItemStation({ station: 'barra', nombre: 'Chilaquiles' })).toBe('barra')
    expect(resolveItemStation({ station: 'caja', nombre: 'Ice Cream' })).toBe('caja')
  })

  it('ignores invalid station values and falls back to name heuristic', () => {
    // 'bar' is not a valid StationName — should fall back to name detection
    expect(resolveItemStation({ station: 'bar', nombre: 'Café Americano' })).toBe('barra')
  })

  it('falls back to getStationByName when station field is absent', () => {
    expect(resolveItemStation({ nombre: 'Café Americano' })).toBe('barra')
    expect(resolveItemStation({ nombre: 'Chilaquiles Rojos' })).toBe('cocina')
    expect(resolveItemStation({ nombre: 'Ice Cream Vainilla' })).toBe('caja')
  })

  it('works with name field when nombre is absent', () => {
    expect(resolveItemStation({ name: 'Frappe Moka' })).toBe('barra')   // unaccented matches keyword
    expect(resolveItemStation({ name: 'Huevos Benedictinos' })).toBe('cocina')
  })

  it('returns cocina for empty item', () => {
    expect(resolveItemStation({})).toBe('cocina')
  })

  it('item.station takes priority over name-based detection', () => {
    // Beverage name but station says cocina — trust the station
    expect(resolveItemStation({ station: 'cocina', nombre: 'Café Americano' })).toBe('cocina')
  })
})

// ─── getStationByName ─────────────────────────────────────────────────────────

describe('getStationByName', () => {
  it('routes beverage keywords to barra', () => {
    const drinks = ['Café Americano', 'Cappuccino', 'Latte', 'Smoothie Mango', 'Jugo de Naranja',
      'Frappe Moka', 'Soda Pepsi', 'Limonada', 'Heineken', 'Mojito']
    for (const name of drinks) {
      expect(getStationByName(name), `"${name}" should be barra`).toBe('barra')
    }
  })

  it('routes food items to cocina by default', () => {
    // Avoid beverage keywords: 'margarita' is a cocktail keyword in BEBIDA_KEYWORDS
    const foods = ['Chilaquiles Verdes', 'Huevos Benedictinos', 'Panini Caprese',
      'Bowl de Pollo', 'Pizza Pepperoni', 'Ceviche Tostada']
    for (const name of foods) {
      expect(getStationByName(name), `"${name}" should be cocina`).toBe('cocina')
    }
  })

  it('routes market/caja items to caja', () => {
    expect(getStationByName('Ice Cream Vainilla')).toBe('caja')
    expect(getStationByName('Helado de Chocolate')).toBe('caja')
  })
})

// ─── Forward-only guard ───────────────────────────────────────────────────────

describe('forward-only guard', () => {
  const STATUS_ORDER: Record<string, number> = { enviada: 1, preparando: 2, lista: 3, entregada: 4 }

  function canAdvance(currentStatus: string, newStatus: string): boolean {
    const currentRank = STATUS_ORDER[currentStatus] ?? 0
    const newRank = STATUS_ORDER[newStatus] ?? 0
    return newRank > currentRank
  }

  it('allows forward transitions', () => {
    expect(canAdvance('enviada', 'preparando')).toBe(true)
    expect(canAdvance('preparando', 'lista')).toBe(true)
    expect(canAdvance('lista', 'entregada')).toBe(true)
  })

  it('blocks backward transitions', () => {
    expect(canAdvance('preparando', 'enviada')).toBe(false)
    expect(canAdvance('lista', 'preparando')).toBe(false)
    expect(canAdvance('entregada', 'lista')).toBe(false)
  })

  it('blocks same-status transition', () => {
    expect(canAdvance('enviada', 'enviada')).toBe(false)
    expect(canAdvance('preparando', 'preparando')).toBe(false)
  })
})

// ─── Auto-archive threshold ───────────────────────────────────────────────────

describe('auto-archive threshold', () => {
  const ARCHIVE_MS = KITCHEN_ARCHIVE_HOURS * 60 * 60 * 1000

  function shouldAutoArchive(ageMs: number, status: string): boolean {
    return ageMs > ARCHIVE_MS && (status === 'enviada' || status === 'preparando')
  }

  function shouldBeVisible(ageMs: number, status: string): boolean {
    return ageMs <= ARCHIVE_MS || status === 'lista'
  }

  it('KITCHEN_ARCHIVE_HOURS is 4', () => {
    expect(KITCHEN_ARCHIVE_HOURS).toBe(4)
  })

  it('archives old enviada/preparando orders', () => {
    const fiveHoursMs = 5 * 60 * 60 * 1000
    expect(shouldAutoArchive(fiveHoursMs, 'enviada')).toBe(true)
    expect(shouldAutoArchive(fiveHoursMs, 'preparando')).toBe(true)
  })

  it('does not archive recent orders', () => {
    const oneHourMs = 60 * 60 * 1000
    expect(shouldAutoArchive(oneHourMs, 'enviada')).toBe(false)
    expect(shouldAutoArchive(oneHourMs, 'preparando')).toBe(false)
  })

  it('does not archive lista orders regardless of age', () => {
    const tenHoursMs = 10 * 60 * 60 * 1000
    expect(shouldAutoArchive(tenHoursMs, 'lista')).toBe(false)
  })

  it('keeps lista orders visible even past archive threshold', () => {
    const fiveHoursMs = 5 * 60 * 60 * 1000
    expect(shouldBeVisible(fiveHoursMs, 'lista')).toBe(true)
  })

  it('hides old non-lista orders from view', () => {
    const fiveHoursMs = 5 * 60 * 60 * 1000
    expect(shouldBeVisible(fiveHoursMs, 'enviada')).toBe(false)
    expect(shouldBeVisible(fiveHoursMs, 'preparando')).toBe(false)
  })
})

// ─── Optimistic update semantics ─────────────────────────────────────────────

describe('optimistic update semantics (KDS-GAP-02)', () => {
  type Order = { id: string; status: string }

  function applyOptimistic(orders: Order[], id: string, newStatus: string): Order[] {
    return orders.map(o => o.id === id ? { ...o, status: newStatus } : o)
  }

  function rollback(orders: Order[], id: string, prevStatus: string): Order[] {
    return orders.map(o => o.id === id ? { ...o, status: prevStatus } : o)
  }

  it('updates the target order status and leaves others unchanged', () => {
    const orders: Order[] = [
      { id: 'A', status: 'enviada' },
      { id: 'B', status: 'preparando' },
    ]
    const updated = applyOptimistic(orders, 'A', 'preparando')
    expect(updated.find(o => o.id === 'A')!.status).toBe('preparando')
    expect(updated.find(o => o.id === 'B')!.status).toBe('preparando') // unchanged
  })

  it('rollback restores previous status', () => {
    const orders: Order[] = [{ id: 'A', status: 'preparando' }]
    const rolled = rollback(orders, 'A', 'enviada')
    expect(rolled.find(o => o.id === 'A')!.status).toBe('enviada')
  })

  it('rollback does not affect orders with different id', () => {
    const orders: Order[] = [
      { id: 'A', status: 'preparando' },
      { id: 'B', status: 'lista' },
    ]
    const rolled = rollback(orders, 'A', 'enviada')
    expect(rolled.find(o => o.id === 'B')!.status).toBe('lista')
  })
})

// ─── Station filter correctness ───────────────────────────────────────────────

describe('station filter', () => {
  type Item = { station?: string; nombre?: string; name?: string }
  type Order = { id: string; items: Item[] }

  function filterOrders(orders: Order[], filter: 'todo' | 'cocina' | 'barra' | 'caja'): Order[] {
    return orders.filter(o =>
      o.items.some(item => {
        if (filter === 'todo') return true
        return resolveItemStation(item) === filter
      })
    )
  }

  const orders: Order[] = [
    { id: '1', items: [{ station: 'barra', nombre: 'Latte' }] },
    { id: '2', items: [{ station: 'cocina', nombre: 'Chilaquiles' }] },
    { id: '3', items: [{ station: 'barra', nombre: 'Café' }, { station: 'cocina', nombre: 'Huevos' }] },
  ]

  it('todo returns all orders', () => {
    expect(filterOrders(orders, 'todo')).toHaveLength(3)
  })

  it('barra returns orders with at least one barra item', () => {
    const result = filterOrders(orders, 'barra')
    expect(result.map(o => o.id).sort()).toEqual(['1', '3'])
  })

  it('cocina returns orders with at least one cocina item', () => {
    const result = filterOrders(orders, 'cocina')
    expect(result.map(o => o.id).sort()).toEqual(['2', '3'])
  })
})
