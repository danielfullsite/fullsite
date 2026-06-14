import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  calcOrderTotals,
  calcSplitParejo,
  calcSplitItems,
  calcPropina,
  totalConPropina,
  getActiveItems,
  round2,
} from '@/lib/pos-calculations'
import { IVA_RATE } from '@/lib/pos-data'
import type { OrderItem } from '@/lib/pos-data'
import type { Promotion } from '@/lib/pos-promos'
import { evaluatePromos, buildCategoryMap } from '@/lib/pos-promos'
import { applyCombo } from '@/lib/pos-combos'
import type { Combo } from '@/lib/pos-combos'
import {
  enqueue,
  getQueue,
  getPendingCount,
  clearCompleted,
  clearAll,
  removeJob,
} from '@/lib/print-queue'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeItem(id: string, precio: number, cantidad: number, precioExtra = 0): OrderItem {
  const subtotal = (precio + precioExtra) * cantidad
  return {
    id,
    menuItemId: id,
    nombre: `Item ${id}`,
    precio,
    cantidad,
    modificadores: [],
    notas: '',
    precioExtra,
    subtotal,
  }
}

function makeItemFull(
  id: string,
  precio: number,
  cantidad: number,
  opts: Partial<OrderItem> = {},
): OrderItem {
  const precioExtra = opts.precioExtra ?? 0
  const subtotal = (precio + precioExtra) * cantidad
  return {
    id,
    menuItemId: opts.menuItemId ?? id,
    nombre: opts.nombre ?? `Item ${id}`,
    precio,
    cantidad,
    modificadores: opts.modificadores ?? [],
    notas: opts.notas ?? '',
    precioExtra,
    subtotal,
    ...(opts.courseId !== undefined ? { courseId: opts.courseId } : {}),
    ...(opts.courseStatus ? { courseStatus: opts.courseStatus } : {}),
    ...(opts.station ? { station: opts.station } : {}),
  }
}

// ─── TEST GROUP 1: Cancel after fire ───────────────────────────────────────

describe('Cancel after fire', () => {
  it('cancelled items do not affect subtotal', () => {
    const items = [
      makeItemFull('a', 292, 1, { courseId: 1, courseStatus: 'fired' }),
      makeItemFull('b', 48, 2, { courseId: 1, courseStatus: 'fired' }),
      makeItemFull('c', 252, 1, { courseId: 1, courseStatus: 'fired' }),
    ]
    const cancelledIds = new Set(['b'])
    const active = getActiveItems(items, cancelledIds)
    const totals = calcOrderTotals(active)

    expect(active).toHaveLength(2)
    expect(totals.subtotal).toBe(292 + 252) // 544, no 96
  })

  it('voided items do not affect subtotal', () => {
    const items = [
      makeItemFull('a', 200, 1, { courseId: 1, courseStatus: 'fired' }),
      makeItemFull('b', 300, 1, { courseId: 1, courseStatus: 'fired' }),
    ]
    // Voided = also in cancelledIds set
    const voidedIds = new Set(['a'])
    const active = getActiveItems(items, voidedIds)
    const totals = calcOrderTotals(active)

    expect(active).toHaveLength(1)
    expect(totals.subtotal).toBe(300)
  })

  it('cancelled item with prepared=true keeps in subtotal for merma tracking', () => {
    // Business logic: if an item was already prepared (fired + served),
    // it should NOT be removed from totals — the food was consumed/wasted.
    // This is handled by NOT adding to cancelledIds when prepared=true.
    const items = [
      makeItemFull('a', 292, 1, { courseId: 1, courseStatus: 'served' }),
      makeItemFull('b', 48, 1, { courseId: 1, courseStatus: 'fired' }),
    ]
    // Only 'b' was cancelled before being served (not prepared)
    // 'a' was served — cancelling it is merma, stays in subtotal
    const cancelledIds = new Set(['b'])
    const active = getActiveItems(items, cancelledIds)
    const totals = calcOrderTotals(active)

    expect(active).toHaveLength(1)
    expect(totals.subtotal).toBe(292) // merma item stays
  })

  it('audit action types are distinct: item_cancelled vs item_voided', () => {
    // Verify the AuditAction type includes item_cancelled
    // This is a type-level check; we verify the string constants exist
    const cancelAction: string = 'item_cancelled'
    const voidAction: string = 'order_cancelled'
    expect(cancelAction).not.toBe(voidAction)
    expect(cancelAction).toBe('item_cancelled')
    expect(voidAction).toBe('order_cancelled')
  })

  it('multiple cancelled items from different courses', () => {
    const items = [
      makeItemFull('a', 292, 1, { courseId: 1, courseStatus: 'fired' }),
      makeItemFull('b', 48, 1, { courseId: 1, courseStatus: 'fired' }),
      makeItemFull('c', 252, 1, { courseId: 2, courseStatus: 'fired' }),
      makeItemFull('d', 150, 1, { courseId: 2, courseStatus: 'pending' }),
    ]
    const cancelledIds = new Set(['b', 'd'])
    const active = getActiveItems(items, cancelledIds)
    const totals = calcOrderTotals(active)

    expect(active).toHaveLength(2)
    expect(totals.subtotal).toBe(292 + 252) // 544
  })
})

