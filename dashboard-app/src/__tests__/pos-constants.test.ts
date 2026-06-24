import { describe, it, expect } from 'vitest'
import {
  IVA_RATE,
  KITCHEN_ARCHIVE_HOURS,
  POLL_INTERVAL_KITCHEN,
  POLL_INTERVAL_KDS,
  BEBIDA_KEYWORDS,
  BARRA_CATEGORIES,
  isBebida,
  STATION_CATEGORIES,
  CATEGORY_TO_STATION,
  getStationForItem,
  getStationByName,
  STATION_LABELS,
  PAYMENT_METHODS,
} from '@/lib/pos-constants'

// ─── Constants ────────────────────────────────────────────────────────────

describe('POS Constants', () => {
  it('IVA_RATE is 0.16', () => {
    expect(IVA_RATE).toBe(0.16)
  })

  it('KITCHEN_ARCHIVE_HOURS is 4', () => {
    expect(KITCHEN_ARCHIVE_HOURS).toBe(4)
  })

  it('POLL_INTERVAL_KITCHEN is 2000ms', () => {
    expect(POLL_INTERVAL_KITCHEN).toBe(2000)
  })

  it('POLL_INTERVAL_KDS is 1500ms', () => {
    expect(POLL_INTERVAL_KDS).toBe(1500)
  })
})

// ─── isBebida ─────────────────────────────────────────────────────────────

describe('isBebida', () => {
  it('detects cafe', () => {
    expect(isBebida('Cafe Americano')).toBe(true)
  })

  it('detects cappuccino', () => {
    expect(isBebida('Capuchino Caliente')).toBe(true)
  })

  it('detects latte', () => {
    expect(isBebida('Matcha Latte Frio')).toBe(true)
  })

  it('detects smoothie', () => {
    expect(isBebida('Smoothie Pink Flamingo')).toBe(true)
  })

  it('detects frappe', () => {
    expect(isBebida('Frappe Matcha')).toBe(true)
  })

  it('detects jugo', () => {
    expect(isBebida('Jugo de Naranja Natural')).toBe(true)
  })

  it('detects limonada', () => {
    expect(isBebida('Limonada de Frutos Rojos')).toBe(true)
  })

  it('detects soda', () => {
    expect(isBebida('Coca Cola Regular')).toBe(true)
  })

  it('detects agua', () => {
    expect(isBebida('Agua Amalay 500ml')).toBe(true)
  })

  it('detects cerveza', () => {
    expect(isBebida('Cerveza Artesanal')).toBe(true)
  })

  it('detects vino', () => {
    expect(isBebida('Vino Copa Tinto')).toBe(true)
  })

  it('detects mimosa', () => {
    expect(isBebida('Mimosa Clasica')).toBe(true)
  })

  it('does NOT detect chilaquiles', () => {
    expect(isBebida('Chilaquiles Verdes')).toBe(false)
  })

  it('does NOT detect panini', () => {
    expect(isBebida('Chicken Panini')).toBe(false)
  })

  it('does NOT detect pizza', () => {
    expect(isBebida('Pizza Pepperoni')).toBe(false)
  })

  it('does NOT detect toast', () => {
    expect(isBebida('Avocado Toast')).toBe(false)
  })

  it('does NOT detect pancakes', () => {
    expect(isBebida('Classic Pancakes')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isBebida('CAFE AMERICANO')).toBe(true)
    expect(isBebida('cafe americano')).toBe(true)
  })

  it('detects chamoyada', () => {
    expect(isBebida('Chamoyada de Mango')).toBe(true)
  })
})

// ─── BEBIDA_KEYWORDS ──────────────────────────────────────────────────────

describe('BEBIDA_KEYWORDS', () => {
  it('includes all expected keywords', () => {
    const expected = ['cafe', 'latte', 'americano', 'smoothie', 'frappe', 'jugo', 'limonada', 'soda', 'cerveza', 'vino']
    for (const kw of expected) {
      expect(BEBIDA_KEYWORDS).toContain(kw)
    }
  })

  it('has at least 15 keywords', () => {
    expect(BEBIDA_KEYWORDS.length).toBeGreaterThanOrEqual(15)
  })
})

// ─── BARRA_CATEGORIES ─────────────────────────────────────────────────────

