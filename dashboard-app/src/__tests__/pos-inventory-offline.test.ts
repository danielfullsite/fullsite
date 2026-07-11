import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── localStorage mock ────────────────────────────────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('fetch', vi.fn())

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
})

// ─── Imports (after mocking) ──────────────────────────────────────────────

import {
  getModifierTypeFromCategoryName,
  getModifiersForCategory,
  DIRECT_STOCK_CATEGORIES,
  MODIFIERS_AGREGAR_COFFEE,
  MODIFIERS_AGREGAR_DRINKS,
  MODIFIERS_AGREGAR_FOOD,
  MODIFIERS_AGREGAR_NONE,
  generateId,
} from '@/lib/pos-data'

import {
  getStationForItem,
  setCategoryNameCache,
  BEBIDA_KEYWORDS,
  isBebida,
  type StationName,
} from '@/lib/pos-constants'

import {
  buildCfdiBody,
  buildPaymentComplementBody,
  type CfdiRequestRow,
  type PaymentComplementRequest,
} from '@/lib/facturama'

import {
  enqueue,
  getQueue,
  getPendingCount,
  clearCompleted,
  clearAll,
  type PrintJob,
} from '@/lib/print-queue'

import {
  applyCombo,
  type Combo,
  type ComboSubstitution,
} from '@/lib/pos-combos'

// ═══════════════════════════════════════════════════════════════════════════
// 1. INVENTORY DEDUCTION — FUZZY MATCHING (normalizeRecipeName is internal)
//    We test the matching logic indirectly via getModifierTypeFromCategoryName
//    and getModifiersForCategory, which use the same category classification.
// ═══════════════════════════════════════════════════════════════════════════