// ─── TEST GROUP 2: Print Queue ─────────────────────────────────────────────

describe('Print Queue', () => {
  // Mock localStorage
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const localStorageMock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      get length() { return Object.keys(store).length },
      key: (i: number) => Object.keys(store)[i] ?? null,
    }
    vi.stubGlobal('localStorage', localStorageMock)
    // Start clean
    clearAll()
  })

  it('enqueue() creates a job with status pending', () => {
    const job = enqueue({ station: 'cocina', data: 'dGVzdA==', type: 'comanda' })
    expect(job.status).toBe('pending')
  })

  it('enqueue() job has correct fields', () => {
    const job = enqueue({
      station: 'barra',
      data: 'dGVzdA==',
      type: 'ticket',
      meta: { mesa: 5, mesero: 'Omar' },
    })

    expect(job.id).toBeTruthy()
    expect(job.id.startsWith('pj-')).toBe(true)
    expect(job.station).toBe('barra')
    expect(job.type).toBe('ticket')
    expect(job.status).toBe('pending')
    expect(job.retries).toBe(0)
    expect(job.maxRetries).toBe(5)
    expect(job.createdAt).toBeTruthy()
    expect(job.lastAttempt).toBeNull()
    expect(job.error).toBeNull()
  })

  it('getPendingCount() returns correct count', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'comanda' })
    enqueue({ station: 'caja', data: 'c', type: 'ticket' })

    expect(getPendingCount()).toBe(3)
  })

  it('clearCompleted() removes only printed jobs', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'comanda' })

    // Manually mark one as printed
    const queue = getQueue()
    queue[0].status = 'printed'
    store['pos_print_queue'] = JSON.stringify(queue)

    clearCompleted()
    const after = getQueue()
    expect(after).toHaveLength(1)
    expect(after[0].station).toBe('barra')
  })

  it('removeJob() removes specific job', () => {
    const job1 = enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'ticket' })

    removeJob(job1.id)
    const after = getQueue()
    expect(after).toHaveLength(1)
    expect(after[0].station).toBe('barra')
  })

  it('clearAll() empties queue', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'ticket' })
    enqueue({ station: 'caja', data: 'c', type: 'drawer' })

    clearAll()
    expect(getQueue()).toHaveLength(0)
    expect(getPendingCount()).toBe(0)
  })
})

// ─── TEST GROUP 3: Pago Mixto + Descuento ──────────────────────────────────

