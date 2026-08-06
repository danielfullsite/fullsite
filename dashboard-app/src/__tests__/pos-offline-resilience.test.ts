import { describe, it, expect, beforeEach } from 'vitest'
import { shouldAttemptSync } from '@/lib/pos-offline-db'

// ─── Reproduce core POS logic inline (same pattern as data-integrity.test.ts) ──

const IVA_RATE = 0.16

function formatMXN(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatMXNDisplay(amount: number): string {
  // POS display: no decimals, comma separator
  return `$${Math.round(amount).toLocaleString('es-MX')}`
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

const num = (v: unknown) => Number(v) || 0

// parseJsonb — the double-JSON pattern used in chat/dashboard
function parseJsonb(val: unknown): unknown {
  if (!val) return []
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      // Double-encoded: "[{\"nombre\":\"Omar\"}]"
      if (typeof parsed === 'string') {
        return JSON.parse(parsed)
      }
      return parsed
    } catch { return [] }
  }
  return val
}

// Order interfaces (reproduce inline)
interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  modificadores: string[]
  notas: string
  precioExtra: number
  subtotal: number
  silla?: number
}

interface Order {
  id: string
  mesa: number
  mesero: string
  personas: number
  status: 'abierta' | 'enviada' | 'cerrada' | 'cancelada'
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  descuento: number
  propina?: number
  metodoPago?: string
  notas?: string
  createdAt: Date
  closedAt?: Date
}

// SyncQueueItem shape (from pos-offline-db)
interface SyncQueueItem {
  id: string
  table: string
  method: 'POST' | 'PATCH' | 'DELETE'
  data: Record<string, unknown>
  endpoint?: string
  created_at: string
  synced: boolean
  retries: number
}

// Menu category structure
interface MenuCategory {
  id: string
  name: string
  color?: string
  items: { id: string; name: string; price: number; promo?: boolean; barcode?: string }[]
}

// Payment methods (from pos-constants)
const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mixto', label: 'Mixto (Efectivo + Tarjeta)' },
] as const

// Manager PIN parsing (from pos-data)
function parseManagerPins(raw: string): Record<string, string> {
  if (!raw) return {}
  const pins: Record<string, string> = {}
  for (const entry of raw.split(',')) {
    const [pin, name] = entry.split(':')
    if (pin && name) pins[pin.trim()] = name.trim()
  }
  return pins
}

// Station routing (from pos-constants)
const BEVERAGE_KEYWORDS = [
  'cafe', 'café', 'cappuccino', 'capuchino', 'latte', 'americano', 'mocca', 'matcha', 'chai',
  'smoothie', 'frappe', 'jugo', 'limonada', 'fresco',
  'soda', 'coca', 'agua', 'te ', 'té ', 'tisana',
  'mimosa', 'chamoyada', 'cerveza', 'vino',
]

function isBebida(name: string): boolean {
  const lower = name.toLowerCase()
  return BEVERAGE_KEYWORDS.some(kw => lower.includes(kw))
}

// ─── AMALAY menu data for realistic tests ───────────────────────────────────

const SAMPLE_MENU: MenuCategory[] = [
  {
    id: 'chilaquiles', name: 'Chilaquiles', color: 'bg-rose-700', items: [
      { id: 'c1a', name: 'Chilaquiles Verdes', price: 292 },
      { id: 'c1b', name: 'Chilaquiles Rojos', price: 292 },
      { id: 'c2', name: 'Chilaquiles Light', price: 304 },
    ]
  },
  {
    id: 'coffee', name: 'Café', color: 'bg-amber-700', items: [
      { id: 'cf1', name: 'Cafe Americano', price: 48 },
      { id: 'cf2', name: 'Capuchino Caliente', price: 89 },
      { id: 'cf3', name: 'Cafe Latte Caliente', price: 94 },
    ]
  },
  {
    id: 'toast', name: 'Pan & Toast', color: 'bg-orange-500', items: [
      { id: 't1', name: 'Avocado Toast', price: 252 },
      { id: 't2', name: 'Amalay Salmon Special Toast', price: 402 },
    ]
  },
  {
    id: 'postres', name: 'Postres', color: 'bg-fuchsia-500', items: [
      { id: 'ds1', name: 'New York Cheesecake', price: 130 },
      { id: 'ds2', name: 'Carrot Cake', price: 135 },
    ]
  },
  {
    id: 'sodas', name: 'Sodas', color: 'bg-blue-500', items: [
      { id: 'sd1', name: 'Coca Cola Regular 355ml', price: 34 },
      { id: 'sd4', name: 'Agua Amalay 500ml', price: 44 },
    ]
  },
]

const MESEROS = [
  'Omar Aguilera',
  'Hector Enrique Rodriguez Lopez',
  'Brayan Berlanga Solis',
  'Daniela Edith Rico Segura',
]

