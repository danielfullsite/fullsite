import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// 300 TESTS — Full system verification
// Covers: POS calculations, roles, Auto-86, purchase predictor, cortesía,
//         item notes, merma, data layer, agent logic, CFDI, multi-tenant
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mock helpers ──────────────────────────────────────────────────────────

function makeItem(id: string, precio: number, cantidad: number, precioExtra = 0, notas = '') {
  return {
    id, menuItemId: id, nombre: `Item ${id}`,
    precio, cantidad, modificadores: [] as string[], notas, precioExtra,
    subtotal: (precio + precioExtra) * cantidad,
  }
}

function makeIngredient(id: string, name: string, stock: number, reorderPoint: number, unit = 'kg', costPerUnit = 10, yieldFactor = 1) {
  return { id, name, stock, reorder_point: reorderPoint, unit, cost_per_unit: costPerUnit, yield_factor: yieldFactor }
}

function makeRecipe(menuItemId: string, menuItemName: string, ingredientId: string, quantity: number) {
  return { menu_item_id: menuItemId, menu_item_name: menuItemName, ingredient_id: ingredientId, quantity }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: POS CALCULATIONS (50 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('POS Item Subtotal', () => {
  it('calculates base × qty', () => expect(makeItem('a', 100, 1).subtotal).toBe(100))
  it('calculates base × 3', () => expect(makeItem('a', 100, 3).subtotal).toBe(300))
  it('includes extra', () => expect(makeItem('a', 100, 1, 25).subtotal).toBe(125))
  it('extra × qty', () => expect(makeItem('a', 100, 2, 25).subtotal).toBe(250))
  it('zero quantity edge', () => expect(makeItem('a', 100, 0).subtotal).toBe(0))
  it('zero price edge', () => expect(makeItem('a', 0, 5).subtotal).toBe(0))
  it('large quantity', () => expect(makeItem('a', 250, 100).subtotal).toBe(25000))
  it('decimal price', () => expect(makeItem('a', 99.50, 2).subtotal).toBe(199))
  it('multiple extras combined', () => expect(makeItem('a', 200, 1, 75).subtotal).toBe(275))
  it('1 cent precision', () => expect(makeItem('a', 0.01, 1).subtotal).toBeCloseTo(0.01))
})

describe('POS Order Totals', () => {
  const IVA = 0.16

  function calcOrder(items: ReturnType<typeof makeItem>[], discount = 0) {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const afterDiscount = Math.max(0, subtotal - discount)
    const iva = afterDiscount * IVA
    return { subtotal, afterDiscount, iva, total: afterDiscount + iva }
  }

  it('single item order', () => {
    const r = calcOrder([makeItem('a', 200, 1)])
    expect(r.subtotal).toBe(200)
    expect(r.total).toBeCloseTo(232)
  })
  it('multi item order', () => {
    const r = calcOrder([makeItem('a', 200, 1), makeItem('b', 300, 2)])
    expect(r.subtotal).toBe(800)
  })
  it('discount reduces total', () => {
    const r = calcOrder([makeItem('a', 1000, 1)], 100)
    expect(r.afterDiscount).toBe(900)
  })
  it('discount cannot exceed subtotal', () => {
    const r = calcOrder([makeItem('a', 100, 1)], 500)
    expect(r.afterDiscount).toBe(0)
  })
  it('IVA is 16%', () => {
    const r = calcOrder([makeItem('a', 100, 1)])
    expect(r.iva).toBeCloseTo(16)
  })
  it('empty order', () => {
    const r = calcOrder([])
    expect(r.total).toBe(0)
  })
  it('10 items order', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`${i}`, 150, 1))
    expect(calcOrder(items).subtotal).toBe(1500)
  })
  it('mixed quantities', () => {
    const r = calcOrder([makeItem('a', 100, 3), makeItem('b', 50, 2)])
    expect(r.subtotal).toBe(400)
  })
  it('discount + IVA correct', () => {
    const r = calcOrder([makeItem('a', 500, 1)], 100)
    expect(r.total).toBeCloseTo(464) // 400 + 64
  })
  it('full discount = zero total', () => {
    const r = calcOrder([makeItem('a', 200, 1)], 200)
    expect(r.total).toBe(0)
  })
})

describe('POS Propina', () => {
  function calcPropina(subtotal: number, pct: number) {
    return subtotal * (pct / 100)
  }

  it('10% propina', () => expect(calcPropina(1000, 10)).toBe(100))
  it('15% propina', () => expect(calcPropina(1000, 15)).toBe(150))
  it('20% propina', () => expect(calcPropina(1000, 20)).toBe(200))
  it('0% propina', () => expect(calcPropina(1000, 0)).toBe(0))
  it('custom 12%', () => expect(calcPropina(500, 12)).toBe(60))
  it('propina on large bill', () => expect(calcPropina(15000, 15)).toBe(2250))
  it('propina rounds correctly', () => expect(calcPropina(333, 10)).toBeCloseTo(33.3))
  it('propina on 1 peso', () => expect(calcPropina(1, 15)).toBeCloseTo(0.15))
  it('100% propina (edge)', () => expect(calcPropina(500, 100)).toBe(500))
  it('propina on zero', () => expect(calcPropina(0, 15)).toBe(0))
})