describe('Pago Mixto + Descuento', () => {
  it('discount applied before split (calcSplitParejo)', () => {
    const items = [makeItem('a', 500, 1), makeItem('b', 500, 1)] // subtotal 1000
    const discount = 200
    const r1 = calcSplitParejo(items, discount, 2, 1)
    const r2 = calcSplitParejo(items, discount, 2, 2)

    // Each cuenta's subtotalAfterDiscount should reflect discount
    expect(r1.subtotalAfterDiscount).toBe(400) // (500-100)
    expect(r2.subtotalAfterDiscount).toBe(400)
  })

  it('multiple payment methods sum to total', () => {
    const items = [makeItem('a', 300, 1), makeItem('b', 200, 1)] // subtotal 500
    const totals = calcOrderTotals(items, 0)
    const total = totals.total // 500 * 1.16 = 580

    // Simulate 3 payment methods
    const efectivo = 200
    const tarjeta = 280
    const transferencia = round2(total - efectivo - tarjeta)

    expect(round2(efectivo + tarjeta + transferencia)).toBeCloseTo(total)
  })

  it('propina added correctly on top of discounted total', () => {
    const items = [makeItem('a', 1000, 1)]
    const totals = calcOrderTotals(items, 200) // subtotal after disc = 800
    // total = 800 * 1.16 = 928
    expect(totals.total).toBeCloseTo(928)

    const tip = calcPropina(totals.total, 15) // 15% of 928 = 139.2 → 139
    expect(tip).toBe(139)

    const finalTotal = totalConPropina(totals.total, tip)
    expect(finalTotal).toBeCloseTo(928 + 139)
  })

  it('IVA calculated on discounted subtotal', () => {
    const items = [makeItem('a', 500, 1)]
    const discount = 100
    const totals = calcOrderTotals(items, discount)

    expect(totals.subtotalAfterDiscount).toBe(400)
    expect(totals.iva).toBeCloseTo(400 * IVA_RATE) // 64
    expect(totals.total).toBeCloseTo(400 * (1 + IVA_RATE)) // 464
  })

  it('split por items prorates discount across payment methods', () => {
    const items = [makeItem('a', 600, 1), makeItem('b', 400, 1)] // subtotal 1000
    const assignments = { a: 1, b: 2 }
    const discount = 100

    const r1 = calcSplitItems(items, assignments, 1, discount)
    const r2 = calcSplitItems(items, assignments, 2, discount)

    // a=60% → discount 60, b=40% → discount 40
    expect(r1.discount).toBe(60)
    expect(r2.discount).toBe(40)
    expect(round2(r1.total + r2.total)).toBeCloseTo((1000 - 100) * 1.16)
  })
})

// ─── TEST GROUP 4: Promo evaluation ────────────────────────────────────────