describe('BARRA_CATEGORIES', () => {
  it('includes coffee, jugos, smoothies, frappes', () => {
    expect(BARRA_CATEGORIES).toContain('coffee')
    expect(BARRA_CATEGORIES).toContain('jugos')
    expect(BARRA_CATEGORIES).toContain('smoothies')
    expect(BARRA_CATEGORIES).toContain('frappes')
  })

  it('includes sodas and tea', () => {
    expect(BARRA_CATEGORIES).toContain('sodas')
    expect(BARRA_CATEGORIES).toContain('tea')
  })

  it('includes alcohol', () => {
    expect(BARRA_CATEGORIES).toContain('alcohol')
  })

  it('does NOT include food categories', () => {
    expect(BARRA_CATEGORIES).not.toContain('chilaquiles')
    expect(BARRA_CATEGORIES).not.toContain('eggs')
    expect(BARRA_CATEGORIES).not.toContain('pancakes')
  })
})

// ─── STATION_CATEGORIES ───────────────────────────────────────────────────

describe('STATION_CATEGORIES', () => {
  it('has three stations: cocina, barra, caja', () => {
    expect(Object.keys(STATION_CATEGORIES)).toEqual(expect.arrayContaining(['cocina', 'barra', 'caja']))
  })

  it('cocina includes food categories', () => {
    expect(STATION_CATEGORIES.cocina).toContain('chilaquiles')
    expect(STATION_CATEGORIES.cocina).toContain('eggs')
    expect(STATION_CATEGORIES.cocina).toContain('pancakes')
    expect(STATION_CATEGORIES.cocina).toContain('paninis')
    expect(STATION_CATEGORIES.cocina).toContain('pizzas')
    expect(STATION_CATEGORIES.cocina).toContain('ceviche')
  })

  it('barra includes drink categories', () => {
    expect(STATION_CATEGORIES.barra).toContain('coffee')
    expect(STATION_CATEGORIES.barra).toContain('jugos')
    expect(STATION_CATEGORIES.barra).toContain('smoothies')
    expect(STATION_CATEGORIES.barra).toContain('frappes')
  })

  it('caja includes toast, bakery, postres', () => {
    expect(STATION_CATEGORIES.caja).toContain('toast')
    expect(STATION_CATEGORIES.caja).toContain('bakery')
    expect(STATION_CATEGORIES.caja).toContain('postres')
  })

  it('chilaquiles go to cocina', () => {
    expect(STATION_CATEGORIES.cocina).toContain('chilaquiles')
  })
})

// ─── CATEGORY_TO_STATION ──────────────────────────────────────────────────

describe('CATEGORY_TO_STATION', () => {
  it('maps chilaquiles to cocina', () => {
    expect(CATEGORY_TO_STATION['chilaquiles']).toBe('cocina')
  })

  it('maps coffee to barra', () => {
    expect(CATEGORY_TO_STATION['coffee']).toBe('barra')
  })

  it('maps toast to caja', () => {
    expect(CATEGORY_TO_STATION['toast']).toBe('caja')
  })

  it('maps eggs to cocina', () => {
    expect(CATEGORY_TO_STATION['eggs']).toBe('cocina')
  })

  it('maps jugos to barra', () => {
    expect(CATEGORY_TO_STATION['jugos']).toBe('barra')
  })

  it('maps bakery to caja', () => {
    expect(CATEGORY_TO_STATION['bakery']).toBe('caja')
  })

  it('maps postres to caja', () => {
    expect(CATEGORY_TO_STATION['postres']).toBe('caja')
  })

  it('maps alcohol to barra', () => {
    expect(CATEGORY_TO_STATION['alcohol']).toBe('barra')
  })
})

// ─── getStationForItem ────────────────────────────────────────────────────

describe('getStationForItem', () => {
  it('routes chilaquiles category to cocina', () => {
    expect(getStationForItem('chilaquiles', 'Chilaquiles Verdes')).toBe('cocina')
  })

  it('routes coffee category to barra', () => {
    expect(getStationForItem('coffee', 'Cafe Americano')).toBe('barra')
  })

  it('routes toast category to caja', () => {
    expect(getStationForItem('toast', 'Avocado Toast')).toBe('caja')
  })

  it('falls back to barra for unknown category with beverage name', () => {
    expect(getStationForItem('unknown', 'Cafe Latte Especial')).toBe('barra')
  })

  it('falls back to cocina for unknown category with food name', () => {
    expect(getStationForItem('unknown', 'Plato Especial')).toBe('cocina')
  })

  it('category takes priority over name detection', () => {
    // Even if name sounds like a drink, category wins
    expect(getStationForItem('chilaquiles', 'Cafe con Chilaquiles')).toBe('cocina')
  })
})

