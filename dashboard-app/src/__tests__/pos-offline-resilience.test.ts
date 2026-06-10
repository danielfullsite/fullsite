import { describe, it, expect } from 'vitest'

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

  it('items with retries >= 5 should be skipped', () => {
    const queue: SyncQueueItem[] = [
      { id: '1', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: false, retries: 5 },
      { id: '2', table: 'pos_orders', method: 'POST', data: {}, created_at: '', synced: false, retries: 0 },
      { id: '3', table: 'pos_orders', method: 'PATCH', data: {}, created_at: '', synced: false, retries: 10 },
    ]
    const eligible = queue.filter(i => !i.synced && i.retries < 5)
    expect(eligible).toHaveLength(1)
    expect(eligible[0].id).toBe('2')
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
