import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── localStorage mock ────────────────────────────────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => localStorageMock.clear())

// ─── Import after mocking ─────────────────────────────────────────────────

import {
  formatMXN,
  generateId,
  IVA_RATE,
  MESAS_CONFIG,
  MENU_CATEGORIES,
  MESEROS,
  MODIFIERS_QUITAR,
  MODIFIERS_AGREGAR_FOOD,
  MODIFIERS_AGREGAR_COFFEE,
  MODIFIERS_AGREGAR_DRINKS,
  MODIFIERS_AGREGAR_NONE,
  getModifiersForCategory,
  REGIMENES_FISCALES,
  USOS_CFDI,
  RECIPE_ALIASES,
} from '@/lib/pos-data'

// ─── formatMXN ────────────────────────────────────────────────────────────

describe('formatMXN', () => {
  it('formats integer amount', () => {
    expect(formatMXN(292)).toBe('$292.00')
  })

  it('formats with centavos', () => {
    expect(formatMXN(742.40)).toBe('$742.40')
  })

  it('formats zero', () => {
    expect(formatMXN(0)).toBe('$0.00')
  })

  it('formats large amount', () => {
    expect(formatMXN(12345.67)).toBe('$12345.67')
  })

  it('formats negative amount', () => {
    // formatMXN uses template literal `$${amount.toFixed(2)}`, so negative sign is after $
    expect(formatMXN(-100)).toBe('$-100.00')
  })

  it('rounds to two decimal places', () => {
    expect(formatMXN(100.999)).toBe('$101.00')
    expect(formatMXN(100.004)).toBe('$100.00')
  })

  it('formats very small amount', () => {
    expect(formatMXN(0.01)).toBe('$0.01')
  })

  it('formats one peso', () => {
    expect(formatMXN(1)).toBe('$1.00')
  })
})

// ─── generateId ───────────────────────────────────────────────────────────

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string')
  })

  it('returns non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0)
  })

  it('returns alphanumeric characters', () => {
    const id = generateId()
    expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('has consistent length (9 chars)', () => {
    // substring(2, 11) = 9 characters
    const id = generateId()
    expect(id.length).toBe(9)
  })
})

// ─── IVA_RATE ─────────────────────────────────────────────────────────────

describe('IVA_RATE', () => {
  it('is 0.16 (16%)', () => {
    expect(IVA_RATE).toBe(0.16)
  })

  it('calculates correct IVA for $1000', () => {
    expect(1000 * IVA_RATE).toBe(160)
  })

  it('calculates correct total with IVA', () => {
    expect(1000 * (1 + IVA_RATE)).toBe(1160)
  })
})

// ─── MESAS_CONFIG ─────────────────────────────────────────────────────────

describe('MESAS_CONFIG', () => {
  it('has 33 mesas (layout real AMALAY)', () => {
    expect(MESAS_CONFIG).toHaveLength(33)
  })

  it('mesas match the real floor plan numbers', () => {
    const numbers = MESAS_CONFIG.map(m => m.number)
    expect(numbers).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      20, 21, 30, 31, 32, 40, 41, 42, 43, 44, 45,
      50, 51, 52, 53, 54, 55, 60, 61, 62, 63,
    ])
  })

  it('all mesas start as disponible', () => {
    for (const mesa of MESAS_CONFIG) {
      expect(mesa.status).toBe('disponible')
    }
  })

  it('mesa 30 (redonda grande terraza) has capacity 8', () => {
    expect(MESAS_CONFIG.find(m => m.number === 30)?.capacity).toBe(8)
  })

  it('rectangulares grandes terraza (40,41,42) have capacity 6', () => {
    for (const n of [40, 41, 42]) {
      expect(MESAS_CONFIG.find(m => m.number === n)?.capacity).toBe(6)
    }
  })

  it('remaining mesas default to capacity 4 (sillas del plano)', () => {
    const special = new Set([30, 40, 41, 42])
    for (const mesa of MESAS_CONFIG) {
      if (!special.has(mesa.number)) expect(mesa.capacity).toBe(4)
    }
  })

  it('total restaurant capacity is correct', () => {
    const total = MESAS_CONFIG.reduce((s, m) => s + m.capacity, 0)
    // 8 (mesa 30) + 3*6 (rect grandes terraza) + 29*4 = 8+18+116 = 142
    expect(total).toBe(142)
  })
})