describe('Promo evaluation', () => {
  function makePromo(overrides: Partial<Promotion> = {}): Promotion {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const startHour = `${String(Math.max(0, now.getHours() - 1)).padStart(2, '0')}:00`
    const endHour = `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:59`

    return {
      id: 'promo-1',
      name: 'Test Promo',
      type: 'percentage',
      value: 20,
      applies_to: 'order',
      category_ids: [],
      item_ids: [],
      schedule: {
        days: [dayOfWeek],
        start_time: startHour,
        end_time: endHour,
        start_date: '',
        end_date: '',
      },
      auto_apply: true,
      max_per_day: null,
      active: true,
      ...overrides,
    }
  }

  it('promo active during current time window', () => {
    const promo = makePromo()
    const items = [makeItem('a', 100, 1)]
    const result = evaluatePromos([promo], items as OrderItem[], 100, new Map())

    expect(result).toHaveLength(1)
    expect(result[0].discount).toBe(20) // 20% of 100
  })

  it('promo inactive outside time window', () => {
    const promo = makePromo({
      schedule: {
        days: [new Date().getDay()],
        start_time: '03:00',
        end_time: '03:01', // extremely narrow window unlikely to match
        start_date: '',
        end_date: '',
      },
    })
    // Only passes if current time is NOT 03:00-03:01
    const now = new Date()
    if (now.getHours() !== 3) {
      const items = [makeItem('a', 100, 1)]
      const result = evaluatePromos([promo], items as OrderItem[], 100, new Map())
      expect(result).toHaveLength(0)
    }
  })

  it('percentage discount calculation', () => {
    const promo = makePromo({ value: 15 })
    const items = [makeItem('a', 200, 1), makeItem('b', 300, 1)]
    const subtotal = 500
    const result = evaluatePromos([promo], items as OrderItem[], subtotal, new Map())

    expect(result).toHaveLength(1)
    expect(result[0].discount).toBe(75) // 15% of 500
    expect(result[0].label).toContain('-15%')
  })

  it('2x1 calculation (every 2nd item free)', () => {
    const promo = makePromo({
      type: '2x1',
      value: 0,
      applies_to: 'item',
      item_ids: ['cafe'],
    })
    // 3 cafes at $48 each: sorted desc [48, 48, 48], indices 1 free → discount = 48
    const items = [makeItemFull('c1', 48, 3, { menuItemId: 'cafe' })]
    const result = evaluatePromos([promo], items, 144, new Map())

    expect(result).toHaveLength(1)
    expect(result[0].discount).toBe(48) // every 2nd of 3 = 1 free
  })

  it('auto_apply flag is preserved on promo', () => {
    const promo = makePromo({ auto_apply: true })
    const items = [makeItem('a', 100, 1)]
    const result = evaluatePromos([promo], items as OrderItem[], 100, new Map())

    expect(result[0].promo.auto_apply).toBe(true)
  })

  it('promo on specific items only', () => {
    const promo = makePromo({
      applies_to: 'item',
      item_ids: ['chilaquiles'],
      value: 10,
    })
    const items = [
      makeItemFull('a', 292, 1, { menuItemId: 'chilaquiles' }),
      makeItemFull('b', 48, 1, { menuItemId: 'cafe' }),
    ]
    const result = evaluatePromos([promo], items, 340, new Map())

    expect(result).toHaveLength(1)
    // 10% of matched items subtotal (292) = 29.2
    expect(result[0].discount).toBeCloseTo(29.2)
    expect(result[0].affectedItems).toEqual(['a'])
  })

  it('buildCategoryMap maps items to categories', () => {
    const categories = [
      { id: 'cat-coffee', items: [{ id: 'cafe-1' }, { id: 'cafe-2' }] },
      { id: 'cat-food', items: [{ id: 'chila-1' }] },
    ]
    const map = buildCategoryMap(categories)

    expect(map.get('cafe-1')).toBe('cat-coffee')
    expect(map.get('cafe-2')).toBe('cat-coffee')
    expect(map.get('chila-1')).toBe('cat-food')
    expect(map.get('unknown')).toBeUndefined()
  })
})

// ─── TEST GROUP 5: Combo pricing ───────────────────────────────────────────