// ─── getStationByName ─────────────────────────────────────────────────────

describe('getStationByName', () => {
  it('routes cafe to barra', () => {
    expect(getStationByName('Cafe Americano')).toBe('barra')
  })

  it('routes latte to barra', () => {
    expect(getStationByName('Matcha Latte Frio')).toBe('barra')
  })

  it('routes smoothie to barra', () => {
    expect(getStationByName('Smoothie Pink Flamingo')).toBe('barra')
  })

  it('routes jugo to barra', () => {
    expect(getStationByName('Jugo de Naranja Natural')).toBe('barra')
  })

  it('routes toast to caja', () => {
    expect(getStationByName('Avocado Toast')).toBe('caja')
  })

  it('routes bagel to caja', () => {
    expect(getStationByName('Salmon Bagel')).toBe('caja')
  })

  it('routes cheesecake to caja', () => {
    expect(getStationByName('New York Cheesecake')).toBe('caja')
  })

  it('routes concha to caja', () => {
    expect(getStationByName('Concha de Mantequilla')).toBe('caja')
  })

  it('routes chilaquiles to cocina (default)', () => {
    expect(getStationByName('Chilaquiles Verdes')).toBe('cocina')
  })

  it('routes pancakes to cocina', () => {
    expect(getStationByName('Classic Pancakes')).toBe('cocina')
  })

  it('routes pizza to cocina', () => {
    expect(getStationByName('Pizza Pepperoni')).toBe('cocina')
  })

  it('routes unknown items to cocina by default', () => {
    expect(getStationByName('Plato Misterioso')).toBe('cocina')
  })

  it('is case-insensitive', () => {
    expect(getStationByName('CAFE AMERICANO')).toBe('barra')
    expect(getStationByName('avocado toast')).toBe('caja')
  })

  it('routes cerveza to barra', () => {
    expect(getStationByName('Cerveza Artesanal')).toBe('barra')
  })

  it('routes carrot cake to caja', () => {
    expect(getStationByName('Carrot Cake')).toBe('caja')
  })

  it('routes tiramisu to caja', () => {
    expect(getStationByName('Tiramisú')).toBe('caja')
  })
})

// ─── STATION_LABELS ───────────────────────────────────────────────────────

describe('STATION_LABELS', () => {
  it('cocina label is COCINA', () => {
    expect(STATION_LABELS.cocina).toBe('COCINA')
  })

  it('barra label is BARRA', () => {
    expect(STATION_LABELS.barra).toBe('BARRA')
  })

  it('caja label is MARKET', () => {
    expect(STATION_LABELS.caja).toBe('MARKET')
  })
})

// ─── PAYMENT_METHODS ──────────────────────────────────────────────────────

describe('PAYMENT_METHODS', () => {
  it('has 4 payment methods', () => {
    expect(PAYMENT_METHODS).toHaveLength(4)
  })

  it('includes efectivo', () => {
    const m = PAYMENT_METHODS.find(p => p.id === 'efectivo')
    expect(m).toBeDefined()
    expect(m!.label).toBe('Efectivo')
  })

  it('includes tarjeta', () => {
    const m = PAYMENT_METHODS.find(p => p.id === 'tarjeta')
    expect(m).toBeDefined()
    expect(m!.label).toBe('Tarjeta')
  })

  it('includes transferencia', () => {
    const m = PAYMENT_METHODS.find(p => p.id === 'transferencia')
    expect(m).toBeDefined()
  })

  it('includes mixto', () => {
    const m = PAYMENT_METHODS.find(p => p.id === 'mixto')
    expect(m).toBeDefined()
    expect(m!.label).toContain('Mixto')
  })

  it('all methods have id, label, icon, and color', () => {
    for (const m of PAYMENT_METHODS) {
      expect(m.id).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.icon).toBeTruthy()
      expect(m.color).toBeTruthy()
    }
  })
})