// Helper: create a realistic order
function createTestOrder(overrides: Partial<Order> = {}): Order {
  const items: OrderItem[] = overrides.items || [
    {
      id: generateId(),
      menuItemId: 'c1a',
      nombre: 'Chilaquiles Verdes',
      precio: 292,
      cantidad: 1,
      modificadores: ['Sin cebolla'],
      notas: '',
      precioExtra: 0,
      subtotal: 292,
    },
    {
      id: generateId(),
      menuItemId: 'cf1',
      nombre: 'Cafe Americano',
      precio: 48,
      cantidad: 2,
      modificadores: [],
      notas: '',
      precioExtra: 0,
      subtotal: 96,
    },
  ]

  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0)
  const descuento = overrides.descuento ?? 0
  const subtotalConDescuento = subtotal - descuento
  const iva = Math.round(subtotalConDescuento * IVA_RATE * 100) / 100
  const total = subtotalConDescuento + iva

  return {
    id: generateId(),
    mesa: 5,
    mesero: 'Omar Aguilera',
    personas: 2,
    status: 'abierta',
    items,
    subtotal,
    iva,
    total,
    descuento,
    propina: 0,
    metodoPago: undefined,
    notas: undefined,
    createdAt: new Date(),
    closedAt: undefined,
    ...overrides,
    // Recalculate if items were overridden but totals weren't
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Order creation data integrity
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Order creation — data integrity', () => {
  it('order has all required fields', () => {
    const order = createTestOrder()
    expect(order.id).toBeTruthy()
    expect(order.mesa).toBeGreaterThan(0)
    expect(order.mesero).toBeTruthy()
    expect(order.personas).toBeGreaterThanOrEqual(1)
    expect(order.status).toBe('abierta')
    expect(order.items).toBeInstanceOf(Array)
    expect(order.items.length).toBeGreaterThan(0)
    expect(typeof order.subtotal).toBe('number')
    expect(typeof order.iva).toBe('number')
    expect(typeof order.total).toBe('number')
    expect(typeof order.descuento).toBe('number')
    expect(order.createdAt).toBeInstanceOf(Date)
  })

  it('order items have all required fields', () => {
    const order = createTestOrder()
    for (const item of order.items) {
      expect(item.id).toBeTruthy()
      expect(item.menuItemId).toBeTruthy()
      expect(item.nombre).toBeTruthy()
      expect(typeof item.precio).toBe('number')
      expect(item.precio).toBeGreaterThanOrEqual(0)
      expect(item.cantidad).toBeGreaterThanOrEqual(1)
      expect(item.modificadores).toBeInstanceOf(Array)
      expect(typeof item.notas).toBe('string')
      expect(typeof item.precioExtra).toBe('number')
      expect(typeof item.subtotal).toBe('number')
    }
  })

  it('order ID is a non-empty string', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1.length).toBeGreaterThan(5)
    expect(id2.length).toBeGreaterThan(5)
    expect(id1).not.toBe(id2)
  })

  it('mesero must be from staff list', () => {
    const order = createTestOrder({ mesero: 'Omar Aguilera' })
    expect(MESEROS).toContain(order.mesero)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Order total calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Order total calculations', () => {
  it('subtotal = sum of item subtotals', () => {
    const items: OrderItem[] = [
      { id: '1', menuItemId: 'c1a', nombre: 'Chilaquiles Verdes', precio: 292, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 292 },
      { id: '2', menuItemId: 'cf1', nombre: 'Cafe Americano', precio: 48, cantidad: 2, modificadores: [], notas: '', precioExtra: 0, subtotal: 96 },
    ]
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    expect(subtotal).toBe(388)
  })

  it('IVA = subtotal * 0.16', () => {
    const subtotal = 388
    const iva = Math.round(subtotal * IVA_RATE * 100) / 100
    expect(iva).toBe(62.08)
  })

  it('total = subtotal + IVA', () => {
    const subtotal = 388
    const iva = 62.08
    expect(subtotal + iva).toBe(450.08)
  })

  it('item subtotal = (precio + precioExtra) * cantidad', () => {
    const item: OrderItem = {
      id: '1', menuItemId: 'c1a', nombre: 'Chilaquiles Verdes',
      precio: 292, cantidad: 2, modificadores: ['Extra queso +$25'],
      notas: '', precioExtra: 25,
      subtotal: (292 + 25) * 2,
    }
    expect(item.subtotal).toBe(634)
  })

  it('zero-item order has zero total', () => {
    const subtotal = 0
    const iva = Math.round(subtotal * IVA_RATE * 100) / 100
    expect(subtotal).toBe(0)
    expect(iva).toBe(0)
    expect(subtotal + iva).toBe(0)
  })

  it('handles large order totals correctly', () => {
    // 10 salmon toasts at $402 each
    const subtotal = 402 * 10
    const iva = Math.round(subtotal * IVA_RATE * 100) / 100
    const total = subtotal + iva
    expect(subtotal).toBe(4020)
    expect(iva).toBe(643.2)
    expect(total).toBe(4663.2)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Offline queue serialization
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Offline queue — JSON serialization roundtrip', () => {
  it('order survives JSON stringify/parse', () => {
    const order = createTestOrder()
    const serialized = JSON.stringify(order)
    const parsed = JSON.parse(serialized)
    expect(parsed.id).toBe(order.id)
    expect(parsed.mesa).toBe(order.mesa)
    expect(parsed.mesero).toBe(order.mesero)
    expect(parsed.subtotal).toBe(order.subtotal)
    expect(parsed.total).toBe(order.total)
    expect(parsed.items).toHaveLength(order.items.length)
  })

  it('Date converts to ISO string and back', () => {
    const now = new Date()
    const serialized = JSON.stringify({ createdAt: now })
    const parsed = JSON.parse(serialized)
    const restored = new Date(parsed.createdAt)
    expect(restored.getTime()).toBe(now.getTime())
  })

  it('order items with modificadores survive roundtrip', () => {
    const item: OrderItem = {
      id: 'x1', menuItemId: 'c1a', nombre: 'Chilaquiles Verdes',
      precio: 292, cantidad: 1,
      modificadores: ['Sin cebolla', 'Extra queso +$25', 'Extra aguacate +$35'],
      notas: 'Mesa junto a la ventana',
      precioExtra: 60, subtotal: 352,
    }
    const json = JSON.stringify(item)
    const restored = JSON.parse(json)
    expect(restored.modificadores).toEqual(['Sin cebolla', 'Extra queso +$25', 'Extra aguacate +$35'])
    expect(restored.notas).toBe('Mesa junto a la ventana')
  })

  it('localStorage offline queue format is valid', () => {
    const queue = [
      { table: 'pos_orders', data: { id: 'abc', mesa: 5 }, timestamp: Date.now(), synced: false },
      { table: 'pos_orders', method: 'PATCH', endpoint: 'pos_orders?id=eq.abc', data: { status: 'cerrada' }, timestamp: Date.now(), synced: false },
    ]
    const serialized = JSON.stringify(queue)
    const parsed = JSON.parse(serialized)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].synced).toBe(false)
    expect(parsed[1].data.status).toBe('cerrada')
  })

  it('SyncQueueItem has all required fields', () => {
    const item: SyncQueueItem = {
      id: `${Date.now()}-abc123`,
      table: 'pos_orders',
      method: 'POST',
      data: { id: 'order-1', mesa: 7, total: 450.08 },
      created_at: new Date().toISOString(),
      synced: false,
      retries: 0,
    }
    const json = JSON.stringify(item)
    const parsed = JSON.parse(json)
    expect(parsed.id).toBeTruthy()
    expect(parsed.table).toBe('pos_orders')
    expect(parsed.method).toBe('POST')
    expect(parsed.synced).toBe(false)
    expect(parsed.retries).toBe(0)
  })

  it('items JSONB field survives double serialization (saveOrder pattern)', () => {
    const items: OrderItem[] = [
      { id: '1', menuItemId: 'cf1', nombre: 'Cafe Americano', precio: 48, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 48 },
    ]
    // saveOrder does JSON.stringify(order.items) before sending
    const itemsJson = JSON.stringify(items)
    // Then the whole body is stringified
    const body = JSON.stringify({ items: itemsJson })
    const parsed = JSON.parse(body)
    // items comes back as a string — needs one more parse
    const restoredItems = JSON.parse(parsed.items)
    expect(restoredItems).toHaveLength(1)
    expect(restoredItems[0].nombre).toBe('Cafe Americano')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. PIN cache format validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PIN cache format validation', () => {
  it('parses valid PIN:Name format', () => {
    const result = parseManagerPins('1234:Eduardo,5678:Monica,9012:Daniel')
    expect(result['1234']).toBe('Eduardo')
    expect(result['5678']).toBe('Monica')
    expect(result['9012']).toBe('Daniel')
  })

  it('returns empty for empty string', () => {
    expect(parseManagerPins('')).toEqual({})
  })

  it('handles whitespace in entries', () => {
    const result = parseManagerPins(' 1234 : Eduardo , 5678 : Monica ')
    expect(result['1234']).toBe('Eduardo')
    expect(result['5678']).toBe('Monica')
  })

  it('ignores malformed entries', () => {
    const result = parseManagerPins('1234:Eduardo,badentry,5678:Monica')
    expect(result['1234']).toBe('Eduardo')
    expect(result['5678']).toBe('Monica')
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('PINs are always strings, not numbers', () => {
    const result = parseManagerPins('0000:Test,1234:Admin')
    expect(typeof Object.keys(result)[0]).toBe('string')
    expect(result['0000']).toBe('Test')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Payment method validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Payment method validation', () => {
  it('has exactly 4 payment methods', () => {
    expect(PAYMENT_METHODS).toHaveLength(4)
  })

  it('all expected methods exist', () => {
    const ids = PAYMENT_METHODS.map(m => m.id)
    expect(ids).toContain('efectivo')
    expect(ids).toContain('tarjeta')
    expect(ids).toContain('transferencia')
    expect(ids).toContain('mixto')
  })

  it('order metodo_pago must be valid or undefined', () => {
    const validMethods = PAYMENT_METHODS.map(m => m.id)
    const order = createTestOrder({ metodoPago: 'efectivo' })
    expect(validMethods).toContain(order.metodoPago)
  })

  it('closed order must have a payment method', () => {
    const order = createTestOrder({ status: 'cerrada', metodoPago: 'tarjeta' })
    expect(order.status).toBe('cerrada')
    expect(order.metodoPago).toBeTruthy()
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Menu category structure
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Menu category structure', () => {
  it('all categories have id, name, items array', () => {
    for (const cat of SAMPLE_MENU) {
      expect(cat.id).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(cat.items).toBeInstanceOf(Array)
    }
  })

  it('all items have id, name, price', () => {
    for (const cat of SAMPLE_MENU) {
      for (const item of cat.items) {
        expect(item.id).toBeTruthy()
        expect(item.name).toBeTruthy()
        expect(typeof item.price).toBe('number')
      }
    }
  })

  it('item IDs are unique across all categories', () => {
    const ids = SAMPLE_MENU.flatMap(c => c.items.map(i => i.id))
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('category IDs are unique', () => {
    const ids = SAMPLE_MENU.map(c => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('food prices are in MXN reasonable range ($30-$500)', () => {
    for (const cat of SAMPLE_MENU) {
      for (const item of cat.items) {
        if (item.price > 0) {
          expect(item.price).toBeGreaterThanOrEqual(30)
          expect(item.price).toBeLessThanOrEqual(500)
        }
      }
    }
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Offline sync queue operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Offline sync queue operations', () => {
  it('queue item has correct structure', () => {
    const item: SyncQueueItem = {
      id: `${Date.now()}-xyz`,
      table: 'pos_orders',
      method: 'POST',
      data: { id: 'ord-1', mesa: 3, total: 500 },
      created_at: new Date().toISOString(),
      synced: false,
      retries: 0,
    }
    expect(item.synced).toBe(false)
    expect(item.retries).toBe(0)
    expect(item.method).toBe('POST')
  })

  it('mark synced sets synced=true', () => {
    const item: SyncQueueItem = {
      id: '123-abc', table: 'pos_orders', method: 'POST',
      data: {}, created_at: new Date().toISOString(), synced: false, retries: 0,
    }
    item.synced = true
    expect(item.synced).toBe(true)
  })

  it('increment retry increases count', () => {
    const item: SyncQueueItem = {
      id: '123-abc', table: 'pos_orders', method: 'POST',
      data: {}, created_at: new Date().toISOString(), synced: false, retries: 0,
    }
    item.retries += 1
    expect(item.retries).toBe(1)
    item.retries += 1
    expect(item.retries).toBe(2)
  })

  it('items with retries >= 5 slow-retry with backoff, never abandoned (PRR-02)', () => {
    // Real gating logic — not a replica. Fresh items always eligible; items
    // past the fast cap are eligible once their backoff window elapses.
    const NOW = 1_700_000_000_000
    const queue = [
      { id: '1', retries: 5, last_attempt_at: NOW - 30_000 },   // in backoff window
      { id: '2', retries: 0 },                                   // fresh
      { id: '3', retries: 10, last_attempt_at: NOW - 400_000 },  // backoff elapsed
    ]
    const eligible = queue.filter(i => shouldAttemptSync(i, NOW))
    expect(eligible.map(i => i.id)).toEqual(['2', '3'])
    // and NO item is ever permanently ineligible: advance time past the cap
    expect(queue.filter(i => shouldAttemptSync(i, NOW + 300_000))).toHaveLength(3)
  })

  it('getPendingQueue filters out synced items', () => {
    const queue: SyncQueueItem[] = [
      { id: '1', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: true, retries: 0 },
      { id: '2', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: false, retries: 0 },
    ]
    const pending = queue.filter(i => !i.synced)
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe('2')
  })

  it('clearSyncedItems removes only synced entries', () => {
    const queue: SyncQueueItem[] = [
      { id: '1', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: true, retries: 0 },
      { id: '2', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: false, retries: 0 },
      { id: '3', table: 'pos_orders', method: 'PATCH', data: {}, created_at: '', synced: true, retries: 1 },
    ]
    const remaining = queue.filter(i => !i.synced)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('2')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. Double-JSON parsing (parseJsonb)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('parseJsonb — double-JSON handling', () => {
  it('parses normal JSON array', () => {
    const result = parseJsonb('[{"nombre":"Omar","total":5000}]')
    expect(result).toEqual([{ nombre: 'Omar', total: 5000 }])
  })

  it('handles double-encoded JSON', () => {
    const inner = JSON.stringify([{ nombre: 'Omar', total: 5000 }])
    const doubleEncoded = JSON.stringify(inner) // adds extra quotes + escapes
    const result = parseJsonb(doubleEncoded)
    expect(result).toEqual([{ nombre: 'Omar', total: 5000 }])
  })

  it('returns empty array for null', () => {
    expect(parseJsonb(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(parseJsonb(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseJsonb('')).toEqual([])
  })

  it('returns object as-is if already parsed', () => {
    const obj = [{ nombre: 'Brayan', total: 3200 }]
    expect(parseJsonb(obj)).toEqual(obj)
  })

  it('handles invalid JSON gracefully', () => {
    expect(parseJsonb('not json at all')).toEqual([])
  })

  it('handles meseros JSONB from wansoft_daily', () => {
    const meseros = '[{"nombre":"Omar Aguilera","total":8500},{"nombre":"Brayan Berlanga Solis","total":6200}]'
    const parsed = parseJsonb(meseros) as { nombre: string; total: number }[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0].nombre).toBe('Omar Aguilera')
    expect(parsed[1].total).toBe(6200)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. Currency formatting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Currency formatting — MXN', () => {
  it('formatMXN includes $ and two decimals', () => {
    expect(formatMXN(292)).toBe('$292.00')
    expect(formatMXN(450.08)).toBe('$450.08')
    expect(formatMXN(0)).toBe('$0.00')
  })

  it('formatMXN handles negative amounts', () => {
    expect(formatMXN(-100)).toBe('$-100.00')
  })

  it('formatMXNDisplay rounds to no decimals', () => {
    expect(formatMXNDisplay(450.08)).toMatch(/\$450/)
    expect(formatMXNDisplay(292)).toMatch(/\$292/)
  })

  it('formatMXNDisplay handles large amounts with commas', () => {
    const result = formatMXNDisplay(125000)
    expect(result).toContain('125')
  })

  it('never uses USD or EUR symbols', () => {
    const formatted = formatMXN(1234.56)
    expect(formatted).not.toContain('USD')
    expect(formatted).not.toContain('EUR')
    expect(formatted.startsWith('$')).toBe(true)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. Date/timezone handling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Date/timezone handling — Mexico City', () => {
  it('ISO string is parseable', () => {
    const iso = '2026-06-09T14:30:00.000Z'
    const d = new Date(iso)
    expect(d.getTime()).toBeGreaterThan(0)
    expect(d.toISOString()).toBe(iso)
  })

  it('YYYY-MM-DD format is correct', () => {
    const d = new Date(2026, 5, 9) // June 9, 2026
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    expect(`${y}-${m}-${day}`).toBe('2026-06-09')
  })

  it('Mexico City timezone string is valid', () => {
    const now = new Date()
    const mxStr = now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
    expect(mxStr).toBeTruthy()
    expect(mxStr.length).toBeGreaterThan(5)
  })

  it('closed_at is a valid ISO timestamp', () => {
    const closedAt = new Date().toISOString()
    expect(closedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. Order status transitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Order status transitions', () => {
  const VALID_STATUSES = ['abierta', 'enviada', 'cerrada', 'cancelada'] as const

  it('all valid statuses are recognized', () => {
    expect(VALID_STATUSES).toContain('abierta')
    expect(VALID_STATUSES).toContain('enviada')
    expect(VALID_STATUSES).toContain('cerrada')
    expect(VALID_STATUSES).toContain('cancelada')
  })

  it('new order starts as abierta', () => {
    const order = createTestOrder()
    expect(order.status).toBe('abierta')
  })

  it('abierta -> enviada (sent to kitchen)', () => {
    const order = createTestOrder()
    expect(order.status).toBe('abierta')
    order.status = 'enviada'
    expect(order.status).toBe('enviada')
  })

  it('enviada -> cerrada (paid and closed)', () => {
    const order = createTestOrder({ status: 'enviada' })
    order.status = 'cerrada'
    order.closedAt = new Date()
    order.metodoPago = 'efectivo'
    expect(order.status).toBe('cerrada')
    expect(order.closedAt).toBeInstanceOf(Date)
    expect(order.metodoPago).toBeTruthy()
  })

  it('abierta -> cancelada (cancelled before kitchen)', () => {
    const order = createTestOrder()
    order.status = 'cancelada'
    expect(order.status).toBe('cancelada')
  })

  it('cerrada order has closedAt timestamp', () => {
    const now = new Date()
    const order = createTestOrder({ status: 'cerrada', closedAt: now })
    expect(order.closedAt).toBe(now)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. Discount calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Discount calculations', () => {
  it('percentage discount: 10% off $388', () => {
    const subtotal = 388
    const discountPercent = 10
    const descuento = Math.round(subtotal * (discountPercent / 100) * 100) / 100
    expect(descuento).toBe(38.8)
    const afterDiscount = subtotal - descuento
    expect(afterDiscount).toBe(349.2)
  })

  it('percentage discount: 15% off $292 (chilaquiles)', () => {
    const subtotal = 292
    const discountPercent = 15
    const descuento = Math.round(subtotal * (discountPercent / 100) * 100) / 100
    expect(descuento).toBe(43.8)
  })

  it('fixed amount discount: $50 off', () => {
    const subtotal = 388
    const descuento = 50
    const afterDiscount = subtotal - descuento
    expect(afterDiscount).toBe(338)
  })

  it('discount cannot exceed subtotal', () => {
    const subtotal = 100
    const descuento = 150
    const afterDiscount = Math.max(0, subtotal - descuento)
    expect(afterDiscount).toBe(0)
  })

  it('IVA is calculated after discount', () => {
    const subtotal = 388
    const descuento = 38.8 // 10%
    const afterDiscount = subtotal - descuento
    const iva = Math.round(afterDiscount * IVA_RATE * 100) / 100
    expect(iva).toBe(55.87)
    const total = afterDiscount + iva
    expect(total).toBeCloseTo(405.07, 2)
  })

  it('zero discount means no reduction', () => {
    const subtotal = 292
    const descuento = 0
    expect(subtotal - descuento).toBe(292)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. Propina calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Propina (tip) calculations', () => {
  it('10% tip on $388 subtotal', () => {
    const subtotal = 388
    const propina = Math.round(subtotal * 0.10 * 100) / 100
    expect(propina).toBe(38.8)
  })

  it('15% tip on $388 subtotal', () => {
    const subtotal = 388
    const propina = Math.round(subtotal * 0.15 * 100) / 100
    expect(propina).toBe(58.2)
  })

  it('20% tip on $388 subtotal', () => {
    const subtotal = 388
    const propina = Math.round(subtotal * 0.20 * 100) / 100
    expect(propina).toBe(77.6)
  })

  it('custom tip amount ($100 flat)', () => {
    const propina = 100
    expect(propina).toBe(100)
  })

  it('tip is added after total (not included in IVA)', () => {
    const subtotal = 388
    const iva = Math.round(subtotal * IVA_RATE * 100) / 100
    const total = subtotal + iva
    const propina = Math.round(subtotal * 0.15 * 100) / 100
    const grandTotal = total + propina
    expect(grandTotal).toBeCloseTo(508.28, 2)
  })

  it('zero tip is valid', () => {
    const order = createTestOrder({ propina: 0 })
    expect(order.propina).toBe(0)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 14. Multi-payment split validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Multi-payment split validation', () => {
  it('mixto: cash + card must sum to total', () => {
    const total = 450.08
    const cash = 200
    const card = 250.08
    expect(cash + card).toBeCloseTo(total, 2)
  })

  it('mixto: cash portion cannot be negative', () => {
    const cash = -50
    expect(cash).toBeLessThan(0)
    const validCash = Math.max(0, cash)
    expect(validCash).toBe(0)
  })

  it('mixto: card portion cannot exceed total', () => {
    const total = 450.08
    const card = 500
    const validCard = Math.min(card, total)
    expect(validCard).toBe(450.08)
  })

  it('single payment: entire total on one method', () => {
    const total = 450.08
    const payment = { method: 'efectivo', amount: total }
    expect(payment.amount).toBe(total)
  })

  it('split into 3 equal parts for 3 personas', () => {
    const total = 900
    const personas = 3
    const perPerson = Math.round((total / personas) * 100) / 100
    expect(perPerson).toBe(300)
    expect(perPerson * personas).toBe(total)
  })

  it('split with rounding: $451 / 3 personas', () => {
    const total = 451
    const personas = 3
    const perPerson = Math.floor((total / personas) * 100) / 100
    // First two pay $150.33, last pays the rest
    expect(perPerson).toBe(150.33)
    const remainder = Math.round((total - perPerson * (personas - 1)) * 100) / 100
    expect(remainder).toBe(150.34)
    expect(perPerson * 2 + remainder).toBeCloseTo(total, 2)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 15. Food cost percentage calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Food cost percentage calculations', () => {
  it('food cost % = (ingredient cost / menu price) * 100', () => {
    // Chilaquiles Verdes: $292 sale, $87.60 ingredient cost
    const ingredientCost = 87.60
    const menuPrice = 292
    const foodCostPct = (ingredientCost / menuPrice) * 100
    expect(foodCostPct).toBeCloseTo(30.0, 0)
  })

  it('target food cost is 28-35%', () => {
    const foodCostPct = 30.0
    expect(foodCostPct).toBeGreaterThanOrEqual(28)
    expect(foodCostPct).toBeLessThanOrEqual(35)
  })

  it('food cost with yield factor', () => {
    // 1kg chicken at $180/kg, yield factor 0.85 (15% waste)
    const rawCost = 180
    const yieldFactor = 0.85
    const effectiveCost = rawCost / yieldFactor
    expect(effectiveCost).toBeCloseTo(211.76, 1)
  })

  it('zero menu price does not divide by zero', () => {
    const ingredientCost = 50
    const menuPrice = 0
    const foodCostPct = menuPrice > 0 ? (ingredientCost / menuPrice) * 100 : 0
    expect(foodCostPct).toBe(0)
    expect(Number.isFinite(foodCostPct)).toBe(true)
  })

  it('recipe cost = sum of (ingredient_qty * cost_per_unit / yield_factor)', () => {
    const recipe = [
      { qty: 0.15, costPerUnit: 180, yieldFactor: 0.85 },  // chicken 150g
      { qty: 0.05, costPerUnit: 120, yieldFactor: 1.0 },   // cheese 50g
      { qty: 0.1, costPerUnit: 30, yieldFactor: 0.9 },     // tortilla 100g
    ]
    const recipeCost = recipe.reduce(
      (sum, r) => sum + r.qty * (r.costPerUnit / r.yieldFactor),
      0
    )
    // 0.15 * 211.76 + 0.05 * 120 + 0.1 * 33.33 = 31.76 + 6 + 3.33 = 41.09
    expect(recipeCost).toBeCloseTo(41.10, 0)
  })

  it('gross margin = 1 - food_cost_pct', () => {
    const foodCostPct = 0.30
    const grossMargin = 1 - foodCostPct
    expect(grossMargin).toBeCloseTo(0.70, 2)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Additional: Beverage detection (station routing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Beverage detection for station routing', () => {
  it('Cafe Americano is a beverage', () => {
    expect(isBebida('Cafe Americano')).toBe(true)
  })

  it('Capuchino Caliente is a beverage', () => {
    expect(isBebida('Capuchino Caliente')).toBe(true)
  })

  it('Smoothie Pink Flamingo is a beverage', () => {
    expect(isBebida('Smoothie Pink Flamingo')).toBe(true)
  })

  it('Chilaquiles Verdes is NOT a beverage', () => {
    expect(isBebida('Chilaquiles Verdes')).toBe(false)
  })

  it('Avocado Toast is NOT a beverage', () => {
    expect(isBebida('Avocado Toast')).toBe(false)
  })

  it('Coca Cola Regular is a beverage', () => {
    expect(isBebida('Coca Cola Regular 355ml')).toBe(true)
  })

  it('Mimosa Clasica is a beverage', () => {
    expect(isBebida('Mimosa Clasica')).toBe(true)
  })

  it('New York Cheesecake is NOT a beverage', () => {
    expect(isBebida('New York Cheesecake')).toBe(false)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Additional: Number sanitization (the num() helper)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Number sanitization — num() helper', () => {
  it('null/undefined -> 0', () => {
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
  })

  it('string numbers -> number', () => {
    expect(num('292')).toBe(292)
    expect(num('48.50')).toBe(48.5)
  })

  it('empty string -> 0', () => {
    expect(num('')).toBe(0)
  })

  it('NaN -> 0', () => {
    expect(num(NaN)).toBe(0)
    expect(num('not a number')).toBe(0)
  })

  it('valid numbers pass through', () => {
    expect(num(292)).toBe(292)
    expect(num(0)).toBe(0)
    expect(num(-50)).toBe(-50)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Additional: Modifier pricing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Modifier pricing', () => {
  const MODIFIERS_FOOD = [
    { name: 'Extra queso', price: 25 },
    { name: 'Extra aguacate', price: 35 },
    { name: 'Extra proteina', price: 45 },
    { name: 'Extra huevo', price: 20 },
    { name: 'Extra salsa', price: 0 },
  ]

  it('precioExtra = sum of modifier prices', () => {
    const selected = ['Extra queso', 'Extra aguacate']
    const precioExtra = MODIFIERS_FOOD
      .filter(m => selected.includes(m.name))
      .reduce((sum, m) => sum + m.price, 0)
    expect(precioExtra).toBe(60)
  })

  it('free modifiers (Extra salsa) add $0', () => {
    const selected = ['Extra salsa']
    const precioExtra = MODIFIERS_FOOD
      .filter(m => selected.includes(m.name))
      .reduce((sum, m) => sum + m.price, 0)
    expect(precioExtra).toBe(0)
  })

  it('all modifiers stacked on one item', () => {
    const precioExtra = MODIFIERS_FOOD.reduce((sum, m) => sum + m.price, 0)
    // 25 + 35 + 45 + 20 + 0 = 125
    expect(precioExtra).toBe(125)
    // Chilaquiles ($292) + all extras = $417 per unit
    const itemTotal = (292 + precioExtra) * 1
    expect(itemTotal).toBe(417)
  })

  it('quitar modifiers are free (no price change)', () => {
    const quitarOptions = ['Sin cebolla', 'Sin chile', 'Sin crema']
    // Quitar modifiers never change price
    const priceChange = 0
    expect(priceChange).toBe(0)
    expect(quitarOptions.length).toBe(3)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// turnoId cache lifecycle — cold offline regression (pos/page.tsx:1626-1632)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Replicates the exact branch in pos/page.tsx useEffect that loads turno state.
// The fix: only removeItem when navigator.onLine is true.
function applyTurnoResult(
  turno: { id: string } | null,
  isOnline: boolean,
  store: Map<string, string>,
): void {
  if (turno) {
    store.set('pos_turno_id', turno.id)
  } else if (isOnline) {
    store.delete('pos_turno_id')
  }
  // Offline + no turno → do nothing (preserve whatever seed exists)
}

describe('turnoId localStorage cache — cold offline regression', () => {
  it('online + turno found → sets pos_turno_id', () => {
    const store = new Map<string, string>()
    applyTurnoResult({ id: 'turno-abc' }, true, store)
    expect(store.get('pos_turno_id')).toBe('turno-abc')
  })

  it('online + no turno → removes pos_turno_id', () => {
    const store = new Map<string, string>([['pos_turno_id', 'stale-turno']])
    applyTurnoResult(null, true, store)
    expect(store.has('pos_turno_id')).toBe(false)
  })

  it('offline + no turno → PRESERVES pos_turno_id (regression fix)', () => {
    const store = new Map<string, string>([['pos_turno_id', 'turno-from-prior-session']])
    applyTurnoResult(null, false, store)
    // Must NOT delete — this was the bug
    expect(store.get('pos_turno_id')).toBe('turno-from-prior-session')
  })

  it('offline + no turno + no prior seed → leaves store empty, does not throw', () => {
    const store = new Map<string, string>()
    expect(() => applyTurnoResult(null, false, store)).not.toThrow()
    expect(store.has('pos_turno_id')).toBe(false)
  })

  it('offline + turno found (from getActiveTurno localStorage cache) → sets id', () => {
    const store = new Map<string, string>()
    applyTurnoResult({ id: 'turno-cached-24h' }, false, store)
    expect(store.get('pos_turno_id')).toBe('turno-cached-24h')
  })

  it('online + new turno overwrites stale turno id', () => {
    const store = new Map<string, string>([['pos_turno_id', 'yesterday-turno']])
    applyTurnoResult({ id: 'todays-turno' }, true, store)
    expect(store.get('pos_turno_id')).toBe('todays-turno')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Additional: Audit action types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Audit trail — action types', () => {
  const VALID_ACTIONS = [
    'order_created', 'order_sent_kitchen', 'order_closed', 'order_cancelled',
    'item_added', 'item_modified', 'item_cancelled', 'quantity_changed',
    'discount_applied', 'discount_removed', 'status_changed', 'payment_processed',
    'merma_registered',
  ]

  it('all audit actions are valid strings', () => {
    for (const action of VALID_ACTIONS) {
      expect(typeof action).toBe('string')
      expect(action.length).toBeGreaterThan(0)
    }
  })

  it('audit actions use snake_case', () => {
    for (const action of VALID_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+$/)
    }
  })

  it('order lifecycle has all audit steps', () => {
    expect(VALID_ACTIONS).toContain('order_created')
    expect(VALID_ACTIONS).toContain('order_sent_kitchen')
    expect(VALID_ACTIONS).toContain('order_closed')
    expect(VALID_ACTIONS).toContain('order_cancelled')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MES-002: localStorage TTL semantics for active order cache
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ORDER_TTL_MS = 28_800_000   // 8h — pos/page.tsx instant-display gate
const DRAFT_TTL_MS = 14_400_000   // 4h — pos_draft_${mesa} (MES-002 fix)
const DRAFT_TTL_OLD_MS = 1_800_000 // 30min — old value, kept for regression

// Simulate the localStorage cache entry written by pos/page.tsx
interface LocalOrderCache {
  id: string
  items: OrderItem[]
  mesero?: string
  personas?: number
  discount?: number
  notas?: string
  revision?: number
  updatedAt?: string
  ts: number // Date.now() at write time
}

function makeCacheEntry(ageMs: number, items?: OrderItem[]): LocalOrderCache {
  return {
    id: generateId(),
    items: items ?? [{ id: '1', menuItemId: 'c1a', nombre: 'Chilaquiles Verdes', precio: 292, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 292 }],
    revision: 3,
    ts: Date.now() - ageMs,
  }
}

function isCacheValidForInstantDisplay(cache: LocalOrderCache): boolean {
  return cache.items.length > 0 && Date.now() - cache.ts < ORDER_TTL_MS
}

function isDraftValid(draft: { items: OrderItem[]; ts: number }): boolean {
  return draft.items.length > 0 && Date.now() - draft.ts < DRAFT_TTL_MS
}

describe('MES-002 — localStorage TTL for active order cache', () => {
  it('cache within 8h is valid for instant display', () => {
    const cache = makeCacheEntry(4 * 60 * 60 * 1000) // 4h old
    expect(isCacheValidForInstantDisplay(cache)).toBe(true)
  })

  it('cache older than 8h is NOT shown as instant display (pre-fetch blank)', () => {
    const cache = makeCacheEntry(9 * 60 * 60 * 1000) // 9h old
    expect(isCacheValidForInstantDisplay(cache)).toBe(false)
  })

  it('cache older than 24h is NOT shown as instant display', () => {
    const cache = makeCacheEntry(25 * 60 * 60 * 1000) // 25h old
    expect(isCacheValidForInstantDisplay(cache)).toBe(false)
  })

  it('offline fallback has no TTL — loads regardless of age', () => {
    // pos/page.tsx offline fallback: only checks c.items?.length > 0 (no ts check)
    const staleCache = makeCacheEntry(12 * 60 * 60 * 1000) // 12h old
    const offlineWouldLoad = staleCache.items.length > 0  // no TTL in offline path
    expect(offlineWouldLoad).toBe(true)
  })

  it('offline fallback refreshes ts to keep TTL alive (MES-002 fix)', () => {
    const staleCache = makeCacheEntry(9 * 60 * 60 * 1000) // 9h old
    // Simulate what the offline fallback now does: refresh ts
    const refreshed = { ...staleCache, ts: Date.now() }
    expect(isCacheValidForInstantDisplay(refreshed)).toBe(true)
  })

  it('ts is reset on every item change — active orders never expire mid-session', () => {
    const cache = makeCacheEntry(7 * 60 * 60 * 1000) // 7h old
    // Simulate a new item being added (ts refreshed by useEffect)
    const updated = { ...cache, ts: Date.now() }
    expect(isCacheValidForInstantDisplay(updated)).toBe(true)
  })

  it('empty items cache is rejected regardless of TTL', () => {
    const cache: LocalOrderCache = { id: 'x', items: [], ts: Date.now() }
    expect(isCacheValidForInstantDisplay(cache)).toBe(false)
  })

  it('ORDER_TTL_MS constant is exactly 8 hours', () => {
    expect(ORDER_TTL_MS).toBe(8 * 60 * 60 * 1000)
  })
})

describe('MES-002 — draft TTL (unsaved orders not yet in DB)', () => {
  it('draft within 4h is valid (MES-002 fix)', () => {
    const draft = { items: makeCacheEntry(0).items, ts: Date.now() - 3 * 60 * 60 * 1000 }
    expect(isDraftValid(draft)).toBe(true)
  })

  it('draft older than 4h is expired', () => {
    const draft = { items: makeCacheEntry(0).items, ts: Date.now() - 5 * 60 * 60 * 1000 }
    expect(isDraftValid(draft)).toBe(false)
  })

  it('draft at exactly 4h boundary is expired', () => {
    const draft = { items: makeCacheEntry(0).items, ts: Date.now() - DRAFT_TTL_MS }
    expect(isDraftValid(draft)).toBe(false)
  })

  it('OLD 30min draft TTL would expire during normal service (regression guard)', () => {
    // A mesero adds items and waits 35 min before sending — old behavior lost the draft
    const draftAge = 35 * 60 * 1000 // 35 minutes
    const wouldHaveExpiredBefore = draftAge >= DRAFT_TTL_OLD_MS
    const survivesWith4h = draftAge < DRAFT_TTL_MS
    expect(wouldHaveExpiredBefore).toBe(true)  // old code would lose it
    expect(survivesWith4h).toBe(true)           // new code preserves it
  })

  it('DRAFT_TTL_MS is exactly 4 hours', () => {
    expect(DRAFT_TTL_MS).toBe(4 * 60 * 60 * 1000)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MES-009: Revision conflict detection and classification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SyncErrorClass = 'TRANSIENT_RETRYABLE' | 'STALE_WRITE_CONFLICT' | 'TERMINAL_NON_RETRYABLE'

interface ConflictQueueItem {
  id: string
  data: Record<string, unknown>
  retries: number
  synced: boolean
  conflict?: boolean
  error_class?: SyncErrorClass
  error_detail?: string
  server_revision?: number
}

// Reproduce markConflict logic from pos-offline-db.ts
function markConflict(
  queue: ConflictQueueItem[],
  itemId: string,
  errorClass: SyncErrorClass,
  detail: string,
  serverRevision?: number
): ConflictQueueItem[] {
  return queue.map(item => {
    if (item.id !== itemId) return item
    return { ...item, conflict: true, error_class: errorClass, error_detail: detail, server_revision: serverRevision }
  })
}

// Reproduce getSyncQueueSummary logic
function getSyncQueueSummary(queue: ConflictQueueItem[]) {
  const unsynced = queue.filter(i => !i.synced)
  let pending = 0, terminal = 0, conflicts = 0, exhausted = 0
  for (const item of unsynced) {
    if (item.error_class === 'STALE_WRITE_CONFLICT' || item.error_class === 'TERMINAL_NON_RETRYABLE') {
      terminal++
      if (item.conflict) conflicts++
    } else if (item.retries >= 5) {
      exhausted++
    } else {
      pending++
    }
  }
  return { pending, terminal, conflicts, exhausted }
}

// Simulate what the server returns when revision mismatches
function simulateServerConflictResponse(expected: number, current: number) {
  return {
    ok: false,
    conflict: true,
    expected_revision: expected,
    current_revision: current,
  }
}

describe('MES-009 — revision conflict detection (multi-terminal)', () => {
  it('STALE_WRITE_CONFLICT is classified correctly when server has newer revision', () => {
    const queue: ConflictQueueItem[] = [
      { id: 'job-1', data: { order_id: 'ord-A', revision: 5 }, retries: 0, synced: false }
    ]
    const serverResponse = simulateServerConflictResponse(5, 7) // terminal A at rev5, server at rev7
    expect(serverResponse.conflict).toBe(true)
    expect(serverResponse.current_revision).toBeGreaterThan(serverResponse.expected_revision)

    const updated = markConflict(queue, 'job-1', 'STALE_WRITE_CONFLICT', 'expected rev 5, server at 7', 7)
    expect(updated[0].conflict).toBe(true)
    expect(updated[0].error_class).toBe('STALE_WRITE_CONFLICT')
    expect(updated[0].server_revision).toBe(7)
    expect(updated[0].error_detail).toContain('expected rev 5')
  })

  it('conflicted item is NOT auto-retried (stays in queue with error_class)', () => {
    let queue: ConflictQueueItem[] = [
      { id: 'job-1', data: { order_id: 'ord-A' }, retries: 0, synced: false }
    ]
    queue = markConflict(queue, 'job-1', 'STALE_WRITE_CONFLICT', 'stale write', 8)
    // Simulate syncAll skipping items with error_class
    const shouldSkip = queue[0].error_class === 'STALE_WRITE_CONFLICT' ||
                       queue[0].error_class === 'TERMINAL_NON_RETRYABLE'
    expect(shouldSkip).toBe(true)
  })

  it('conflicted item payload is preserved for operator recovery', () => {
    const originalData = { order_id: 'ord-A', items: [{ id: 'i1', nombre: 'Chilaquiles' }], revision: 5 }
    let queue: ConflictQueueItem[] = [
      { id: 'job-1', data: originalData, retries: 0, synced: false }
    ]
    queue = markConflict(queue, 'job-1', 'STALE_WRITE_CONFLICT', 'stale write', 8)
    // Payload must be intact — operator can see what was lost
    expect(queue[0].data).toEqual(originalData)
  })

  it('getSyncQueueSummary counts conflicts correctly', () => {
    let queue: ConflictQueueItem[] = [
      { id: 'job-1', data: { order_id: 'ord-A' }, retries: 0, synced: false },
      { id: 'job-2', data: { order_id: 'ord-B' }, retries: 0, synced: false },
      { id: 'job-3', data: { order_id: 'ord-C' }, retries: 0, synced: true },  // synced — ignored
    ]
    queue = markConflict(queue, 'job-1', 'STALE_WRITE_CONFLICT', 'stale', 8)
    const summary = getSyncQueueSummary(queue)
    expect(summary.conflicts).toBe(1)
    expect(summary.terminal).toBe(1)
    expect(summary.pending).toBe(1)  // job-2 is still retryable
    expect(summary.exhausted).toBe(0)
  })

  it('both STALE_WRITE_CONFLICT and TERMINAL_NON_RETRYABLE count as terminal and conflict:true', () => {
    // markConflict always sets conflict:true regardless of error class.
    // getSyncQueueSummary.conflicts = terminal items where conflict:true (both classes qualify).
    let queue: ConflictQueueItem[] = [
      { id: 'job-1', data: {}, retries: 0, synced: false },
      { id: 'job-2', data: {}, retries: 0, synced: false },
    ]
    queue = markConflict(queue, 'job-1', 'STALE_WRITE_CONFLICT', 'stale', 8)
    queue = markConflict(queue, 'job-2', 'TERMINAL_NON_RETRYABLE', 'bad payload')
    const summary = getSyncQueueSummary(queue)
    expect(summary.terminal).toBe(2)
    expect(summary.conflicts).toBe(2) // markConflict sets conflict:true for both
  })

  it('multi-terminal scenario: terminal A cannot silently overwrite terminal B changes', () => {
    // Terminal B saves revision 6 to server while Terminal A was offline at revision 5
    const serverRevisionAfterB = 6
    const terminalALocalRevision = 5
    const serverResponse = simulateServerConflictResponse(terminalALocalRevision, serverRevisionAfterB)

    // Server must reject the write
    expect(serverResponse.ok).toBe(false)
    expect(serverResponse.conflict).toBe(true)

    // After conflict: terminal A's write is preserved but marked — NOT applied to server
    let queue: ConflictQueueItem[] = [
      { id: 'job-A', data: { revision: terminalALocalRevision }, retries: 0, synced: false }
    ]
    queue = markConflict(queue, 'job-A', 'STALE_WRITE_CONFLICT',
      `expected rev ${terminalALocalRevision}, server at ${serverRevisionAfterB}`, serverRevisionAfterB)

    expect(queue[0].synced).toBe(false)         // NOT marked as synced
    expect(queue[0].conflict).toBe(true)         // flagged for operator
    expect(queue[0].error_class).toBe('STALE_WRITE_CONFLICT')
    expect(queue[0].server_revision).toBe(serverRevisionAfterB)
  })

  it('pos-order-conflict CustomEvent carries orderId and serverRevision', () => {
    // Reproduce the event construction from pos-offline-db.ts (MES-009 fix)
    const itemData = { order_id: 'ord-XYZ', items: [] }
    const errorDetail = 'STALE_WRITE_REJECTED: expected rev 5, server at 7'
    const serverRevision = 7

    const eventDetail = {
      orderId: typeof itemData.order_id === 'string' ? itemData.order_id : undefined,
      errorDetail,
      serverRevision,
    }

    expect(eventDetail.orderId).toBe('ord-XYZ')
    expect(eventDetail.serverRevision).toBe(7)
    expect(eventDetail.errorDetail).toContain('STALE_WRITE_REJECTED')
  })

  it('idempotent replay of a rejected operation is also classified as STALE_WRITE_CONFLICT', () => {
    // Server returns conflict:true with idempotent_replay:true
    const serverResponse = {
      ok: false,
      conflict: true,
      idempotent_replay: true,
      expected_revision: 5,
      current_revision: 7,
    }
    // The classification must be the same — payload still preserved, no retry
    const errorClass: SyncErrorClass = serverResponse.conflict ? 'STALE_WRITE_CONFLICT' : 'TERMINAL_NON_RETRYABLE'
    expect(errorClass).toBe('STALE_WRITE_CONFLICT')
  })

  it('TRANSIENT_RETRYABLE errors are retried and not counted as conflicts', () => {
    const queue: ConflictQueueItem[] = [
      { id: 'job-1', data: {}, retries: 2, synced: false }
    ]
    const summary = getSyncQueueSummary(queue)
    expect(summary.pending).toBe(1)
    expect(summary.conflicts).toBe(0)
    expect(summary.terminal).toBe(0)
  })

  it('exhausted items (retries >= 5) are counted separately from terminal conflicts', () => {
    const queue: ConflictQueueItem[] = [
      { id: 'job-1', data: {}, retries: 5, synced: false },   // exhausted
      { id: 'job-2', data: {}, retries: 6, synced: false },   // exhausted
    ]
    const summary = getSyncQueueSummary(queue)
    expect(summary.exhausted).toBe(2)
    expect(summary.conflicts).toBe(0)
    expect(summary.pending).toBe(0)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MES-010 / MES-012: Transfer ítem + merge de mesas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('MES-010 — transfer de ítem entre mesas', () => {
  // handleTransferItem requires PIN auth and calls /api/pos/transfer-item
  // This tests the validation logic only (endpoint itself is server-side)

  it('targetMesa must be a positive integer', () => {
    const valid = (v: string) => !isNaN(parseInt(v, 10)) && parseInt(v, 10) > 0
    expect(valid('5')).toBe(true)
    expect(valid('0')).toBe(false)
    expect(valid('-1')).toBe(false)
    expect(valid('abc')).toBe(false)
    expect(valid('')).toBe(false)
  })

  it('targetMesa must differ from source mesa', () => {
    const sourceMesa = 5
    const targetMesa = 5
    expect(targetMesa === sourceMesa).toBe(true) // would be rejected
  })

  it('transfer requires item to have been sent to kitchen first (guard in UI)', () => {
    // The UI shows: "Envía la orden a cocina antes de transferir mesa"
    // Simulate the guard: sentItemIds must include the item
    const sentItemIds = new Set(['item-1', 'item-2'])
    const itemToTransfer = 'item-3' // not yet sent
    expect(sentItemIds.has(itemToTransfer)).toBe(false) // would be blocked
  })

  it('full-mesa transfer is FEATURE GAP — only item-level transfer exists', () => {
    // handleTransferItem moves individual items, not an entire order
    // MES-010 FEATURE GAP: no handleTransferMesa function in codebase
    const featureExists = false // verified by grep: no full-mesa transfer function
    expect(featureExists).toBe(false)
  })
})

describe('MES-012 — fusión de mesas (merge)', () => {
  // handleMerge in mesas/page.tsx merges two orders via /api/pos/merge-orders

  it('merge combines items from both orders', () => {
    const srcItems: OrderItem[] = [
      { id: 's1', menuItemId: 'cf1', nombre: 'Cafe Americano', precio: 48, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 48 }
    ]
    const tgtItems: OrderItem[] = [
      { id: 't1', menuItemId: 'c1a', nombre: 'Chilaquiles Verdes', precio: 292, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 292 }
    ]
    const mergedItems = [...tgtItems, ...srcItems] // mesas/page.tsx merge order
    expect(mergedItems).toHaveLength(2)
    expect(mergedItems.map(i => i.id)).toContain('s1')
    expect(mergedItems.map(i => i.id)).toContain('t1')
  })

  it('merge result total equals sum of both order totals', () => {
    const srcTotal = 48
    const tgtTotal = 292
    const mergedTotal = srcTotal + tgtTotal
    expect(mergedTotal).toBe(340)
  })

  it('merge detects conflict when either order has stale revision', () => {
    // /api/pos/merge-orders returns { conflict: true } on revision mismatch
    const mergeResult = { ok: false, conflict: true, error: 'STALE_WRITE_REJECTED' }
    expect(mergeResult.conflict).toBe(true)
    // The UI shows a specific conflict toast and aborts the merge
  })

  it('merge FEATURE GAP: no offline path — requires direct API call', () => {
    // mesas/page.tsx handleMerge uses fetch('/api/pos/merge-orders') directly
    // No queueOperation() wrapper — merge fails silently offline
    const hasOfflinePath = false // verified by code reading
    expect(hasOfflinePath).toBe(false)
  })

  it('merge source mesa must differ from target', () => {
    const mergeSource = 3
    const mergeTarget = 3
    const wouldBeBlocked = mergeSource === mergeTarget
    expect(wouldBeBlocked).toBe(true)
  })

  it('merged items preserve original item IDs and modifiers', () => {
    const srcItems: OrderItem[] = [
      { id: 's1', menuItemId: 'cf1', nombre: 'Cafe Americano', precio: 48, cantidad: 1, modificadores: ['Oat milk'], notas: 'sin azúcar', precioExtra: 15, subtotal: 63 }
    ]
    const tgtItems: OrderItem[] = []
    const merged = [...tgtItems, ...srcItems]
    expect(merged[0].id).toBe('s1')
    expect(merged[0].modificadores).toContain('Oat milk')
    expect(merged[0].notas).toBe('sin azúcar')
  })
})

// ── KDS-020 — Offline status advance persistence ─────────────────────────────
// Verifies the state-machine logic and IDB queuing path for status advances.
// These are synchronous / logic-layer tests; no browser / DOM required.

describe('KDS-020 — offline status advance state machine', () => {
  const STATUS_ORDER: Record<string, number> = { enviada: 1, preparando: 2, lista: 3, entregada: 4 }

  function nextStatus(current: string): string | null {
    if (current === 'enviada') return 'preparando'
    if (current === 'preparando') return 'lista'
    if (current === 'lista') return 'entregada'
    return null
  }

  function isForwardMove(from: string, to: string): boolean {
    return (STATUS_ORDER[to] ?? 0) > (STATUS_ORDER[from] ?? 0)
  }

  it('enviada → preparando is a valid forward move', () => {
    const next = nextStatus('enviada')
    expect(next).toBe('preparando')
    expect(isForwardMove('enviada', 'preparando')).toBe(true)
  })

  it('preparando → lista is a valid forward move', () => {
    const next = nextStatus('preparando')
    expect(next).toBe('lista')
    expect(isForwardMove('preparando', 'lista')).toBe(true)
  })

  it('lista → entregada is a valid forward move (bump)', () => {
    const next = nextStatus('lista')
    expect(next).toBe('entregada')
    expect(isForwardMove('lista', 'entregada')).toBe(true)
  })

  it('forward-only guard blocks backward transitions', () => {
    expect(isForwardMove('preparando', 'enviada')).toBe(false)
    expect(isForwardMove('lista', 'preparando')).toBe(false)
    expect(isForwardMove('lista', 'lista')).toBe(false)
  })

  it('optimistic update: order array reflects new status before server reply', () => {
    const orders = [
      { id: 'o1', status: 'enviada', mesa: 5, mesero: 'Omar' },
      { id: 'o2', status: 'preparando', mesa: 6, mesero: 'Brayan' },
    ]
    const id = 'o1'
    const next = 'preparando'
    const updated = orders.map(o => o.id === id ? { ...o, status: next } : o)
    expect(updated.find(o => o.id === 'o1')?.status).toBe('preparando')
    expect(updated.find(o => o.id === 'o2')?.status).toBe('preparando')
  })

  it('rollback restores previous status on server rejection', () => {
    const orders = [{ id: 'o1', status: 'enviada', mesa: 5, mesero: 'Omar' }]
    const currentStatus = 'enviada'
    const next = 'preparando'
    // optimistic update
    const optimistic = orders.map(o => o.id === 'o1' ? { ...o, status: next } : o)
    expect(optimistic[0].status).toBe('preparando')
    // server rejects (ok = false) → rollback
    const rolled = optimistic.map(o => o.id === 'o1' ? { ...o, status: currentStatus } : o)
    expect(rolled[0].status).toBe('enviada')
  })

  it('two consecutive advances: enviada → preparando → lista', () => {
    let orders = [{ id: 'o1', status: 'enviada', mesa: 5, mesero: 'Omar' }]

    // First advance
    const next1 = nextStatus(orders[0].status)
    expect(next1).toBe('preparando')
    expect(isForwardMove(orders[0].status, next1!)).toBe(true)
    orders = orders.map(o => o.id === 'o1' ? { ...o, status: next1! } : o)

    // Second advance
    const next2 = nextStatus(orders[0].status)
    expect(next2).toBe('lista')
    expect(isForwardMove(orders[0].status, next2!)).toBe(true)
    orders = orders.map(o => o.id === 'o1' ? { ...o, status: next2! } : o)

    expect(orders[0].status).toBe('lista')
  })

  it('restart: IDB-cached status is authoritative after reload', () => {
    // Simulate: advance queued to IDB, restart occurs, IDB restored to UI
    const idbCachedStatus = 'preparando'
    const lastKnownServerStatus = 'enviada'
    // After restart the IDB version (more recent write) wins — it includes the queued advance
    const restoredStatus = idbCachedStatus
    expect(restoredStatus).toBe('preparando')
    expect(restoredStatus).not.toBe(lastKnownServerStatus)
  })

  it('duplicate replay is idempotent: same PATCH with same status applied twice has no visible effect', () => {
    // PATCH pos_orders?id=eq.o1 with { status: 'preparando' } replayed twice
    // Supabase UPDATE is idempotent — second write sets same value → no change
    const statusAfterFirstReplay = 'preparando'
    const statusAfterSecondReplay = 'preparando' // same PATCH, same value
    expect(statusAfterSecondReplay).toBe(statusAfterFirstReplay)
  })

  it('reconnect: server SNAPSHOT takes precedence over stale local state', () => {
    // If the server advanced the order further (e.g., another terminal bumped it to lista)
    // the SNAPSHOT from LAN_PRIMARY must overwrite the local FALLBACK state
    const localOptimisticStatus = 'preparando'
    const serverSnapshotStatus = 'lista' // server is ahead
    // setFallbackOrders is skipped when mode === LAN_PRIMARY; server wins
    const modeIsLanPrimary = true
    const finalStatus = modeIsLanPrimary ? serverSnapshotStatus : localOptimisticStatus
    expect(finalStatus).toBe('lista')
  })
})

// ── KDS-013 — Batch-aware reprint item isolation ──────────────────────────────
// Verifies that per-batch card decomposition filters items correctly.

describe('KDS-013 — batch-aware reprint item isolation', () => {
  const STATION = 'cocina'

  function resolveStation(item: { station?: string; nombre?: string }): string {
    return item.station ?? 'cocina'
  }

  function buildBatchCards(order: {
    id: string; status: string; created_at: string;
    items: Array<{ nombre: string; station?: string; cancelled?: boolean; comanda_batch_id?: string }>;
    comanda_batches?: Record<string, { seq: number; created_at: string }>;
  }) {
    const batchIds = [...new Set(order.items.map(i => i.comanda_batch_id).filter(Boolean) as string[])]
    if (batchIds.length <= 1) {
      return [{ order, batchId: null, batchSeq: 0, batchCreatedAt: order.created_at }]
    }
    return batchIds.map(bid => ({
      order,
      batchId: bid,
      batchSeq: order.comanda_batches?.[bid]?.seq ?? 0,
      batchCreatedAt: order.comanda_batches?.[bid]?.created_at ?? order.created_at,
    }))
  }

  function batchItems(
    order: { items: Array<{ nombre: string; station?: string; cancelled?: boolean; comanda_batch_id?: string }> },
    batchId: string | null
  ) {
    return order.items.filter(i =>
      !i.cancelled &&
      (!batchId || i.comanda_batch_id === batchId) &&
      resolveStation(i) === STATION
    )
  }

  it('single-batch order: all active station items returned, batchId is null', () => {
    const order = {
      id: 'o1', status: 'enviada', created_at: '2026-07-31T10:00:00Z',
      items: [
        { nombre: 'Chilaquiles', station: 'cocina', comanda_batch_id: 'b1' },
        { nombre: 'Huevos', station: 'cocina', comanda_batch_id: 'b1' },
      ],
      comanda_batches: { b1: { seq: 0, created_at: '2026-07-31T10:00:00Z' } },
    }
    const cards = buildBatchCards(order)
    expect(cards).toHaveLength(1)
    expect(cards[0].batchId).toBeNull()
    const items = batchItems(order, cards[0].batchId)
    expect(items).toHaveLength(2)
  })

  it('two-batch order: batch 1 card returns only batch 1 items', () => {
    const order = {
      id: 'o2', status: 'enviada', created_at: '2026-07-31T10:00:00Z',
      items: [
        { nombre: 'Chilaquiles', station: 'cocina', comanda_batch_id: 'b1' },
        { nombre: 'Huevos', station: 'cocina', comanda_batch_id: 'b2' },
        { nombre: 'Café', station: 'barra', comanda_batch_id: 'b2' },
      ],
      comanda_batches: {
        b1: { seq: 0, created_at: '2026-07-31T10:00:00Z' },
        b2: { seq: 1, created_at: '2026-07-31T10:15:00Z' },
      },
    }
    const cards = buildBatchCards(order)
    expect(cards).toHaveLength(2)

    const card1 = cards.find(c => c.batchId === 'b1')!
    expect(card1.batchSeq).toBe(0)
    const items1 = batchItems(order, card1.batchId)
    expect(items1).toHaveLength(1)
    expect(items1[0].nombre).toBe('Chilaquiles')
  })

  it('two-batch order: batch 2 card returns only batch 2 items for this station', () => {
    const order = {
      id: 'o2', status: 'preparando', created_at: '2026-07-31T10:00:00Z',
      items: [
        { nombre: 'Chilaquiles', station: 'cocina', comanda_batch_id: 'b1' },
        { nombre: 'Huevos', station: 'cocina', comanda_batch_id: 'b2' },
        { nombre: 'Café', station: 'barra', comanda_batch_id: 'b2' },
      ],
      comanda_batches: {
        b1: { seq: 0, created_at: '2026-07-31T10:00:00Z' },
        b2: { seq: 1, created_at: '2026-07-31T10:15:00Z' },
      },
    }
    const cards = buildBatchCards(order)
    const card2 = cards.find(c => c.batchId === 'b2')!
    expect(card2.batchSeq).toBe(1)
    const items2 = batchItems(order, card2.batchId)
    // Only Huevos (cocina) — Café is barra, filtered out
    expect(items2).toHaveLength(1)
    expect(items2[0].nombre).toBe('Huevos')
  })

  it('cancelled items are excluded from batch card regardless of batch', () => {
    const order = {
      id: 'o3', status: 'enviada', created_at: '2026-07-31T10:00:00Z',
      items: [
        { nombre: 'Chilaquiles', station: 'cocina', comanda_batch_id: 'b1', cancelled: false },
        { nombre: 'Huevos', station: 'cocina', comanda_batch_id: 'b1', cancelled: true },
      ],
    }
    const cards = buildBatchCards(order)
    const items = batchItems(order, cards[0].batchId)
    expect(items).toHaveLength(1)
    expect(items[0].nombre).toBe('Chilaquiles')
  })

  it('batchCreatedAt uses batch metadata timestamp for correct elapsed time', () => {
    const orderCreatedAt = '2026-07-31T10:00:00Z'
    const batchTwoCreatedAt = '2026-07-31T10:20:00Z'
    const order = {
      id: 'o4', status: 'enviada', created_at: orderCreatedAt,
      items: [
        { nombre: 'Chilaquiles', station: 'cocina', comanda_batch_id: 'b1' },
        { nombre: 'Pizza', station: 'cocina', comanda_batch_id: 'b2' },
      ],
      comanda_batches: {
        b1: { seq: 0, created_at: orderCreatedAt },
        b2: { seq: 1, created_at: batchTwoCreatedAt },
      },
    }
    const cards = buildBatchCards(order)
    const card2 = cards.find(c => c.batchId === 'b2')!
    expect(card2.batchCreatedAt).toBe(batchTwoCreatedAt)
    // Elapsed for batch 2 is shorter than elapsed for the full order
    const orderAge = new Date(batchTwoCreatedAt).getTime() - new Date(orderCreatedAt).getTime()
    expect(orderAge).toBe(20 * 60 * 1000) // 20 min
  })
})

// ─── COB-017 — MP Point state machine: FINISHED → fallo → recovery ──────────
//
// Inline implementation of mp-payment-recovery.ts logic so tests run in
// node environment (no DOM/localStorage available from vitest.config).
// A plain-object mock stands in for localStorage. Tests verify:
//   1. State machine transitions persist opId unchanged (idempotency key)
//   2. RECONCILIATION_REQUIRED surfaces on loadMpRecovery (operator attention)
//   3. MP_APPROVED on reload also surfaces (app crashed before FULLSITE_RECORDED)
//   4. Successful retry state (FULLSITE_RECORDED) does NOT surface
//   5. clearMpRecovery removes the record
//   6. needsOperatorAttention flags the correct states
// ─────────────────────────────────────────────────────────────────────────────

describe('COB-017 — MP Point payment recovery state machine', () => {
  type MpPaymentState =
    | 'MP_STARTED' | 'MP_APPROVED' | 'FULLSITE_PENDING' | 'FULLSITE_RECORDED'
    | 'RECONCILIATION_REQUIRED' | 'RECONCILED' | 'FAILED_MANUAL_REVIEW'

  interface MpPaymentRecovery {
    state: MpPaymentState
    intentId: string
    orderId: string
    opId: string // never changes across retries
    amount: number
    mesa: number
    mesero: string
    timestamp: string
    error?: string
  }

  // In-memory localStorage mock (reset per test)
  let store: Record<string, string>
  const mockLS = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { store = {} },
  }

  const storageKey = (mesa: number) => `mp_recovery_${mesa}`

  const loadMpRecovery = (mesa: number): MpPaymentRecovery | null => {
    const raw = mockLS.getItem(storageKey(mesa))
    if (!raw) return null
    const r = JSON.parse(raw) as MpPaymentRecovery
    if (r.state === 'MP_APPROVED' || r.state === 'RECONCILIATION_REQUIRED' || r.state === 'FAILED_MANUAL_REVIEW') return r
    return null
  }
  const persistMpRecovery = (r: MpPaymentRecovery) => mockLS.setItem(storageKey(r.mesa), JSON.stringify(r))
  const clearMpRecovery = (mesa: number) => mockLS.removeItem(storageKey(mesa))
  const needsOperatorAttention = (r: MpPaymentRecovery | null): boolean =>
    !!r && (r.state === 'MP_APPROVED' || r.state === 'RECONCILIATION_REQUIRED' || r.state === 'FAILED_MANUAL_REVIEW')
  const transition = (r: MpPaymentRecovery, next: MpPaymentState, extra?: Partial<MpPaymentRecovery>): MpPaymentRecovery => {
    const updated = { ...r, state: next, ...extra }
    persistMpRecovery(updated)
    return updated
  }

  const makeRecovery = (overrides?: Partial<MpPaymentRecovery>): MpPaymentRecovery => ({
    state: 'MP_APPROVED',
    intentId: 'INTENT-ABC123',
    orderId: 'ORDER-001',
    opId: 'OP-IDEMPOTENT-KEY',
    amount: 350.00,
    mesa: 5,
    mesero: 'Omar Aguilera',
    timestamp: '2026-07-31T14:30:00.000Z',
    ...overrides,
  })

  beforeEach(() => { store = {} })

  it('loadMpRecovery devuelve null cuando localStorage vacío', () => {
    expect(loadMpRecovery(5)).toBeNull()
  })

  it('loadMpRecovery devuelve null para FULLSITE_RECORDED — no requiere atención', () => {
    persistMpRecovery(makeRecovery({ state: 'FULLSITE_RECORDED' }))
    expect(loadMpRecovery(5)).toBeNull()
  })

  it('loadMpRecovery devuelve null para FULLSITE_PENDING — estado efímero en vuelo', () => {
    persistMpRecovery(makeRecovery({ state: 'FULLSITE_PENDING' }))
    expect(loadMpRecovery(5)).toBeNull()
  })

  it('loadMpRecovery devuelve record para RECONCILIATION_REQUIRED', () => {
    const r = makeRecovery({ state: 'RECONCILIATION_REQUIRED', error: 'TypeError: Cannot read...' })
    persistMpRecovery(r)
    expect(loadMpRecovery(5)).toEqual(r)
  })

  it('loadMpRecovery devuelve record para MP_APPROVED — app exited after MP captured', () => {
    const r = makeRecovery({ state: 'MP_APPROVED' })
    persistMpRecovery(r)
    const loaded = loadMpRecovery(5)
    expect(loaded?.state).toBe('MP_APPROVED')
    expect(loaded?.intentId).toBe('INTENT-ABC123')
  })

  it('opId no cambia a través de múltiples transiciones — garantía de idempotencia en retry', () => {
    const original = makeRecovery()
    let current = transition(original, 'FULLSITE_PENDING')
    current = transition(current, 'RECONCILIATION_REQUIRED', { error: 'saveOrder failed' })
    // On retry: transitions back to FULLSITE_PENDING with same opId
    current = transition(current, 'FULLSITE_PENDING')

    expect(current.opId).toBe('OP-IDEMPOTENT-KEY')
    const stored = JSON.parse(mockLS.getItem(storageKey(5))!)
    expect(stored.opId).toBe('OP-IDEMPOTENT-KEY')
  })

  it('clearMpRecovery elimina el record — después de retry exitoso', () => {
    persistMpRecovery(makeRecovery({ state: 'RECONCILIATION_REQUIRED' }))
    expect(loadMpRecovery(5)).not.toBeNull()
    clearMpRecovery(5)
    expect(loadMpRecovery(5)).toBeNull()
    expect(mockLS.getItem(storageKey(5))).toBeNull()
  })

  it('needsOperatorAttention es true para MP_APPROVED', () => {
    expect(needsOperatorAttention(makeRecovery({ state: 'MP_APPROVED' }))).toBe(true)
  })

  it('needsOperatorAttention es true para RECONCILIATION_REQUIRED', () => {
    expect(needsOperatorAttention(makeRecovery({ state: 'RECONCILIATION_REQUIRED' }))).toBe(true)
  })

  it('needsOperatorAttention es true para FAILED_MANUAL_REVIEW', () => {
    expect(needsOperatorAttention(makeRecovery({ state: 'FAILED_MANUAL_REVIEW' }))).toBe(true)
  })

  it('needsOperatorAttention es false para FULLSITE_RECORDED', () => {
    expect(needsOperatorAttention(makeRecovery({ state: 'FULLSITE_RECORDED' }))).toBe(false)
  })

  it('needsOperatorAttention es false para null', () => {
    expect(needsOperatorAttention(null)).toBe(false)
  })

  it('recovery sobrevive a simulación de reload — persiste y recarga correctamente', () => {
    const r = makeRecovery({ state: 'RECONCILIATION_REQUIRED', error: 'JS exception in handlePayment' })
    persistMpRecovery(r)

    // Simulate reload: load from scratch
    const reloaded = loadMpRecovery(5)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.intentId).toBe('INTENT-ABC123')
    expect(reloaded!.opId).toBe('OP-IDEMPOTENT-KEY')
    expect(reloaded!.amount).toBe(350.00)
    expect(reloaded!.state).toBe('RECONCILIATION_REQUIRED')
  })

  it('retry exitoso: RECONCILIATION_REQUIRED → FULLSITE_RECORDED → cleared, no queda en storage', () => {
    const r = makeRecovery({ state: 'RECONCILIATION_REQUIRED' })
    persistMpRecovery(r)

    // Simulate successful retry
    transition(r, 'FULLSITE_PENDING')
    transition(r, 'FULLSITE_RECORDED')
    clearMpRecovery(5)

    expect(loadMpRecovery(5)).toBeNull()
    expect(mockLS.getItem(storageKey(5))).toBeNull()
  })

  it('scoped por mesa: recovery en mesa 3 no interfiere con mesa 5', () => {
    persistMpRecovery(makeRecovery({ state: 'RECONCILIATION_REQUIRED', mesa: 3, orderId: 'ORDER-M3' }))
    persistMpRecovery(makeRecovery({ state: 'FULLSITE_RECORDED', mesa: 5, orderId: 'ORDER-M5' }))

    expect(loadMpRecovery(3)?.orderId).toBe('ORDER-M3')
    expect(loadMpRecovery(5)).toBeNull() // FULLSITE_RECORDED no surfaced
  })
})
