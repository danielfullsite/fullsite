import { describe, it, expect } from 'vitest'
import {
  normalizeName,
  normalizeUnit,
  deriveRecipeLines,
  deriveStockUnits,
  type SourceRecipe,
  type CatalogIngredient,
  type CatalogMenuItem,
} from '@/lib/recipe-derivation'

describe('normalizeName', () => {
  it('minúsculas, sin acentos, espacios colapsados', () => {
    expect(normalizeName('  Leche  Entera ')).toBe('leche entera')
    expect(normalizeName('Pimienta Negra molida')).toBe('pimienta negra molida')
    expect(normalizeName('Crema Ácida')).toBe('crema acida')
  })
  it('empata variantes de mayúsculas/acentos', () => {
    expect(normalizeName('Mantequilla sin Sal')).toBe(normalizeName('Mantequilla sin sal'))
    expect(normalizeName('Café')).toBe(normalizeName('cafe'))
  })
})

describe('normalizeUnit', () => {
  it('mapea el vocabulario del Excel al canónico', () => {
    expect(normalizeUnit('GRS')).toBe('g')
    expect(normalizeUnit('ML')).toBe('ml')
    expect(normalizeUnit('PZA')).toBe('pz')
    expect(normalizeUnit('Kg')).toBe('kg')
    expect(normalizeUnit('LTS')).toBe('lt')
  })
  it('devuelve null para unidad desconocida o vacía', () => {
    expect(normalizeUnit('cucharada')).toBeNull()
    expect(normalizeUnit('')).toBeNull()
    expect(normalizeUnit(null)).toBeNull()
    expect(normalizeUnit(undefined)).toBeNull()
  })
})

const ingredients: CatalogIngredient[] = [
  { id: 'chk-ing-001', name: 'Pasta Codo #2 Liso', unit: 'GRS' },
  { id: 'chk-ing-002', name: 'Queso Cheddar', unit: 'GRS' },
  { id: 'chk-ing-003', name: 'Papa Congelada', unit: 'GRS' },
  { id: 'chk-ing-004', name: 'Aceite', unit: 'ML' },
  { id: 'chk-ing-005', name: 'Coca Cola 355 ml', unit: 'PZA' },
  { id: 'chk-ing-006', name: 'Leche Entera', unit: 'ML' }, // catálogo con mayúscula
]

const menuItems: CatalogMenuItem[] = [
  { id: 'chk-mi-001', name: 'Mac & Cheese' },
  { id: 'chk-mi-002', name: 'Chickin Fries' },
  { id: 'chk-mi-003', name: 'Combo Mac' },
  { id: 'chk-mi-004', name: 'Bebida Sola' },
]

describe('deriveRecipeLines — receta base', () => {
  it('emite una línea por insumo con id resuelto y unidad canónica', () => {
    const recipes: SourceRecipe[] = [
      {
        nombre: 'Mac & Cheese', precio_venta: 75,
        ingredientes: [
          { nombre: 'Pasta Codo #2 Liso', porcion: 114, um: 'GRS' },
          { nombre: 'Queso Cheddar', porcion: 20, um: 'GRS' },
        ],
      },
    ]
    const { rows, report } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(2)
    const pasta = rows.find(r => r.ingredient_id === 'chk-ing-001')!
    expect(pasta.menu_item_id).toBe('chk-mi-001')
    expect(pasta.quantity).toBe(114)
    expect(pasta.unit).toBe('g')
    expect(pasta.ingredient_type).toBe('ingredient')
    expect(report.unresolvedNames).toEqual([])
    expect(report.menuItemsNotFound).toEqual([])
  })

  it('resuelve insumos con acento/mayúscula distinta al catálogo', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Bebida Sola', precio_venta: 40, ingredientes: [{ nombre: 'leche entera', porcion: 200, um: 'ML' }] },
    ]
    const { rows } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(1)
    expect(rows[0].ingredient_id).toBe('chk-ing-006')
    expect(rows[0].unit).toBe('ml')
  })

  it('agrega insumos duplicados sumando cantidades', () => {
    const recipes: SourceRecipe[] = [
      {
        nombre: 'Mac & Cheese', precio_venta: 75,
        ingredientes: [
          { nombre: 'Queso Cheddar', porcion: 20, um: 'GRS' },
          { nombre: 'Queso Cheddar', porcion: 5, um: 'GRS' },
        ],
      },
    ]
    const { rows } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(25)
  })
})