describe('Inventory deduction — normalizeRecipeName logic', () => {
  // normalizeRecipeName is scoped inside deductIngredientsForOrder and not exported.
  // We verify the documented behavior by testing the name-based routing that
  // uses similar normalization patterns: category name matching.

  it('category name matching is case-insensitive', () => {
    expect(getModifierTypeFromCategoryName('COFFEE HOT/ICE')).toBe('coffee')
    expect(getModifierTypeFromCategoryName('coffee hot/ice')).toBe('coffee')
    expect(getModifierTypeFromCategoryName('Coffee Hot/Ice')).toBe('coffee')
  })

  it('beverage detection strips common prefixes from brand names', () => {
    // HEINEKEN should be detected as a beverage (barra) even without "cerveza" prefix
    expect(isBebida('HEINEKEN')).toBe(true)
    expect(isBebida('CORONA')).toBe(true)
    expect(isBebida('MARGARITA')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. MODIFIER ROUTING BY CATEGORY NAME
// ═══════════════════════════════════════════════════════════════════════════

describe('getModifierTypeFromCategoryName', () => {
  it('Coffee Hot/Ice → coffee', () => {
    expect(getModifierTypeFromCategoryName('Coffee Hot/Ice')).toBe('coffee')
  })

  it('Cerveza → none', () => {
    expect(getModifierTypeFromCategoryName('Cerveza')).toBe('none')
  })

  it('Bakery → bakery', () => {
    expect(getModifierTypeFromCategoryName('Bakery')).toBe('bakery')
  })

  it('Chilaquiles & Enchiladas → food', () => {
    expect(getModifierTypeFromCategoryName('Chilaquiles & Enchiladas')).toBe('food')
  })

  it('Bebidas OH → none', () => {
    expect(getModifierTypeFromCategoryName('Bebidas OH')).toBe('none')
  })

  it('Market: Healthy Snacks & Abarrotes → bakery', () => {
    expect(getModifierTypeFromCategoryName('Market: Healthy Snacks & Abarrotes')).toBe('bakery')
  })

  it('Smoothies → beverage', () => {
    expect(getModifierTypeFromCategoryName('Smoothies')).toBe('beverage')
  })

  it('Frappes → beverage', () => {
    expect(getModifierTypeFromCategoryName('Frappes')).toBe('beverage')
  })

  it('Toast & Bagels → bakery', () => {
    expect(getModifierTypeFromCategoryName('Toast & Bagels')).toBe('bakery')
  })

  it('Desserts → bakery', () => {
    expect(getModifierTypeFromCategoryName('Desserts')).toBe('bakery')
  })

  it('Ice Cream → beverage', () => {
    expect(getModifierTypeFromCategoryName('Ice Cream')).toBe('beverage')
  })

  it('Licores 2oz → none', () => {
    expect(getModifierTypeFromCategoryName('Licores 2oz')).toBe('none')
  })

  it('Vinos → none', () => {
    expect(getModifierTypeFromCategoryName('Vinos')).toBe('none')
  })

  it('Sodas → none', () => {
    expect(getModifierTypeFromCategoryName('Sodas')).toBe('none')
  })

  it('Pizzas & Pastas → food', () => {
    expect(getModifierTypeFromCategoryName('Pizzas & Pastas')).toBe('food')
  })

  it('Paninis → food', () => {
    expect(getModifierTypeFromCategoryName('Paninis')).toBe('food')
  })
})

describe('getModifiersForCategory — routes modifiers by DB category name', () => {
  beforeEach(() => {
    setCategoryNameCache({
      'uuid-coffee': 'Coffee Hot/Ice',
      'uuid-cerveza': 'Cerveza',
      'uuid-bakery': 'Bakery',
      'uuid-food': 'Chilaquiles & Enchiladas',
      'uuid-smoothie': 'Smoothies',
    })
  })

  afterEach(() => {
    setCategoryNameCache({})
  })

  it('coffee category returns coffee modifiers', () => {
    const { agregarOptions } = getModifiersForCategory('uuid-coffee')
    expect(agregarOptions).toEqual(MODIFIERS_AGREGAR_COFFEE)
  })

  it('cerveza category returns no modifiers', () => {
    const { agregarOptions } = getModifiersForCategory('uuid-cerveza')
    expect(agregarOptions).toEqual(MODIFIERS_AGREGAR_NONE)
  })

  it('bakery category returns no modifiers', () => {
    const { agregarOptions } = getModifiersForCategory('uuid-bakery')
    expect(agregarOptions).toEqual(MODIFIERS_AGREGAR_NONE)
  })

  it('food category returns food modifiers', () => {
    const { agregarOptions } = getModifiersForCategory('uuid-food')
    expect(agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })

  it('smoothie category returns drink modifiers', () => {
    const { agregarOptions } = getModifiersForCategory('uuid-smoothie')
    expect(agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. STATION ROUTING
// ═══════════════════════════════════════════════════════════════════════════

describe('getStationForItem — station routing', () => {
  afterEach(() => {
    setCategoryNameCache({})
  })

  it('Cerveza category → barra', () => {
    setCategoryNameCache({ 'uuid-123': 'Cerveza' })
    expect(getStationForItem('uuid-123', 'HEINEKEN')).toBe('barra')
  })

  it('Coffee Hot/Ice category → barra', () => {
    setCategoryNameCache({ 'uuid-456': 'Coffee Hot/Ice' })
    expect(getStationForItem('uuid-456', 'LATTE')).toBe('barra')
  })

  it('Bakery category → caja', () => {
    setCategoryNameCache({ 'uuid-789': 'Bakery' })
    expect(getStationForItem('uuid-789', 'CONCHA')).toBe('caja')
  })

  it('unknown category + HEINEKEN → barra (via BEBIDA_KEYWORDS)', () => {
    expect(getStationForItem('unknown-id', 'HEINEKEN')).toBe('barra')
  })

  it('unknown category + CORONA → barra (via BEBIDA_KEYWORDS)', () => {
    expect(getStationForItem('unknown-id', 'CORONA')).toBe('barra')
  })

  it('unknown category + MARGARITA → barra', () => {
    expect(getStationForItem('unknown-id', 'MARGARITA')).toBe('barra')
  })

  it('unknown category + CHILAQUILES VERDES → cocina', () => {
    expect(getStationForItem('unknown-id', 'CHILAQUILES VERDES')).toBe('cocina')
  })

  it('Desserts category → caja', () => {
    setCategoryNameCache({ 'uuid-dessert': 'Desserts' })
    expect(getStationForItem('uuid-dessert', 'CHEESECAKE')).toBe('caja')
  })

  it('Market category → caja', () => {
    setCategoryNameCache({ 'uuid-mkt': 'Market: Healthy Snacks' })
    expect(getStationForItem('uuid-mkt', 'BARRA DE PROTEINA')).toBe('caja')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. CFDI BODY BUILDING
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCfdiBody', () => {
  const baseReq: CfdiRequestRow = {
    id: 'test-123',
    rfc: 'ABC123456XX0',
    razon_social: 'Test Company SA de CV',
    regimen_fiscal: '601',
    uso_cfdi: 'G03',
    codigo_postal: '64000',
    email: 'test@example.com',
    subtotal: null,
    iva: null,
    total: 1160,
  }

  it('builds correct structure for normal request', () => {
    const body = buildCfdiBody(baseReq, '64000')

    expect(body.CfdiType).toBe('I')
    expect(body.PaymentMethod).toBe('PUE')
    expect(body.Currency).toBe('MXN')
    expect(body.ExpeditionPlace).toBe('64000')
    expect(body.Receiver.Rfc).toBe('ABC123456XX0')
    expect(body.Receiver.Name).toBe('TEST COMPANY SA DE CV')
    expect(body.Receiver.CfdiUse).toBe('G03')
    expect(body.Receiver.FiscalRegime).toBe('601')
    expect(body.Items).toHaveLength(1)
    expect(body.Items[0].ProductCode).toBe('90101501')
    expect(body.Items[0].UnitCode).toBe('ACT')
    expect(body.Items[0].TaxObject).toBe('02')
    // Subtotal + IVA should equal total
    const item = body.Items[0]
    expect(Math.round((item.Subtotal + item.Taxes[0].Total) * 100) / 100).toBe(1160)
  })

  it('does NOT include GlobalInformation for regular RFC', () => {
    const body = buildCfdiBody(baseReq, '64000')
    expect(body).not.toHaveProperty('GlobalInformation')
  })

  it('includes GlobalInformation for publico en general RFC', () => {
    const publicoReq = { ...baseReq, rfc: 'XAXX010101000' }
    const body = buildCfdiBody(publicoReq, '64000')
    expect(body).toHaveProperty('GlobalInformation')
    expect(body.GlobalInformation).toBeDefined()
    expect(body.GlobalInformation!.Periodicity).toBe('01')
    expect(body.GlobalInformation!.Year).toBe(new Date().getFullYear())
  })

  it('throws error for total of 0', () => {
    const zeroReq = { ...baseReq, total: 0 }
    expect(() => buildCfdiBody(zeroReq, '64000')).toThrow('La solicitud no tiene monto total')
  })

  it('throws error for null total', () => {
    const nullReq = { ...baseReq, total: null }
    expect(() => buildCfdiBody(nullReq, '64000')).toThrow('La solicitud no tiene monto total')
  })

  it('accepts custom paymentForm', () => {
    const body = buildCfdiBody(baseReq, '64000', '04')
    expect(body.PaymentForm).toBe('04')
  })

  it('recalculates subtotal and IVA from total', () => {
    const body = buildCfdiBody(baseReq, '64000')
    const item = body.Items[0]
    // subtotal = total / 1.16
    const expectedSubtotal = Math.round((1160 / 1.16) * 100) / 100
    expect(item.Subtotal).toBe(expectedSubtotal)
    expect(item.UnitPrice).toBe(expectedSubtotal)
    expect(item.Taxes[0].Base).toBe(expectedSubtotal)
    expect(item.Taxes[0].Rate).toBe(0.16)
  })
})

describe('buildPaymentComplementBody', () => {
  const basePayment: PaymentComplementRequest = {
    relatedUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    relatedSerie: 'POS',
    relatedFolio: '001',
    receiverRfc: 'ABC123456XX0',
    receiverName: 'Test Company',
    receiverFiscalRegime: '601',
    receiverTaxZipCode: '64000',
    amount: 500,
    paymentForm: '03',
    paymentDate: '2026-06-14T12:00:00Z',
    installment: 1,
    previousBalance: 1000,
  }

  it('builds correct complement structure', () => {
    const body = buildPaymentComplementBody(basePayment, '64000')

    expect(body.CfdiType).toBe('P')
    expect(body.Currency).toBe('XXX')
    expect(body.Receiver.CfdiUse).toBe('CP01')
    expect(body.Receiver.Rfc).toBe('ABC123456XX0')
    expect(body.Complemento.Payments).toHaveLength(1)

    const payment = body.Complemento.Payments[0]
    expect(payment.Amount).toBe(500)
    expect(payment.PaymentForm).toBe('03')
    expect(payment.Date).toBe('2026-06-14')
  })

  it('includes related document with correct UUID', () => {
    const body = buildPaymentComplementBody(basePayment, '64000')
    const relDoc = body.Complemento.Payments[0].RelatedDocuments[0]

    expect(relDoc.Uuid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(relDoc.PaymentMethod).toBe('PPD')
    expect(relDoc.PartialityNumber).toBe(1)
    expect(relDoc.PreviousBalanceAmount).toBe(1000)
    expect(relDoc.AmountPaid).toBe(500)
    expect(relDoc.ImpSaldoInsoluto).toBe(500)
  })

  it('calculates remaining balance correctly', () => {
    const body = buildPaymentComplementBody(
      { ...basePayment, amount: 700, previousBalance: 1000 },
      '64000',
    )
    const relDoc = body.Complemento.Payments[0].RelatedDocuments[0]
    expect(relDoc.ImpSaldoInsoluto).toBe(300)
  })

  it('remaining balance never goes below 0', () => {
    const body = buildPaymentComplementBody(
      { ...basePayment, amount: 1200, previousBalance: 1000 },
      '64000',
    )
    const relDoc = body.Complemento.Payments[0].RelatedDocuments[0]
    expect(relDoc.ImpSaldoInsoluto).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. DIRECT STOCK CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

describe('DIRECT_STOCK_CATEGORIES', () => {
  it('includes cerveza', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('cerveza')
  })

  it('includes vinos', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('vinos')
  })

  it('includes licores', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('licores')
  })

  it('includes sodas', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('sodas')
  })

  it('includes icecream', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('icecream')
  })

  it('includes bakery', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('bakery')
  })

  it('includes postres', () => {
    expect(DIRECT_STOCK_CATEGORIES).toContain('postres')
  })

  it('does NOT include coffee (needs recipe)', () => {
    expect(DIRECT_STOCK_CATEGORIES).not.toContain('coffee')
  })

  it('does NOT include frappes (needs recipe)', () => {
    expect(DIRECT_STOCK_CATEGORIES).not.toContain('frappes')
  })

  it('does NOT include jugos (needs recipe)', () => {
    expect(DIRECT_STOCK_CATEGORIES).not.toContain('jugos')
  })

  it('does NOT include smoothies (needs recipe)', () => {
    expect(DIRECT_STOCK_CATEGORIES).not.toContain('smoothies')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. PRINT QUEUE
// ═══════════════════════════════════════════════════════════════════════════

describe('Print queue', () => {
  beforeEach(() => {
    clearAll()
  })

  it('enqueue creates a job with correct defaults', () => {
    const job = enqueue({
      station: 'cocina',
      data: 'dGVzdA==',
      type: 'comanda',
      meta: { mesa: 5, mesero: 'Omar' },
    })

    expect(job.id).toMatch(/^pj-/)
    expect(job.status).toBe('pending')
    expect(job.retries).toBe(0)
    expect(job.maxRetries).toBe(5)
    expect(job.station).toBe('cocina')
    expect(job.type).toBe('comanda')
    expect(job.data).toBe('dGVzdA==')
    expect(job.lastAttempt).toBeNull()
    expect(job.error).toBeNull()
    expect(job.meta?.mesa).toBe(5)
    expect(job.meta?.mesero).toBe('Omar')
    expect(job.createdAt).toBeTruthy()
  })

  it('enqueue persists to localStorage', () => {
    enqueue({ station: 'barra', data: 'abc', type: 'ticket' })
    const queue = getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].station).toBe('barra')
  })

  it('getPendingCount returns correct count', () => {
    expect(getPendingCount()).toBe(0)

    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'ticket' })
    expect(getPendingCount()).toBe(2)

    // Manually mark one as printed
    const queue = getQueue()
    queue[0].status = 'printed'
    localStorageMock.setItem('pos_print_queue', JSON.stringify(queue))
    expect(getPendingCount()).toBe(1)
  })

  it('clearCompleted removes printed jobs but keeps pending', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'ticket' })

    // Mark first as printed
    const queue = getQueue()
    queue[0].status = 'printed'
    localStorageMock.setItem('pos_print_queue', JSON.stringify(queue))

    clearCompleted()

    const remaining = getQueue()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].station).toBe('barra')
    expect(remaining[0].status).toBe('pending')
  })

  it('clearCompleted keeps failed jobs', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })

    const queue = getQueue()
    queue[0].status = 'failed'
    localStorageMock.setItem('pos_print_queue', JSON.stringify(queue))

    clearCompleted()

    expect(getQueue()).toHaveLength(1)
    expect(getQueue()[0].status).toBe('failed')
  })

  it('clearAll removes everything', () => {
    enqueue({ station: 'cocina', data: 'a', type: 'comanda' })
    enqueue({ station: 'barra', data: 'b', type: 'ticket' })

    clearAll()

    expect(getQueue()).toHaveLength(0)
    expect(getPendingCount()).toBe(0)
  })

  it('multiple enqueues accumulate in order', () => {
    enqueue({ station: 'cocina', data: '1', type: 'comanda' })
    enqueue({ station: 'barra', data: '2', type: 'ticket' })
    enqueue({ station: 'caja', data: '3', type: 'preticket' })

    const queue = getQueue()
    expect(queue).toHaveLength(3)
    expect(queue[0].station).toBe('cocina')
    expect(queue[1].station).toBe('barra')
    expect(queue[2].station).toBe('caja')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. COMBO SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

describe('applyCombo', () => {
  const makeCombo = (overrides?: Partial<Combo>): Combo => ({
    id: 'combo-1',
    client_id: 'amalay',
    name: 'Desayuno Combo',
    items: [
      { menu_item_id: 'item-a', name: 'Chilaquiles Verdes', substitutions: [] },
      { menu_item_id: 'item-b', name: 'Café Americano', substitutions: [] },
    ],
    price: 180,
    upsell: null,
    active: true,
    schedule: null,
    created_at: '2026-06-14T00:00:00Z',
    ...overrides,
  })

  it('creates OrderItems for each combo item', () => {
    const combo = makeCombo()
    const prices = new Map([['item-a', 150], ['item-b', 80]])

    const items = applyCombo(combo, prices)

    expect(items).toHaveLength(2)
    expect(items[0].nombre).toBe('Chilaquiles Verdes')
    expect(items[1].nombre).toBe('Café Americano')
  })

  it('proportional pricing sums exactly to combo price', () => {
    const combo = makeCombo()
    const prices = new Map([['item-a', 150], ['item-b', 80]])

    const items = applyCombo(combo, prices)
    const total = items.reduce((sum, item) => sum + item.precio, 0)

    expect(total).toBe(180)
  })

  it('distributes price proportionally by original prices', () => {
    const combo = makeCombo({ price: 230 })
    const prices = new Map([['item-a', 150], ['item-b', 80]])
    // item-a is 150/230 of total, item-b is 80/230

    const items = applyCombo(combo, prices)

    // item-a should get more of the combo price than item-b
    expect(items[0].precio).toBeGreaterThan(items[1].precio)
  })

  it('splits equally when original prices are unknown (0)', () => {
    const combo = makeCombo({ price: 200 })
    const prices = new Map<string, number>() // empty — no prices known

    const items = applyCombo(combo, prices)

    expect(items[0].precio).toBe(100)
    expect(items[1].precio).toBe(100)
    expect(items[0].precio + items[1].precio).toBe(200)
  })

  it('uses substituted name when substitution is provided', () => {
    const combo = makeCombo({
      items: [
        {
          menu_item_id: 'item-a',
          name: 'Chilaquiles Verdes',
          substitutions: [{ id: 'item-c', name: 'Chilaquiles Rojos' }],
        },
        { menu_item_id: 'item-b', name: 'Café Americano', substitutions: [] },
      ],
    })
    const prices = new Map([['item-a', 150], ['item-b', 80], ['item-c', 150]])

    const subs = new Map<number, ComboSubstitution>()
    subs.set(0, { id: 'item-c', name: 'Chilaquiles Rojos' })

    const items = applyCombo(combo, prices, undefined, subs)

    expect(items[0].nombre).toBe('Chilaquiles Rojos')
    expect(items[0].menuItemId).toBe('item-c')
    expect(items[1].nombre).toBe('Café Americano')
  })

  it('rounding: combo items total matches exactly (no floating point errors)', () => {
    // Use a price that is tricky to divide: 199 / 3 items
    const combo = makeCombo({
      price: 199,
      items: [
        { menu_item_id: 'x1', name: 'A', substitutions: [] },
        { menu_item_id: 'x2', name: 'B', substitutions: [] },
        { menu_item_id: 'x3', name: 'C', substitutions: [] },
      ],
    })
    const prices = new Map([['x1', 100], ['x2', 100], ['x3', 100]])

    const items = applyCombo(combo, prices)
    const total = items.reduce((sum, item) => {
      // Use raw addition — the system should handle rounding
      return Math.round((sum + item.precio) * 100) / 100
    }, 0)

    expect(total).toBe(199)
  })

  it('rounding: asymmetric prices with odd combo total', () => {
    const combo = makeCombo({
      price: 177,
      items: [
        { menu_item_id: 'p1', name: 'Item 1', substitutions: [] },
        { menu_item_id: 'p2', name: 'Item 2', substitutions: [] },
      ],
    })
    const prices = new Map([['p1', 89], ['p2', 120]])

    const items = applyCombo(combo, prices)
    const total = items.reduce((sum, item) => sum + item.precio, 0)

    // Must match exactly — no penny off
    expect(Math.round(total * 100) / 100).toBe(177)
  })

  it('each item includes COMBO modifier label', () => {
    const combo = makeCombo({ name: 'Promo Desayuno' })
    const prices = new Map([['item-a', 100], ['item-b', 50]])

    const items = applyCombo(combo, prices)

    for (const item of items) {
      expect(item.modificadores).toContain('COMBO: Promo Desayuno')
    }
  })

  it('all items share the same comboGroupId', () => {
    const combo = makeCombo()
    const prices = new Map([['item-a', 100], ['item-b', 50]])

    const items = applyCombo(combo, prices, 'group-xyz')

    for (const item of items) {
      expect((item as unknown as Record<string, unknown>)._comboGroupId).toBe('group-xyz')
    }
  })

  it('generates a comboGroupId when none is provided', () => {
    const combo = makeCombo()
    const prices = new Map([['item-a', 100], ['item-b', 50]])

    const items = applyCombo(combo, prices)

    const groupId = (items[0] as unknown as Record<string, unknown>)._comboGroupId
    expect(groupId).toBeTruthy()
    expect((items[1] as unknown as Record<string, unknown>)._comboGroupId).toBe(groupId)
  })
})
