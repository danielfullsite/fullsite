import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── localStorage mock (needed for _getClientId()) ───────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  localStorageMock.clear()
  // Set client to a test client so _getClientId() returns predictable value
  store['fullsite_client_id'] = 'test-client'
  vi.restoreAllMocks()
})

// ─── Import after mocking ─────────────────────────────────────────────────────

import {
  fetchRecipeRefCoverage,
  deductIngredientsForOrder,
  type OrderItem,
} from '@/lib/pos-data'

// ─── fetchRecipeRefCoverage ───────────────────────────────────────────────────

describe('fetchRecipeRefCoverage', () => {
  it('returns zero stats when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const result = await fetchRecipeRefCoverage('test-client')
    expect(result.totalItems).toBe(0)
    expect(result.withRef).toBe(0)
    expect(result.withoutRef).toBe(0)
    expect(result.coveragePct).toBe(0)
  })

  it('counts items with and without recipe_ref', async () => {
    const mockRows = [
      { id: 'i1', recipe_ref: 'chilaquiles verdes' },
      { id: 'i2', recipe_ref: 'avo toast' },
      { id: 'i3', recipe_ref: null },
      { id: 'i4', recipe_ref: null },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRows,
    }))
    const result = await fetchRecipeRefCoverage('test-client')
    expect(result.totalItems).toBe(4)
    expect(result.withRef).toBe(2)
    expect(result.withoutRef).toBe(2)
    expect(result.coveragePct).toBe(50)
  })

  it('returns 100% coverage when all items have recipe_ref', async () => {
    const mockRows = [
      { id: 'a', recipe_ref: 'recipe-a' },
      { id: 'b', recipe_ref: 'recipe-b' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRows,
    }))
    const result = await fetchRecipeRefCoverage('test-client')
    expect(result.coveragePct).toBe(100)
    expect(result.withoutRef).toBe(0)
  })

  it('handles empty menu gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }))
    const result = await fetchRecipeRefCoverage('test-client')
    expect(result.totalItems).toBe(0)
    expect(result.coveragePct).toBe(0)
  })

  it('handles network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const result = await fetchRecipeRefCoverage('test-client')
    expect(result.totalItems).toBe(0)
    expect(result.coveragePct).toBe(0)
  })
})

// ─── deductIngredientsForOrder — resolution paths ────────────────────────────

// Helper: build a minimal OrderItem for test purposes
function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    menuItemId: 'menu-1',
    nombre: 'Test Item',
    precio: 100,
    cantidad: 1,
    modificadores: [],
    notas: '',
    precioExtra: 0,
    subtotal: 100,
    ...overrides,
  }
}

// Helper: set up URL-based fetch mock for deductIngredientsForOrder.
// getInventory() makes two parallel calls: pos_inventory + pos_ingredients
// which are joined client-side to produce ingredient_name.
function mockFetchSequence({
  recipes = [] as { menu_item_name: string; ingredient_id: string; quantity: number; unit: string }[],
  // pos_inventory rows
  inventoryRows = [] as { ingredient_id: string; stock: number; reorder_point: number }[],
  // pos_ingredients rows (provides name/unit/category)
  ingredientRows = [] as { id: string; name: string; unit: string; category: string; cost_per_unit: number; yield_factor: number; active: boolean }[],
  recipeRefs = [] as { id: string; recipe_ref: string | null }[],
}: {
  recipes?: { menu_item_name: string; ingredient_id: string; quantity: number; unit: string }[]
  inventoryRows?: { ingredient_id: string; stock: number; reorder_point: number }[]
  ingredientRows?: { id: string; name: string; unit: string; category: string; cost_per_unit: number; yield_factor: number; active: boolean }[]
  recipeRefs?: { id: string; recipe_ref: string | null }[]
}) {
  let recipePageCalled = false
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    // recipes (paginated — first call returns data, second returns empty to stop the loop)
    if (url.includes('pos_recipes_old')) {
      if (!recipePageCalled) { recipePageCalled = true; return Promise.resolve({ ok: true, json: async () => recipes }) }
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    // pos_inventory stock rows
    if (url.includes('pos_inventory') && !url.includes('pos_inventory_movements')) {
      return Promise.resolve({ ok: true, json: async () => inventoryRows })
    }
    // pos_ingredients (name/category/cost)
    if (url.includes('pos_ingredients')) {
      return Promise.resolve({ ok: true, json: async () => ingredientRows })
    }
    // recipe refs from pos_menu_items
    if (url.includes('pos_menu_items') && url.includes('recipe_ref')) {
      return Promise.resolve({ ok: true, json: async () => recipeRefs })
    }
    // updateInventoryStock PATCH, logInventoryMovement POST, anything else
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }))
}