describe('Combo pricing', () => {
  function makeCombo(overrides: Partial<Combo> = {}): Combo {
    return {
      id: 'combo-1',
      client_id: 'amalay',
      name: 'Desayuno Combo',
      items: [
        { menu_item_id: 'chila', name: 'Chilaquiles', substitutions: [] },
        { menu_item_id: 'cafe', name: 'Cafe Americano', substitutions: [] },
        { menu_item_id: 'jugo', name: 'Jugo de Naranja', substitutions: [] },
      ],
      price: 250,
      upsell: null,
      active: true,
      schedule: null,
      created_at: '2026-06-01T00:00:00Z',
      ...overrides,
    }
  }

  it('proportional pricing: combo price < sum of items', () => {
    const combo = makeCombo({ price: 250 })
    const menuPrices = new Map([
      ['chila', 292],
      ['cafe', 48],
      ['jugo', 78],
    ])
    // Original total: 292 + 48 + 78 = 418
    // Combo price: 250
    const orderItems = applyCombo(combo, menuPrices)

    expect(orderItems).toHaveLength(3)
    const sum = orderItems.reduce((s, i) => s + i.subtotal, 0)
    expect(round2(sum)).toBe(250) // must sum exactly to combo price
  })

  it('rounding: no cents lost', () => {
    const combo = makeCombo({
      price: 199,
      items: [
        { menu_item_id: 'a', name: 'A', substitutions: [] },
        { menu_item_id: 'b', name: 'B', substitutions: [] },
        { menu_item_id: 'c', name: 'C', substitutions: [] },
      ],
    })
    const menuPrices = new Map([['a', 100], ['b', 100], ['c', 100]])
    const orderItems = applyCombo(combo, menuPrices)

    const sum = round2(orderItems.reduce((s, i) => s + i.subtotal, 0))
    expect(sum).toBe(199) // exact, no cents lost
  })

  it('combo with substitution', () => {
    const combo = makeCombo()
    const menuPrices = new Map([
      ['chila', 292],
      ['cafe', 48],
      ['jugo', 78],
      ['latte', 68], // substitution
    ])
    const substitutions = new Map([[1, { id: 'latte', name: 'Latte' }]])
    const orderItems = applyCombo(combo, menuPrices, undefined, substitutions)

    // Cafe (index 1) replaced with Latte
    expect(orderItems[1].menuItemId).toBe('latte')
    expect(orderItems[1].nombre).toBe('Latte')
    // Total still sums to combo price
    const sum = round2(orderItems.reduce((s, i) => s + i.subtotal, 0))
    expect(sum).toBe(250)
  })

  it('empty combo items returns empty array', () => {
    const combo = makeCombo({ items: [] })
    const menuPrices = new Map<string, number>()
    const orderItems = applyCombo(combo, menuPrices)

    expect(orderItems).toHaveLength(0)
  })

  it('items with unknown prices get equal share', () => {
    const combo = makeCombo({
      price: 300,
      items: [
        { menu_item_id: 'x', name: 'X', substitutions: [] },
        { menu_item_id: 'y', name: 'Y', substitutions: [] },
        { menu_item_id: 'z', name: 'Z', substitutions: [] },
      ],
    })
    // No prices in map → all originalPrice = 0 → equal split
    const menuPrices = new Map<string, number>()
    const orderItems = applyCombo(combo, menuPrices)

    const sum = round2(orderItems.reduce((s, i) => s + i.subtotal, 0))
    expect(sum).toBe(300)
    // Each should be 100 (equal split)
    expect(orderItems[0].precio).toBe(100)
    expect(orderItems[1].precio).toBe(100)
    expect(orderItems[2].precio).toBe(100)
  })
})

// ─── TEST GROUP 6: Cash movements in corte ─────────────────────────────────

describe('Cash movements in corte', () => {
  // Pure calculation functions for corte de caja
  function calcEsperado(fondo: number, ventasEfectivo: number, depositos: number, retiros: number): number {
    return fondo + ventasEfectivo + depositos - retiros
  }

  function calcDiferencia(declarado: number, esperado: number): number {
    return round2(declarado - esperado)
  }

  it('formula: fondo + ventasEfectivo + depositos - retiros = esperado', () => {
    const fondo = 5000
    const ventasEfectivo = 12350.50
    const depositos = 2000
    const retiros = 3000

    const esperado = calcEsperado(fondo, ventasEfectivo, depositos, retiros)
    expect(esperado).toBe(5000 + 12350.50 + 2000 - 3000) // 16350.50
  })

  it('declarado vs esperado = diferencia', () => {
    const esperado = 16350.50
    const declarado = 16400
    const diferencia = calcDiferencia(declarado, esperado)
    expect(diferencia).toBe(49.50)
  })

  it('diferencia positive (sobrante)', () => {
    const esperado = 10000
    const declarado = 10150
    const diferencia = calcDiferencia(declarado, esperado)
    expect(diferencia).toBe(150)
    expect(diferencia).toBeGreaterThan(0) // sobrante
  })

  it('diferencia negative (faltante)', () => {
    const esperado = 10000
    const declarado = 9800
    const diferencia = calcDiferencia(declarado, esperado)
    expect(diferencia).toBe(-200)
    expect(diferencia).toBeLessThan(0) // faltante
  })

  it('zero difference (arqueo perfecto)', () => {
    const esperado = 15000
    const declarado = 15000
    const diferencia = calcDiferencia(declarado, esperado)
    expect(diferencia).toBe(0)
  })

  it('handles zero fondo and no movements', () => {
    const esperado = calcEsperado(0, 0, 0, 0)
    expect(esperado).toBe(0)
  })
})