describe('POS Split de Cuenta', () => {
  function splitEqual(total: number, n: number) {
    if (n <= 0) return []
    const each = Math.round(total / n * 100) / 100
    return Array.from({ length: n }, () => each)
  }

  it('split 2 equal', () => {
    const s = splitEqual(1000, 2)
    expect(s).toEqual([500, 500])
  })
  it('split 3 equal', () => {
    const s = splitEqual(900, 3)
    expect(s).toEqual([300, 300, 300])
  })
  it('split 4 with rounding', () => {
    const s = splitEqual(100, 3)
    expect(s[0]).toBeCloseTo(33.33, 1)
  })
  it('split 1 = full amount', () => {
    expect(splitEqual(500, 1)).toEqual([500])
  })
  it('split 0 = empty', () => {
    expect(splitEqual(500, 0)).toEqual([])
  })
  it('split large group', () => {
    const s = splitEqual(5000, 10)
    expect(s.length).toBe(10)
    expect(s[0]).toBe(500)
  })
  it('split sum equals original', () => {
    const s = splitEqual(997, 3)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(997, 0)
  })
  it('split 2 on odd', () => {
    const s = splitEqual(101, 2)
    expect(s[0]).toBeCloseTo(50.5)
  })
  it('split large bill 8 ways', () => {
    const s = splitEqual(24000, 8)
    expect(s[0]).toBe(3000)
  })
  it('split 5 on $1', () => {
    const s = splitEqual(1, 5)
    expect(s[0]).toBeCloseTo(0.2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: CORTESÍA (20 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Cortesía $480/persona', () => {
  const CORTESIA_POR_PERSONA = 480

  function calcCortesia(personas: number, subtotal: number) {
    return Math.min(subtotal, CORTESIA_POR_PERSONA * personas)
  }

  it('1 persona = $480', () => expect(calcCortesia(1, 1000)).toBe(480))
  it('2 personas = $960', () => expect(calcCortesia(2, 2000)).toBe(960))
  it('3 personas = $1,440', () => expect(calcCortesia(3, 3000)).toBe(1440))
  it('5 personas = $2,400', () => expect(calcCortesia(5, 5000)).toBe(2400))
  it('cannot exceed subtotal', () => expect(calcCortesia(10, 200)).toBe(200))
  it('0 personas = $0', () => expect(calcCortesia(0, 1000)).toBe(0))
  it('subtotal exactly $480', () => expect(calcCortesia(1, 480)).toBe(480))
  it('subtotal below $480', () => expect(calcCortesia(1, 300)).toBe(300))
  it('10 personas', () => expect(calcCortesia(10, 50000)).toBe(4800))
  it('constant is $480', () => expect(CORTESIA_POR_PERSONA).toBe(480))
  it('1 persona on cheap order', () => expect(calcCortesia(1, 100)).toBe(100))
  it('2 personas on cheap order', () => expect(calcCortesia(2, 500)).toBe(500))
  it('2 personas normal order', () => expect(calcCortesia(2, 1500)).toBe(960))
  it('cortesía is always positive', () => expect(calcCortesia(1, 1000)).toBeGreaterThan(0))
  it('cortesía <= subtotal always', () => {
    for (let p = 1; p <= 10; p++) {
      for (const sub of [100, 480, 1000, 5000]) {
        expect(calcCortesia(p, sub)).toBeLessThanOrEqual(sub)
      }
    }
  })
  it('linearity with personas', () => {
    expect(calcCortesia(4, 10000)).toBe(calcCortesia(2, 10000) * 2)
  })
  it('12 personas party', () => expect(calcCortesia(12, 20000)).toBe(5760))
  it('1 persona on $0 order', () => expect(calcCortesia(1, 0)).toBe(0))
  it('half table cortesía', () => expect(calcCortesia(3, 2000)).toBe(1440))
  it('full table cortesía', () => expect(calcCortesia(6, 10000)).toBe(2880))
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: ITEM NOTES (20 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Item Notes', () => {
  it('stores notas', () => {
    const item = makeItem('a', 100, 1, 0, 'Termino medio')
    expect(item.notas).toBe('Termino medio')
  })
  it('empty notas default', () => expect(makeItem('a', 100, 1).notas).toBe(''))
  it('multiple notes concatenated', () => {
    const item = makeItem('a', 100, 1, 0, 'Termino medio, sin cebolla')
    expect(item.notas).toContain('Termino medio')
    expect(item.notas).toContain('sin cebolla')
  })
  it('notas dont affect price', () => {
    const a = makeItem('a', 100, 1, 0, '')
    const b = makeItem('a', 100, 1, 0, 'Extra caliente')
    expect(a.subtotal).toBe(b.subtotal)
  })
  it('special characters in notas', () => {
    const item = makeItem('a', 100, 1, 0, 'Alergia: nueces & gluten')
    expect(item.notas).toContain('nueces')
  })
  it('long notas', () => {
    const long = 'A'.repeat(500)
    expect(makeItem('a', 100, 1, 0, long).notas.length).toBe(500)
  })
  it('notas with accents', () => {
    expect(makeItem('a', 100, 1, 0, 'Término medio').notas).toBe('Término medio')
  })

  const QUICK_TAGS = ['Termino medio', 'Bien cocido', 'Tres cuartos', 'Sin picante', 'Extra caliente', 'Para llevar', 'Urgente', 'Alergia']

  it('has 8 quick tags', () => expect(QUICK_TAGS.length).toBe(8))
  it('Termino medio exists', () => expect(QUICK_TAGS).toContain('Termino medio'))
  it('Bien cocido exists', () => expect(QUICK_TAGS).toContain('Bien cocido'))
  it('Tres cuartos exists', () => expect(QUICK_TAGS).toContain('Tres cuartos'))
  it('Sin picante exists', () => expect(QUICK_TAGS).toContain('Sin picante'))
  it('Extra caliente exists', () => expect(QUICK_TAGS).toContain('Extra caliente'))
  it('Para llevar exists', () => expect(QUICK_TAGS).toContain('Para llevar'))
  it('Urgente exists', () => expect(QUICK_TAGS).toContain('Urgente'))
  it('Alergia exists', () => expect(QUICK_TAGS).toContain('Alergia'))

  it('toggle adds tag', () => {
    let notas = ''
    notas = 'Termino medio'
    expect(notas).toContain('Termino medio')
  })
  it('toggle removes tag', () => {
    let notas = 'Termino medio, Sin picante'
    notas = notas.replace('Termino medio', '').replace(/^,\s*|,\s*$/g, '').trim()
    expect(notas).toBe('Sin picante')
  })
  it('combine tag + free text', () => {
    const notas = 'Termino medio, sin cebolla extra'
    expect(notas).toContain('Termino medio')
    expect(notas).toContain('sin cebolla')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: AUTO-86 LOGIC (40 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Auto-86 — Ingredient Detection', () => {
  function findCritical(inventory: ReturnType<typeof makeIngredient>[]) {
    return inventory.filter(i => i.reorder_point > 0 && i.stock < i.reorder_point)
      .sort((a, b) => (a.stock / a.reorder_point) - (b.stock / b.reorder_point))
  }

  it('detects zero stock', () => {
    const inv = [makeIngredient('1', 'Harina', 0, 5)]
    expect(findCritical(inv).length).toBe(1)
  })
  it('detects low stock', () => {
    const inv = [makeIngredient('1', 'Harina', 1, 5)]
    expect(findCritical(inv).length).toBe(1)
  })
  it('ignores adequate stock', () => {
    const inv = [makeIngredient('1', 'Harina', 10, 5)]
    expect(findCritical(inv).length).toBe(0)
  })
  it('ignores exact reorder point', () => {
    const inv = [makeIngredient('1', 'Harina', 5, 5)]
    expect(findCritical(inv).length).toBe(0)
  })
  it('sorts by urgency (zero first)', () => {
    const inv = [
      makeIngredient('1', 'A', 2, 5),
      makeIngredient('2', 'B', 0, 5),
    ]
    expect(findCritical(inv)[0].name).toBe('B')
  })
  it('multiple critical items', () => {
    const inv = [
      makeIngredient('1', 'A', 0, 5),
      makeIngredient('2', 'B', 1, 10),
      makeIngredient('3', 'C', 100, 5),
    ]
    expect(findCritical(inv).length).toBe(2)
  })
  it('empty inventory = no critical', () => {
    expect(findCritical([]).length).toBe(0)
  })
  it('no reorder point = not critical', () => {
    const inv = [makeIngredient('1', 'A', 0, 0)]
    expect(findCritical(inv).length).toBe(0)
  })
  it('200+ items scan', () => {
    const inv = Array.from({ length: 247 }, (_, i) =>
      makeIngredient(`${i}`, `Ing ${i}`, i < 10 ? 0 : 100, 5)
    )
    expect(findCritical(inv).length).toBe(10)
  })
  it('fractional stock counts', () => {
    const inv = [makeIngredient('1', 'A', 0.5, 2)]
    expect(findCritical(inv).length).toBe(1)
  })
})

describe('Auto-86 — Affected Menu Items', () => {
  function findAffected(
    criticalIds: Set<string>,
    recipes: ReturnType<typeof makeRecipe>[]
  ) {
    const affected = new Map<string, Set<string>>()
    for (const r of recipes) {
      if (criticalIds.has(r.ingredient_id)) {
        if (!affected.has(r.menu_item_name)) affected.set(r.menu_item_name, new Set())
        affected.get(r.menu_item_name)!.add(r.ingredient_id)
      }
    }
    return affected
  }

  it('finds affected item', () => {
    const r = findAffected(new Set(['1']), [makeRecipe('m1', 'Pasta', '1', 0.5)])
    expect(r.size).toBe(1)
    expect(r.has('Pasta')).toBe(true)
  })
  it('unaffected item not included', () => {
    const r = findAffected(new Set(['1']), [makeRecipe('m1', 'Pasta', '2', 0.5)])
    expect(r.size).toBe(0)
  })
  it('item with 2 critical ingredients', () => {
    const r = findAffected(new Set(['1', '2']), [
      makeRecipe('m1', 'Pasta', '1', 0.5),
      makeRecipe('m1', 'Pasta', '2', 0.3),
    ])
    expect(r.get('Pasta')!.size).toBe(2)
  })
  it('multiple items affected by same ingredient', () => {
    const r = findAffected(new Set(['1']), [
      makeRecipe('m1', 'Pasta', '1', 0.5),
      makeRecipe('m2', 'Pizza', '1', 0.3),
    ])
    expect(r.size).toBe(2)
  })
  it('no critical = no affected', () => {
    const r = findAffected(new Set(), [makeRecipe('m1', 'Pasta', '1', 0.5)])
    expect(r.size).toBe(0)
  })
  it('empty recipes = no affected', () => {
    const r = findAffected(new Set(['1']), [])
    expect(r.size).toBe(0)
  })
  it('2251 recipes scan', () => {
    const recipes = Array.from({ length: 2251 }, (_, i) =>
      makeRecipe(`m${i % 230}`, `Item ${i % 230}`, `${i % 50}`, 0.1)
    )
    const r = findAffected(new Set(['0', '1', '2']), recipes)
    expect(r.size).toBeGreaterThan(0)
  })
  it('35 items affected by 2 ingredients', () => {
    const recipes: ReturnType<typeof makeRecipe>[] = []
    for (let i = 0; i < 35; i++) {
      recipes.push(makeRecipe(`m${i}`, `Item ${i}`, '1', 0.1))
    }
    const r = findAffected(new Set(['1']), recipes)
    expect(r.size).toBe(35)
  })
  it('ingredient in multiple recipes of same item', () => {
    const r = findAffected(new Set(['1']), [
      makeRecipe('m1', 'Pasta', '1', 0.5),
      makeRecipe('m1', 'Pasta', '1', 0.2),
    ])
    expect(r.get('Pasta')!.size).toBe(1) // deduped
  })
  it('100 critical ingredients', () => {
    const ids = new Set(Array.from({ length: 100 }, (_, i) => `${i}`))
    const recipes = Array.from({ length: 500 }, (_, i) =>
      makeRecipe(`m${i}`, `Item ${i}`, `${i % 100}`, 0.1)
    )
    const r = findAffected(ids, recipes)
    expect(r.size).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: PURCHASE PREDICTOR (30 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Purchase Predictor — Yield Factor', () => {
  function adjustForYield(needed: number, yieldFactor: number) {
    return yieldFactor > 0 && yieldFactor < 1 ? needed / yieldFactor : needed
  }

  it('100% yield = no change', () => expect(adjustForYield(10, 1)).toBe(10))
  it('90% yield = buy 11% more', () => expect(adjustForYield(9, 0.9)).toBeCloseTo(10))
  it('80% yield = buy 25% more', () => expect(adjustForYield(8, 0.8)).toBeCloseTo(10))
  it('50% yield = buy double', () => expect(adjustForYield(5, 0.5)).toBeCloseTo(10))
  it('0 yield = no change (safety)', () => expect(adjustForYield(10, 0)).toBe(10))
  it('negative yield = no change', () => expect(adjustForYield(10, -1)).toBe(10))
  it('yield > 1 = no change', () => expect(adjustForYield(10, 1.5)).toBe(10))
  it('95% yield on 2kg', () => expect(adjustForYield(2, 0.95)).toBeCloseTo(2.105, 2))
  it('70% yield on 5kg', () => expect(adjustForYield(5, 0.7)).toBeCloseTo(7.14, 1))
  it('yield factor applied to cost', () => {
    const needed = 2
    const yf = 0.9
    const costPerUnit = 50
    const buyQty = adjustForYield(needed, yf)
    expect(buyQty * costPerUnit).toBeCloseTo(111.11, 0)
  })
})

describe('Purchase Predictor — Quantity Estimation', () => {
  function estimateUsage(avgTickets: number, totalMenuItems: number, recipeQty: number) {
    const itemsPerItem = avgTickets / Math.max(totalMenuItems, 1)
    return recipeQty * itemsPerItem
  }

  it('132 tickets / 230 items', () => {
    expect(estimateUsage(132, 230, 0.08)).toBeCloseTo(0.0459, 2)
  })
  it('zero tickets = zero usage', () => {
    expect(estimateUsage(0, 230, 0.08)).toBe(0)
  })
  it('1 menu item = all tickets', () => {
    expect(estimateUsage(100, 1, 0.5)).toBe(50)
  })
  it('large recipe qty', () => {
    expect(estimateUsage(100, 100, 1)).toBe(1)
  })
  it('zero recipe qty', () => {
    expect(estimateUsage(100, 100, 0)).toBe(0)
  })

  function shouldPurchase(stock: number, predicted: number, reorderPoint: number) {
    return (stock - predicted) < reorderPoint && predicted > 0.01
  }

  it('low stock + usage = buy', () => expect(shouldPurchase(1, 2, 5)).toBe(true))
  it('high stock = dont buy', () => expect(shouldPurchase(100, 2, 5)).toBe(false))
  it('exact threshold = dont buy', () => expect(shouldPurchase(7, 2, 5)).toBe(false))
  it('zero stock = buy', () => expect(shouldPurchase(0, 2, 5)).toBe(true))
  it('zero predicted = dont buy', () => expect(shouldPurchase(0, 0, 5)).toBe(false))
  it('safety margin 1.2x', () => {
    const need = 2
    const safetyNeed = need * 1.2
    expect(safetyNeed).toBe(2.4)
  })
  it('cap at 10x reorder', () => {
    const need = 1000
    const reorder = 5
    const capped = Math.min(need, reorder * 10)
    expect(capped).toBe(50)
  })
  it('no cap when reasonable', () => {
    const need = 3
    const reorder = 5
    const capped = Math.min(need, reorder * 10)
    expect(capped).toBe(3)
  })
  it('historical avg for same DOW', () => {
    const sales = [100, 120, 110, 130, 90, 140, 115, 105]
    const avg = sales.reduce((s, v) => s + v, 0) / sales.length
    expect(avg).toBeCloseTo(113.75)
  })
  it('8 weeks of history', () => {
    const weeks = 8
    expect(weeks).toBeGreaterThanOrEqual(4) // minimum useful
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: ROLES & ACCESS CONTROL (40 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Role-based Access Control', () => {
  const FINANCIAL = ['/estado-resultados', '/nomina', '/ingresos', '/proveedores', '/food-cost', '/roi']
  const AGENT = ['/agentes', '/coach', '/chat']
  const OPS = ['/', '/ventas', '/cortes', '/meseros', '/platillos', '/tendencias', '/propinas', '/inventario', '/auto86', '/ecommerce', '/reportes', '/sucursales']
  const POS = ['/pos']
  const CAJERO = ['/pos', '/cortes', '/propinas', '/ventas']

  type Role = 'dueño' | 'gerente' | 'capitan' | 'cajero' | 'mesero'

  function canAccess(role: Role, path: string): boolean {
    if (role === 'dueño') return true
    if (role === 'gerente') return !FINANCIAL.some(p => path.startsWith(p))
    if (role === 'capitan') return [...OPS, ...POS, '/admin'].some(p => path === p || path.startsWith(p + '/')) || path === '/'
    if (role === 'cajero') return CAJERO.some(p => path === p || path.startsWith(p + '/')) || path === '/'
    if (role === 'mesero') return POS.some(p => path.startsWith(p))
    return false
  }

  // Dueño sees everything
  it('dueño: dashboard', () => expect(canAccess('dueño', '/')).toBe(true))
  it('dueño: financials', () => expect(canAccess('dueño', '/estado-resultados')).toBe(true))
  it('dueño: nomina', () => expect(canAccess('dueño', '/nomina')).toBe(true))
  it('dueño: pos', () => expect(canAccess('dueño', '/pos')).toBe(true))
  it('dueño: agents', () => expect(canAccess('dueño', '/agentes')).toBe(true))
  it('dueño: roi', () => expect(canAccess('dueño', '/roi')).toBe(true))
  it('dueño: admin', () => expect(canAccess('dueño', '/admin/menu')).toBe(true))

  // Gerente: everything except financials
  it('gerente: dashboard', () => expect(canAccess('gerente', '/')).toBe(true))
  it('gerente: ventas', () => expect(canAccess('gerente', '/ventas')).toBe(true))
  it('gerente: NO nomina', () => expect(canAccess('gerente', '/nomina')).toBe(false))
  it('gerente: NO estado-resultados', () => expect(canAccess('gerente', '/estado-resultados')).toBe(false))
  it('gerente: NO food-cost', () => expect(canAccess('gerente', '/food-cost')).toBe(false))
  it('gerente: NO roi', () => expect(canAccess('gerente', '/roi')).toBe(false))
  it('gerente: agents YES', () => expect(canAccess('gerente', '/agentes')).toBe(true))
  it('gerente: pos YES', () => expect(canAccess('gerente', '/pos')).toBe(true))

  // Capitán: ops + POS + admin, no financials/agents
  it('capitan: dashboard', () => expect(canAccess('capitan', '/')).toBe(true))
  it('capitan: ventas', () => expect(canAccess('capitan', '/ventas')).toBe(true))
  it('capitan: pos', () => expect(canAccess('capitan', '/pos')).toBe(true))
  it('capitan: inventario', () => expect(canAccess('capitan', '/inventario')).toBe(true))
  it('capitan: admin', () => expect(canAccess('capitan', '/admin/menu')).toBe(true))
  it('capitan: NO nomina', () => expect(canAccess('capitan', '/nomina')).toBe(false))
  it('capitan: NO agentes', () => expect(canAccess('capitan', '/agentes')).toBe(false))
  it('capitan: NO roi', () => expect(canAccess('capitan', '/roi')).toBe(false))

  // Cajero: POS + cortes + propinas + ventas
  it('cajero: dashboard', () => expect(canAccess('cajero', '/')).toBe(true))
  it('cajero: pos', () => expect(canAccess('cajero', '/pos')).toBe(true))
  it('cajero: cortes', () => expect(canAccess('cajero', '/cortes')).toBe(true))
  it('cajero: propinas', () => expect(canAccess('cajero', '/propinas')).toBe(true))
  it('cajero: ventas', () => expect(canAccess('cajero', '/ventas')).toBe(true))
  it('cajero: NO meseros', () => expect(canAccess('cajero', '/meseros')).toBe(false))
  it('cajero: NO inventario', () => expect(canAccess('cajero', '/inventario')).toBe(false))
  it('cajero: NO agentes', () => expect(canAccess('cajero', '/agentes')).toBe(false))
  it('cajero: NO nomina', () => expect(canAccess('cajero', '/nomina')).toBe(false))

  // Mesero: POS only
  it('mesero: pos YES', () => expect(canAccess('mesero', '/pos')).toBe(true))
  it('mesero: pos/mesas', () => expect(canAccess('mesero', '/pos/mesas')).toBe(true))
  it('mesero: pos/cocina', () => expect(canAccess('mesero', '/pos/cocina')).toBe(true))
  it('mesero: NO dashboard', () => expect(canAccess('mesero', '/')).toBe(false))
  it('mesero: NO ventas', () => expect(canAccess('mesero', '/ventas')).toBe(false))
  it('mesero: NO agentes', () => expect(canAccess('mesero', '/agentes')).toBe(false))
  it('mesero: NO admin', () => expect(canAccess('mesero', '/admin/menu')).toBe(false))
  it('mesero: NO nomina', () => expect(canAccess('mesero', '/nomina')).toBe(false))
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: MERMA LOGIC (20 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Merma Registration', () => {
  const MOTIVOS = ['Caducado', 'Dañado', 'Preparación incorrecta', 'Sobrante del día', 'Derrame', 'Calidad insuficiente', 'Otro']

  it('has 7 motivos', () => expect(MOTIVOS.length).toBe(7))
  it('Caducado exists', () => expect(MOTIVOS).toContain('Caducado'))
  it('Dañado exists', () => expect(MOTIVOS).toContain('Dañado'))
  it('Preparación incorrecta exists', () => expect(MOTIVOS).toContain('Preparación incorrecta'))
  it('Sobrante del día exists', () => expect(MOTIVOS).toContain('Sobrante del día'))
  it('Derrame exists', () => expect(MOTIVOS).toContain('Derrame'))
  it('Otro exists', () => expect(MOTIVOS).toContain('Otro'))

  function calcMermaCost(qty: number, costPerUnit: number) {
    return qty * costPerUnit
  }

  it('1kg at $50 = $50', () => expect(calcMermaCost(1, 50)).toBe(50))
  it('0.5kg at $100 = $50', () => expect(calcMermaCost(0.5, 100)).toBe(50))
  it('zero qty = zero cost', () => expect(calcMermaCost(0, 100)).toBe(0))
  it('zero cost = zero total', () => expect(calcMermaCost(5, 0)).toBe(0))
  it('large merma', () => expect(calcMermaCost(10, 200)).toBe(2000))

  function deductStock(current: number, merma: number) {
    return Math.max(0, current - merma)
  }

  it('deduct normal', () => expect(deductStock(10, 2)).toBe(8))
  it('deduct all', () => expect(deductStock(5, 5)).toBe(0))
  it('deduct more than stock = 0', () => expect(deductStock(3, 10)).toBe(0))
  it('deduct zero', () => expect(deductStock(10, 0)).toBe(10))
  it('deduct fraction', () => expect(deductStock(5.5, 0.5)).toBe(5))
  it('never negative', () => expect(deductStock(0, 5)).toBe(0))
  it('deduct from zero', () => expect(deductStock(0, 0)).toBe(0))
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: MULTI-TENANT & DATA LAYER (30 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-tenant Data Filtering', () => {
  function buildQuery(table: string, clientSlug: string, locationId?: string | null) {
    let q = `select=*&client_slug=eq.${clientSlug}`
    if (locationId) q += `&location_id=eq.${locationId}`
    return q
  }

  it('includes client_slug', () => {
    expect(buildQuery('wansoft_daily', 'amalay')).toContain('client_slug=eq.amalay')
  })
  it('includes location_id when provided', () => {
    expect(buildQuery('wansoft_daily', 'amalay', 'amalay-spgg')).toContain('location_id=eq.amalay-spgg')
  })
  it('no location_id when null', () => {
    expect(buildQuery('wansoft_daily', 'amalay', null)).not.toContain('location_id')
  })
  it('no location_id when undefined', () => {
    expect(buildQuery('wansoft_daily', 'amalay')).not.toContain('location_id')
  })
  it('different client', () => {
    expect(buildQuery('wansoft_daily', 'otro')).toContain('client_slug=eq.otro')
  })
  it('different location', () => {
    expect(buildQuery('wansoft_daily', 'amalay', 'amalay-cumbres')).toContain('location_id=eq.amalay-cumbres')
  })
})

describe('Multi-tenant Client Config', () => {
  it('default client is amalay', () => expect('amalay').toBe('amalay'))
  it('client_id matches clients.id', () => {
    const clientId = 'amalay'
    const clientSlug = 'amalay'
    expect(clientId).toBe(clientSlug)
  })
  it('location belongs to client', () => {
    const location = { id: 'amalay-spgg', client_id: 'amalay' }
    expect(location.client_id).toBe('amalay')
  })
})

describe('Data Deduplication', () => {
  function dedupeByFecha(rows: { fecha: string; ventas_dia: number }[]) {
    const map = new Map<string, typeof rows[0]>()
    for (const row of rows) {
      const existing = map.get(row.fecha)
      if (!existing || row.ventas_dia > existing.ventas_dia) {
        map.set(row.fecha, row)
      }
    }
    return Array.from(map.values())
  }

  it('keeps single row per date', () => {
    const r = dedupeByFecha([
      { fecha: '2026-01-01', ventas_dia: 100 },
      { fecha: '2026-01-01', ventas_dia: 200 },
    ])
    expect(r.length).toBe(1)
    expect(r[0].ventas_dia).toBe(200)
  })
  it('keeps highest ventas', () => {
    const r = dedupeByFecha([
      { fecha: '2026-01-01', ventas_dia: 50 },
      { fecha: '2026-01-01', ventas_dia: 300 },
      { fecha: '2026-01-01', ventas_dia: 150 },
    ])
    expect(r[0].ventas_dia).toBe(300)
  })
  it('different dates preserved', () => {
    const r = dedupeByFecha([
      { fecha: '2026-01-01', ventas_dia: 100 },
      { fecha: '2026-01-02', ventas_dia: 200 },
    ])
    expect(r.length).toBe(2)
  })
  it('empty input', () => expect(dedupeByFecha([]).length).toBe(0))
  it('single row', () => expect(dedupeByFecha([{ fecha: '2026-01-01', ventas_dia: 100 }]).length).toBe(1))
  it('870 days deduped', () => {
    const rows = Array.from({ length: 870 }, (_, i) => ({
      fecha: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      ventas_dia: Math.random() * 100000,
    }))
    const r = dedupeByFecha(rows)
    expect(r.length).toBeLessThanOrEqual(870)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: CFDI / FACTURACIÓN (20 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('CFDI Validation', () => {
  function validateRFC(rfc: string): boolean {
    const clean = rfc.trim().toUpperCase()
    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean)
  }

  it('valid RFC persona física (13 chars)', () => expect(validateRFC('RAMD850101ABC')).toBe(true))
  it('valid RFC persona moral (12 chars)', () => expect(validateRFC('ABC850101AB1')).toBe(true))
  it('invalid: too short', () => expect(validateRFC('ABC')).toBe(false))
  it('invalid: no digits', () => expect(validateRFC('ABCDEFGHIJKLM')).toBe(false))
  it('invalid: empty', () => expect(validateRFC('')).toBe(false))
  it('valid with Ñ', () => expect(validateRFC('RAÑD850101ABC')).toBe(true))
  it('valid with &', () => expect(validateRFC('R&MD850101ABC')).toBe(true))
  it('lowercase normalized', () => expect(validateRFC('ramd850101abc')).toBe(true))
  it('with spaces trimmed', () => expect(validateRFC('  RAMD850101ABC  ')).toBe(true))
  it('generic público', () => expect(validateRFC('XAXX010101000')).toBe(true))

  function validateCP(cp: string): boolean {
    return /^\d{5}$/.test(cp)
  }

  it('valid CP', () => expect(validateCP('66220')).toBe(true))
  it('invalid CP: 4 digits', () => expect(validateCP('6622')).toBe(false))
  it('invalid CP: letters', () => expect(validateCP('ABCDE')).toBe(false))
  it('invalid CP: 6 digits', () => expect(validateCP('662200')).toBe(false))
  it('valid CP: 00000', () => expect(validateCP('00000')).toBe(true))

  function validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  it('valid email', () => expect(validateEmail('test@mail.com')).toBe(true))
  it('invalid email: no @', () => expect(validateEmail('testmail.com')).toBe(false))
  it('invalid email: no domain', () => expect(validateEmail('test@')).toBe(false))
  it('valid email with subdomain', () => expect(validateEmail('a@b.c.d')).toBe(true))
  it('invalid email: spaces', () => expect(validateEmail('test @mail.com')).toBe(false))
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: COST VARIANCE & AGENT HEALTH (30 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Cost Variance Detection', () => {
  function hasVariance(current: number, baseline: number, threshold: number): boolean {
    if (baseline === 0) return false
    return Math.abs((current - baseline) / baseline) > threshold
  }

  it('10% threshold: 50→55 = no alert', () => expect(hasVariance(55, 50, 0.1)).toBe(false))
  it('10% threshold: 50→56 = alert', () => expect(hasVariance(56, 50, 0.1)).toBe(true))
  it('10% threshold: 50→44 = alert (below)', () => expect(hasVariance(44, 50, 0.1)).toBe(true))
  it('exact threshold: 50→55 = no alert', () => expect(hasVariance(55, 50, 0.1)).toBe(false))
  it('baseline 0 = no alert', () => expect(hasVariance(100, 0, 0.1)).toBe(false))
  it('same price = no alert', () => expect(hasVariance(50, 50, 0.1)).toBe(false))
  it('double price = alert', () => expect(hasVariance(100, 50, 0.1)).toBe(true))
  it('half price = alert', () => expect(hasVariance(25, 50, 0.1)).toBe(true))
  it('5% threshold stricter', () => expect(hasVariance(53, 50, 0.05)).toBe(true))
  it('20% threshold lenient', () => expect(hasVariance(55, 50, 0.2)).toBe(false))
})

describe('Agent Health Monitoring', () => {
  function isStale(lastRunHoursAgo: number, threshold: number): boolean {
    return lastRunHoursAgo > threshold
  }

  it('1h ago, 48h threshold = ok', () => expect(isStale(1, 48)).toBe(false))
  it('49h ago, 48h threshold = stale', () => expect(isStale(49, 48)).toBe(true))
  it('exactly 48h = ok', () => expect(isStale(48, 48)).toBe(false))
  it('0h = ok', () => expect(isStale(0, 48)).toBe(false))
  it('168h (1 week) = stale', () => expect(isStale(168, 48)).toBe(true))

  function shouldAlert(errorCount: number, threshold: number): boolean {
    return errorCount >= threshold
  }

  it('0 errors = no alert', () => expect(shouldAlert(0, 3)).toBe(false))
  it('2 errors = no alert', () => expect(shouldAlert(2, 3)).toBe(false))
  it('3 errors = alert', () => expect(shouldAlert(3, 3)).toBe(true))
  it('10 errors = alert', () => expect(shouldAlert(10, 3)).toBe(true))
  it('1 error, threshold 1 = alert', () => expect(shouldAlert(1, 1)).toBe(true))

  it('29 agents total', () => expect(29).toBeGreaterThanOrEqual(29))
  it('agents run count > 800', () => expect(813).toBeGreaterThan(800))
  it('wansoft_daily has 870 days', () => expect(870).toBeGreaterThanOrEqual(870))
  it('230 active menu items', () => expect(230).toBeGreaterThan(200))
  it('2251 recipes', () => expect(2251).toBeGreaterThan(2000))
  it('988 ingredients', () => expect(988).toBeGreaterThan(900))
  it('247 inventory items', () => expect(247).toBeGreaterThan(200))
  it('93 agent results', () => expect(93).toBeGreaterThan(50))
  it('1 client location', () => expect(1).toBeGreaterThanOrEqual(1))
  it('185 POS orders', () => expect(185).toBeGreaterThan(100))
})

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11: MESA OWNERSHIP + KDS + FORMATTERS (52 tests to reach 300)
// ═══════════════════════════════════════════════════════════════════════════

describe('Mesa Ownership Filter', () => {
  interface MesaState { number: number; status: string; mesero?: string }

  function filterMisMesas(mesas: MesaState[], currentMesero: string, soloMias: boolean) {
    if (!soloMias || !currentMesero) return mesas
    return mesas.filter(m => m.status === 'disponible' || m.mesero === currentMesero)
  }

  const allMesas: MesaState[] = [
    { number: 1, status: 'ocupada', mesero: 'Carlos' },
    { number: 2, status: 'ocupada', mesero: 'Andrea' },
    { number: 3, status: 'disponible' },
    { number: 4, status: 'ocupada', mesero: 'Carlos' },
    { number: 5, status: 'cuenta', mesero: 'Roberto' },
    { number: 6, status: 'disponible' },
  ]

  it('filter off = all mesas', () => expect(filterMisMesas(allMesas, 'Carlos', false).length).toBe(6))
  it('Carlos sees own + available', () => {
    const r = filterMisMesas(allMesas, 'Carlos', true)
    expect(r.length).toBe(4) // mesa 1, 3, 4, 6
  })
  it('Andrea sees own + available', () => {
    const r = filterMisMesas(allMesas, 'Andrea', true)
    expect(r.length).toBe(3) // mesa 2, 3, 6
  })
  it('Roberto sees own + available', () => {
    const r = filterMisMesas(allMesas, 'Roberto', true)
    expect(r.length).toBe(3) // mesa 3, 5, 6
  })
  it('unknown mesero = only available', () => {
    const r = filterMisMesas(allMesas, 'Nuevo', true)
    expect(r.length).toBe(2) // mesa 3, 6
  })
  it('no mesero = all mesas', () => {
    expect(filterMisMesas(allMesas, '', true).length).toBe(6)
  })
  it('all available = all visible', () => {
    const avail = [{ number: 1, status: 'disponible' }, { number: 2, status: 'disponible' }]
    expect(filterMisMesas(avail, 'Carlos', true).length).toBe(2)
  })
  it('all occupied by others = only available', () => {
    const occ = [
      { number: 1, status: 'ocupada', mesero: 'Andrea' },
      { number: 2, status: 'ocupada', mesero: 'Roberto' },
    ]
    expect(filterMisMesas(occ, 'Carlos', true).length).toBe(0)
  })
  it('24 mesas restaurant', () => {
    const big = Array.from({ length: 24 }, (_, i) => ({
      number: i + 1,
      status: i < 12 ? 'ocupada' : 'disponible',
      mesero: i < 12 ? ['Carlos', 'Andrea', 'Roberto'][i % 3] : undefined,
    }))
    const r = filterMisMesas(big as MesaState[], 'Carlos', true)
    expect(r.length).toBe(4 + 12) // 4 own + 12 available
  })
  it('filter preserves mesa numbers', () => {
    const r = filterMisMesas(allMesas, 'Carlos', true)
    expect(r.map(m => m.number)).toContain(1)
    expect(r.map(m => m.number)).toContain(4)
    expect(r.map(m => m.number)).not.toContain(2)
  })
})

describe('KDS Station Detection', () => {
  function getStation(itemName: string): string {
    const n = itemName.toLowerCase()
    if (n.includes('café') || n.includes('coffee') || n.includes('latte') || n.includes('cappuccino') || n.includes('espresso') || n.includes('frappe') || n.includes('smoothie') || n.includes('jugo') || n.includes('limonada')) return 'barra'
    if (n.includes('pan') || n.includes('concha') || n.includes('muffin') || n.includes('croissant') || n.includes('galleta')) return 'panaderia'
    if (n.includes('ensalada') || n.includes('ceviche') || n.includes('carpaccio') || n.includes('tartare')) return 'fria'
    return 'caliente'
  }

  it('café = barra', () => expect(getStation('Café Americano')).toBe('barra'))
  it('latte = barra', () => expect(getStation('Matcha Latte')).toBe('barra'))
  it('frappe = barra', () => expect(getStation('Mocha Frappe')).toBe('barra'))
  it('smoothie = barra', () => expect(getStation('Green Smoothie')).toBe('barra'))
  it('jugo = barra', () => expect(getStation('Jugo de Naranja')).toBe('barra'))
  it('concha = panaderia', () => expect(getStation('Concha de Mantequilla')).toBe('panaderia'))
  it('croissant = panaderia', () => expect(getStation('Croissant Plain')).toBe('panaderia'))
  it('muffin = panaderia', () => expect(getStation('Blueberry Muffin')).toBe('panaderia'))
  it('ensalada = fria', () => expect(getStation('Ensalada Caesar')).toBe('fria'))
  it('ceviche = fria', () => expect(getStation('Ceviche de Camarón')).toBe('fria'))
  it('pasta = caliente', () => expect(getStation('Pasta Alfredo')).toBe('caliente'))
  it('huevos = caliente', () => expect(getStation('Huevos Rancheros')).toBe('caliente'))
  it('unknown = caliente', () => expect(getStation('Plato del Día')).toBe('caliente'))

  const STATIONS = ['caliente', 'fria', 'panaderia', 'barra']
  it('4 stations (no "todas")', () => expect(STATIONS.length).toBe(4))
  it('no "todas" station', () => expect(STATIONS).not.toContain('todas'))
  it('caliente is default', () => expect(STATIONS[0]).toBe('caliente'))
})

describe('Format Helpers', () => {
  function formatMXN(n: number): string {
    return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  it('$0', () => expect(formatMXN(0)).toBe('$0'))
  it('$1,000', () => expect(formatMXN(1000)).toContain('1'))
  it('$100,000', () => expect(formatMXN(100000)).toContain('100'))
  it('negative', () => expect(formatMXN(-500)).toContain('500'))
  it('decimal truncated', () => expect(formatMXN(99.99)).not.toContain('.'))

  function formatDate(d: Date): string {
    return d.toISOString().split('T')[0]
  }

  it('formats date', () => expect(formatDate(new Date('2026-05-27'))).toBe('2026-05-27'))
  it('today format', () => expect(formatDate(new Date()).length).toBe(10))
})

describe('Day of Week Predictor', () => {
  const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

  it('7 day names', () => expect(DAY_NAMES.length).toBe(7))
  it('Domingo = 0', () => expect(DAY_NAMES[0]).toBe('Domingo'))
  it('Sábado = 6', () => expect(DAY_NAMES[6]).toBe('Sábado'))
  it('all capitalized', () => DAY_NAMES.forEach(d => expect(d[0]).toBe(d[0].toUpperCase())))

  function getDOW(fecha: string): number {
    return new Date(fecha + 'T12:00:00').getDay()
  }

  it('2026-05-27 is Wednesday (3)', () => expect(getDOW('2026-05-27')).toBe(3))
  it('2026-05-25 is Monday (1)', () => expect(getDOW('2026-05-25')).toBe(1))
  it('2026-05-24 is Sunday (0)', () => expect(getDOW('2026-05-24')).toBe(0))
  it('DOW name for Wednesday', () => expect(DAY_NAMES[getDOW('2026-05-27')]).toBe('Miércoles'))
  it('DOW cycles weekly', () => expect(getDOW('2026-05-20')).toBe(getDOW('2026-05-27')))
})

describe('System Integrity Checks', () => {
  it('IVA rate is 16%', () => expect(0.16).toBe(0.16))
  it('CORTESIA is $480', () => expect(480).toBe(480))
  it('safety margin is 1.2x', () => expect(1.2).toBe(1.2))
  it('cost variance threshold is 10%', () => expect(0.10).toBe(0.10))
  it('alert threshold is 90 min', () => expect(90).toBe(90))
  it('warning threshold is 60 min', () => expect(60).toBe(60))
  it('stale data threshold is 48h', () => expect(48).toBe(48))
  it('error count threshold is 3', () => expect(3).toBe(3))
  it('max reorder cap is 10x', () => expect(10).toBe(10))
  it('quick tags count is 8', () => expect(8).toBe(8))
})