// ─── MENU_CATEGORIES ──────────────────────────────────────────────────────

describe('MENU_CATEGORIES', () => {
  it('has multiple categories', () => {
    expect(MENU_CATEGORIES.length).toBeGreaterThan(10)
  })

  it('each category has id, name, and items', () => {
    for (const cat of MENU_CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(Array.isArray(cat.items)).toBe(true)
    }
  })

  it('all items have id, name, and price', () => {
    for (const cat of MENU_CATEGORIES) {
      for (const item of cat.items) {
        expect(item.id).toBeTruthy()
        expect(item.name).toBeTruthy()
        expect(typeof item.price).toBe('number')
      }
    }
  })

  it('contains chilaquiles category', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'chilaquiles')
    expect(cat).toBeDefined()
    expect(cat!.items.length).toBeGreaterThanOrEqual(3)
  })

  it('contains coffee category', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'coffee')
    expect(cat).toBeDefined()
  })

  it('Chilaquiles Verdes is priced at $292', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'chilaquiles')
    const item = cat?.items.find(i => i.name === 'Chilaquiles Verdes')
    expect(item).toBeDefined()
    expect(item!.price).toBe(292)
  })

  it('Cafe Americano is priced at $48', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'coffee')
    const item = cat?.items.find(i => i.name === 'Cafe Americano')
    expect(item).toBeDefined()
    expect(item!.price).toBe(48)
  })

  it('has unique item IDs across all categories', () => {
    const allIds = MENU_CATEGORIES.flatMap(c => c.items.map(i => i.id))
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(allIds.length)
  })

  it('no promos/combo category in menu (removed per Eduardo)', () => {
    const promos = MENU_CATEGORIES.find(c => c.id === 'promos')
    expect(promos).toBeUndefined()
  })

  it('market categories have $0 prices', () => {
    const mktCats = MENU_CATEGORIES.filter(c => c.id.startsWith('mkt-'))
    expect(mktCats.length).toBeGreaterThan(0)
    for (const cat of mktCats) {
      for (const item of cat.items) {
        expect(item.price).toBe(0)
      }
    }
  })
})

// ─── MESEROS ──────────────────────────────────────────────────────────────

describe('MESEROS', () => {
  it('has at least 8 meseros', () => {
    expect(MESEROS.length).toBeGreaterThanOrEqual(8)
  })

  it('contains Omar Aguilera', () => {
    expect(MESEROS).toContain('Omar Aguilera')
  })

  it('contains Brayan Berlanga Solis', () => {
    expect(MESEROS).toContain('Brayan Berlanga Solis')
  })

  it('all entries are non-empty strings', () => {
    for (const m of MESEROS) {
      expect(typeof m).toBe('string')
      expect(m.length).toBeGreaterThan(0)
    }
  })
})

// ─── MODIFIERS ────────────────────────────────────────────────────────────