describe('deductIngredientsForOrder — resolution paths', () => {
  it('uses DB path when recipe_ref is set and matching recipe exists', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [
        { menu_item_name: 'avo toast', ingredient_id: 'avocado', quantity: 0.5, unit: 'pz' },
      ],
      inventoryRows: [
        { ingredient_id: 'avocado', stock: 10, reorder_point: 2 },
      ],
      ingredientRows: [
        { id: 'avocado', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 15, yield_factor: 1, active: true },
      ],
      recipeRefs: [
        { id: 'menu-avocado-toast', recipe_ref: 'avo toast' },
      ],
    })

    const result = await deductIngredientsForOrder(
      [makeItem({ menuItemId: 'menu-avocado-toast', nombre: 'AVOCADO TOAST', cantidad: 1 })],
      'order-db-path',
      'test-mesero',
    )

    expect(result.success).toBe(true)
    expect(result.deductions).toHaveLength(1)
    expect(result.deductions[0].ingredient).toBe('Aguacate')
    // DB path: no fuzzy warning emitted
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[deduct:fuzzy]'))
    // Summary should show db=1
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('db=1'))
  })

  it('falls back to fuzzy when recipe_ref is null — logs [deduct:fuzzy]', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [
        { menu_item_name: 'chilaquiles verdes', ingredient_id: 'chile', quantity: 0.1, unit: 'kg' },
      ],
      inventoryRows: [
        { ingredient_id: 'chile', stock: 5, reorder_point: 1 },
      ],
      ingredientRows: [
        { id: 'chile', name: 'Chile Verde', unit: 'kg', category: 'produce', cost_per_unit: 20, yield_factor: 1, active: true },
      ],
      recipeRefs: [
        { id: 'c1a', recipe_ref: null },
      ],
    })

    const result = await deductIngredientsForOrder(
      [makeItem({ menuItemId: 'c1a', nombre: 'Chilaquiles Verdes', cantidad: 1 })],
      'order-fuzzy-path',
      'test-mesero',
    )

    expect(result.success).toBe(true)
    // Fuzzy match on 'chilaquiles verdes' should find the recipe
    expect(result.deductions).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[deduct:fuzzy]'))
  })

  it('logs [deduct:miss] when no recipe found via DB or fuzzy — never skips silently', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [],
      inventoryRows: [],
      ingredientRows: [],
      recipeRefs: [],
    })

    const result = await deductIngredientsForOrder(
      [makeItem({ menuItemId: 'unknown-item', nombre: 'Platillo Desconocido', cantidad: 1 })],
      'order-miss',
      'test-mesero',
    )

    expect(result.success).toBe(true)
    expect(result.deductions).toHaveLength(0)
    // Must log miss — no silent skip
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[deduct:miss]')
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Platillo Desconocido')
    )
  })

  it('handles multiple items with mixed resolution paths in one order', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [
        { menu_item_name: 'avo toast', ingredient_id: 'avocado', quantity: 0.5, unit: 'pz' },
        { menu_item_name: 'cafe americano', ingredient_id: 'cafe', quantity: 0.02, unit: 'kg' },
      ],
      inventoryRows: [
        { ingredient_id: 'avocado', stock: 10, reorder_point: 2 },
        { ingredient_id: 'cafe', stock: 1, reorder_point: 0.1 },
      ],
      ingredientRows: [
        { id: 'avocado', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 15, yield_factor: 1, active: true },
        { id: 'cafe', name: 'Café', unit: 'kg', category: 'dry', cost_per_unit: 200, yield_factor: 1, active: true },
      ],
      recipeRefs: [
        { id: 'toast-id', recipe_ref: 'avo toast' },
        { id: 'cafe-id', recipe_ref: null },
      ],
    })

    await deductIngredientsForOrder(
      [
        makeItem({ menuItemId: 'toast-id', nombre: 'AVOCADO TOAST', cantidad: 1 }),
        makeItem({ menuItemId: 'cafe-id',  nombre: 'CAFE AMERICANO', cantidad: 1 }),
        makeItem({ menuItemId: 'missing-id', nombre: 'Platillo Sin Receta', cantidad: 1 }),
      ],
      'order-mixed',
      'test-mesero',
    )

    // Summary line should show all three paths
    const summaryCall = infoSpy.mock.calls.find(c => String(c[0]).includes('[deduct:summary]'))
    expect(summaryCall).toBeDefined()
    const summary = String(summaryCall![0])
    expect(summary).toContain('items=3')
    expect(summary).toContain('db=1')
    expect(summary).toContain('fuzzy=1')
    expect(summary).toContain('miss=1')

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[deduct:fuzzy]'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[deduct:miss]'))
  })

  it('returns success:false when getRecipes throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const result = await deductIngredientsForOrder(
      [makeItem()],
      'order-error',
      'test',
    )
    expect(result.success).toBe(false)
    expect(result.deductions).toHaveLength(0)
  })

  // ── resolution field ────────────────────────────────────────────────────────

  it('resolution.DB_MAPPING populated when recipe_ref resolves', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [{ menu_item_name: 'avo toast', ingredient_id: 'avocado', quantity: 0.5, unit: 'pz' }],
      inventoryRows: [{ ingredient_id: 'avocado', stock: 10, reorder_point: 2 }],
      ingredientRows: [{ id: 'avocado', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 15, yield_factor: 1, active: true }],
      recipeRefs: [{ id: 'menu-avo', recipe_ref: 'avo toast' }],
    })

    const result = await deductIngredientsForOrder(
      [makeItem({ menuItemId: 'menu-avo', nombre: 'AVOCADO TOAST' })],
      'order-res-db', 'test',
    )

    expect(result.resolution.DB_MAPPING).toContain('AVOCADO TOAST')
    expect(result.resolution.FUZZY_FALLBACK).toHaveLength(0)
    expect(result.resolution.UNRESOLVED).toHaveLength(0)
  })

  it('resolution.FUZZY_FALLBACK populated when recipe_ref is null but RECIPE_ALIASES resolves', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [{ menu_item_name: 'chilaquiles verdes', ingredient_id: 'chile', quantity: 0.1, unit: 'kg' }],
      inventoryRows: [{ ingredient_id: 'chile', stock: 5, reorder_point: 1 }],
      ingredientRows: [{ id: 'chile', name: 'Chile Verde', unit: 'kg', category: 'produce', cost_per_unit: 20, yield_factor: 1, active: true }],
      recipeRefs: [{ id: 'ch1', recipe_ref: null }],
    })

    const result = await deductIngredientsForOrder(
      [makeItem({ menuItemId: 'ch1', nombre: 'Chilaquiles Verdes' })],
      'order-res-fuzzy', 'test',
    )

    expect(result.resolution.FUZZY_FALLBACK).toContain('Chilaquiles Verdes')
    expect(result.resolution.DB_MAPPING).toHaveLength(0)
    expect(result.resolution.UNRESOLVED).toHaveLength(0)
  })

  it('resolution.UNRESOLVED populated when no recipe found anywhere', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({ recipes: [], inventoryRows: [], ingredientRows: [], recipeRefs: [] })

    const result = await deductIngredientsForOrder(
      [makeItem({ nombre: 'Platillo Desconocido' })],
      'order-res-unresolved', 'test',
    )

    expect(result.resolution.UNRESOLVED).toContain('Platillo Desconocido')
    expect(result.resolution.DB_MAPPING).toHaveLength(0)
    expect(result.resolution.FUZZY_FALLBACK).toHaveLength(0)
  })

  it('resolution reflects all three states in a mixed order', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    mockFetchSequence({
      recipes: [
        { menu_item_name: 'avo toast', ingredient_id: 'avocado', quantity: 0.5, unit: 'pz' },
        { menu_item_name: 'chilaquiles verdes', ingredient_id: 'chile', quantity: 0.1, unit: 'kg' },
      ],
      inventoryRows: [
        { ingredient_id: 'avocado', stock: 10, reorder_point: 2 },
        { ingredient_id: 'chile', stock: 5, reorder_point: 1 },
      ],
      ingredientRows: [
        { id: 'avocado', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 15, yield_factor: 1, active: true },
        { id: 'chile', name: 'Chile Verde', unit: 'kg', category: 'produce', cost_per_unit: 20, yield_factor: 1, active: true },
      ],
      recipeRefs: [
        { id: 'toast-id', recipe_ref: 'avo toast' },
        { id: 'chil-id', recipe_ref: null },
      ],
    })

    const result = await deductIngredientsForOrder(
      [
        makeItem({ menuItemId: 'toast-id', nombre: 'AVOCADO TOAST' }),
        makeItem({ menuItemId: 'chil-id',  nombre: 'Chilaquiles Verdes' }),
        makeItem({ menuItemId: 'unk-id',   nombre: 'Platillo Nuevo' }),
      ],
      'order-res-mixed', 'test',
    )

    expect(result.resolution.DB_MAPPING).toEqual(['AVOCADO TOAST'])
    expect(result.resolution.FUZZY_FALLBACK).toEqual(['Chilaquiles Verdes'])
    expect(result.resolution.UNRESOLVED).toEqual(['Platillo Nuevo'])
  })

  it('resolution is empty arrays when function throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const result = await deductIngredientsForOrder([makeItem()], 'order-err', 'test')
    expect(result.success).toBe(false)
    expect(result.resolution.DB_MAPPING).toHaveLength(0)
    expect(result.resolution.FUZZY_FALLBACK).toHaveLength(0)
    expect(result.resolution.UNRESOLVED).toHaveLength(0)
  })
})