describe('deriveRecipeLines — combos y subrecetas (explosión)', () => {
  it('explota un combo a los insumos de sus componentes, escalando por porción', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Mac & Cheese', precio_venta: 75, ingredientes: [{ nombre: 'Pasta Codo #2 Liso', porcion: 114, um: 'GRS' }] },
      { nombre: 'Chickin Fries', precio_venta: 69, ingredientes: [{ nombre: 'Papa Congelada', porcion: 150, um: 'GRS' }, { nombre: 'Aceite', porcion: 30, um: 'ML' }] },
      {
        nombre: 'Combo Mac', precio_venta: 180,
        ingredientes: [
          { nombre: 'Mac & Cheese', porcion: 1, um: 'Plato' },
          { nombre: 'Chickin Fries', porcion: 2, um: 'Orden' },
          { nombre: 'Coca Cola 355 ml', porcion: 1, um: 'PZA' },
        ],
      },
    ]
    const { rows, report } = deriveRecipeLines(recipes, ingredients, menuItems)
    const combo = rows.filter(r => r.menu_item_id === 'chk-mi-003')
    // pasta (1×114) + papa (2×150) + aceite (2×30) + coca (1)
    expect(combo.find(r => r.ingredient_id === 'chk-ing-001')!.quantity).toBe(114)
    expect(combo.find(r => r.ingredient_id === 'chk-ing-003')!.quantity).toBe(300)
    expect(combo.find(r => r.ingredient_id === 'chk-ing-004')!.quantity).toBe(60)
    expect(combo.find(r => r.ingredient_id === 'chk-ing-005')!.quantity).toBe(1)
    expect(report.unresolvedNames).toEqual([])
  })

  it('no entra en bucle infinito ante un ciclo y lo reporta', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Combo Mac', precio_venta: 180, ingredientes: [{ nombre: 'Combo Mac', porcion: 1, um: 'x' }] },
    ]
    const { rows, report } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(0)
    expect(report.cyclesDetected).toContain('Combo Mac')
  })
})

describe('deriveRecipeLines — reportes (nada silencioso)', () => {
  it('reporta nombres no resueltos sin descartarlos en silencio', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Mac & Cheese', precio_venta: 75, ingredientes: [{ nombre: 'Ingrediente Fantasma', porcion: 10, um: 'GRS' }] },
    ]
    const { rows, report } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(0)
    expect(report.unresolvedNames).toContain('Ingrediente Fantasma')
  })

  it('reporta unidades desconocidas y deja la línea con unit=null', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Mac & Cheese', precio_venta: 75, ingredientes: [{ nombre: 'Pasta Codo #2 Liso', porcion: 2, um: 'cucharada' }] },
    ]
    const { rows, report } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(1)
    expect(rows[0].unit).toBeNull()
    expect(report.unknownUnits).toContain('cucharada')
  })

  it('reporta recetas vendibles sin platillo de menú', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Platillo Sin Menú', precio_venta: 50, ingredientes: [{ nombre: 'Pasta Codo #2 Liso', porcion: 1, um: 'GRS' }] },
    ]
    const { report } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(report.menuItemsNotFound).toContain('Platillo Sin Menú')
  })

  it('ignora subrecetas (precio_venta null) como platillos vendibles', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Aderezo', precio_venta: null, ingredientes: [{ nombre: 'Aceite', porcion: 10, um: 'ML' }] },
    ]
    const { rows } = deriveRecipeLines(recipes, ingredients, menuItems)
    expect(rows).toHaveLength(0)
  })

  it('explota una subreceta cuando una receta vendible la referencia', () => {
    const recipes: SourceRecipe[] = [
      { nombre: 'Aderezo', precio_venta: null, ingredientes: [{ nombre: 'Aceite', porcion: 10, um: 'ML' }] },
      { nombre: 'Chickin Fries', precio_venta: 69, ingredientes: [{ nombre: 'Papa Congelada', porcion: 150, um: 'GRS' }, { nombre: 'Aderezo', porcion: 1, um: 'porcion' }] },
    ]
    const { rows } = deriveRecipeLines(recipes, ingredients, menuItems)
    const fries = rows.filter(r => r.menu_item_id === 'chk-mi-002')
    expect(fries.find(r => r.ingredient_id === 'chk-ing-003')!.quantity).toBe(150)
    expect(fries.find(r => r.ingredient_id === 'chk-ing-004')!.quantity).toBe(10) // del aderezo explotado
  })
})

describe('deriveStockUnits', () => {
  it('deriva stock_unit canónico y reporta unidades desconocidas', () => {
    const { updates, unknownUnits } = deriveStockUnits([
      { id: 'a', name: 'X', unit: 'GRS' },
      { id: 'b', name: 'Y', unit: 'PZA' },
      { id: 'c', name: 'Z', unit: 'cucharada' },
      { id: 'd', name: 'W', unit: null },
    ])
    expect(updates).toEqual([
      { id: 'a', stock_unit: 'g' },
      { id: 'b', stock_unit: 'pz' },
    ])
    expect(unknownUnits.map(u => u.id).sort()).toEqual(['c', 'd'])
  })
})