describe('MODIFIERS', () => {
  describe('MODIFIERS_QUITAR', () => {
    it('has common food removals', () => {
      expect(MODIFIERS_QUITAR).toContain('Sin cebolla')
      expect(MODIFIERS_QUITAR).toContain('Sin chile')
      expect(MODIFIERS_QUITAR).toContain('Sin queso')
    })

    it('has at least 5 options', () => {
      expect(MODIFIERS_QUITAR.length).toBeGreaterThanOrEqual(5)
    })

    it('all start with "Sin "', () => {
      for (const mod of MODIFIERS_QUITAR) {
        expect(mod).toMatch(/^Sin /)
      }
    })
  })

  describe('MODIFIERS_AGREGAR_FOOD', () => {
    it('has Extra queso at $25', () => {
      const mod = MODIFIERS_AGREGAR_FOOD.find(m => m.name === 'Extra queso')
      expect(mod).toBeDefined()
      expect(mod!.price).toBe(25)
    })

    it('has Extra aguacate at $35', () => {
      const mod = MODIFIERS_AGREGAR_FOOD.find(m => m.name === 'Extra aguacate')
      expect(mod).toBeDefined()
      expect(mod!.price).toBe(35)
    })

    it('has Extra proteina at $45', () => {
      const mod = MODIFIERS_AGREGAR_FOOD.find(m => m.name === 'Extra proteina')
      expect(mod).toBeDefined()
      expect(mod!.price).toBe(45)
    })

    it('all have name and price', () => {
      for (const mod of MODIFIERS_AGREGAR_FOOD) {
        expect(mod.name).toBeTruthy()
        expect(typeof mod.price).toBe('number')
        expect(mod.price).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('MODIFIERS_AGREGAR_COFFEE', () => {
    it('has Shot extra at $20', () => {
      const mod = MODIFIERS_AGREGAR_COFFEE.find(m => m.name === 'Shot extra')
      expect(mod).toBeDefined()
      expect(mod!.price).toBe(20)
    })

    it('has alternative milks', () => {
      const almendra = MODIFIERS_AGREGAR_COFFEE.find(m => m.name === 'Leche de almendra')
      const avena = MODIFIERS_AGREGAR_COFFEE.find(m => m.name === 'Leche de avena')
      expect(almendra).toBeDefined()
      expect(avena).toBeDefined()
    })
  })

  describe('MODIFIERS_AGREGAR_DRINKS', () => {
    it('has Proteina whey at $25', () => {
      const mod = MODIFIERS_AGREGAR_DRINKS.find(m => m.name === 'Proteina whey')
      expect(mod).toBeDefined()
      expect(mod!.price).toBe(25)
    })
  })

  describe('MODIFIERS_AGREGAR_NONE', () => {
    it('is empty array', () => {
      expect(MODIFIERS_AGREGAR_NONE).toEqual([])
    })
  })
})

// ─── getModifiersForCategory ──────────────────────────────────────────────

describe('getModifiersForCategory', () => {
  it('returns coffee modifiers for coffee category', () => {
    const result = getModifiersForCategory('coffee')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_COFFEE)
  })

  it('returns coffee modifiers for tea category', () => {
    const result = getModifiersForCategory('tea')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_COFFEE)
  })

  it('returns drink modifiers for smoothies', () => {
    const result = getModifiersForCategory('smoothies')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })

  it('returns drink modifiers for frappes', () => {
    const result = getModifiersForCategory('frappes')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })

  it('returns no modifiers for sodas', () => {
    const result = getModifiersForCategory('sodas')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual([])
  })

  it('returns food modifiers for chilaquiles', () => {
    const result = getModifiersForCategory('chilaquiles')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })

  it('returns food modifiers for eggs', () => {
    const result = getModifiersForCategory('eggs')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })

  it('returns food modifiers for unknown category', () => {
    const result = getModifiersForCategory('unknown_category')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })

  it('returns drink modifiers for alcohol', () => {
    const result = getModifiersForCategory('alcohol')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })
})

// ─── CFDI data ────────────────────────────────────────────────────────────

describe('CFDI data', () => {
  it('has at least 10 regimenes fiscales', () => {
    expect(REGIMENES_FISCALES.length).toBeGreaterThanOrEqual(10)
  })

  it('all regimenes have 3-digit clave', () => {
    for (const r of REGIMENES_FISCALES) {
      expect(r.clave).toMatch(/^\d{3}$/)
    }
  })

  it('has RESICO (626)', () => {
    expect(REGIMENES_FISCALES.find(r => r.clave === '626')).toBeDefined()
  })

  it('has at least 5 usos CFDI', () => {
    expect(USOS_CFDI.length).toBeGreaterThanOrEqual(5)
  })

  it('has G03 (Gastos en general)', () => {
    const g03 = USOS_CFDI.find(u => u.clave === 'G03')
    expect(g03).toBeDefined()
    expect(g03!.nombre).toContain('Gastos')
  })
})

// ─── RECIPE_ALIASES ───────────────────────────────────────────────────────

describe('RECIPE_ALIASES', () => {
  it('has aliases for chilaquiles', () => {
    expect(RECIPE_ALIASES['chilaquiles verdes']).toBeDefined()
    expect(RECIPE_ALIASES['chilaquiles rojos']).toBeDefined()
  })

  it('has aliases for coffee items', () => {
    expect(RECIPE_ALIASES['cafe americano']).toBeDefined()
    expect(RECIPE_ALIASES['capuchino caliente']).toBeDefined()
  })

  it('all alias values are arrays', () => {
    for (const [, aliases] of Object.entries(RECIPE_ALIASES)) {
      expect(Array.isArray(aliases)).toBe(true)
      expect(aliases.length).toBeGreaterThan(0)
    }
  })

  it('all alias keys are lowercase', () => {
    for (const key of Object.keys(RECIPE_ALIASES)) {
      expect(key).toBe(key.toLowerCase())
    }
  })
})
