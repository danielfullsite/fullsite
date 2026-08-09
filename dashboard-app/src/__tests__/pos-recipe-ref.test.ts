import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock logPolicyGateFailure so gate tests don't produce telemetry fetches ──
vi.mock('@/lib/inventory-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inventory-policy')>()
  return { ...actual, logPolicyGateFailure: vi.fn() }
})

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
import { inventoryPolicyService } from '@/lib/inventory-policy'

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


// ─── W1-A — resolución de recetas retirada del cliente ───────────────────────
// Los describes que vivían aquí (resolution paths db/fuzzy/miss, R1 gate
// fail-restrictive, READY_CACHED) probaban a Sistema A, retirado en W1-A.
// R1 resuelve por pos_recipe_versions/pos_recipe_lines server-side; el fuzzy
// matching por nombre ya no existe en ninguna ruta de venta.

describe('W1-A — deductIngredientsForOrder es un stub inerte', () => {
  it('marca todos los items R1_OWNED sin tocar la red', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('W1-A violation: network call') })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await deductIngredientsForOrder(
      [makeItem({ nombre: 'Chilaquiles Verdes' }), makeItem({ id: 'i2', nombre: 'Latte' })],
      'order-w1a', 'Mesero',
    )
    expect(r.success).toBe(true)
    expect(r.resolution.R1_OWNED).toEqual(['Chilaquiles Verdes', 'Latte'])
    expect(r.resolution.DB_MAPPING).toHaveLength(0)
    expect(r.resolution.FUZZY_FALLBACK).toHaveLength(0)
    expect(r.resolution.UNRESOLVED).toHaveLength(0)
    expect(r.deductions).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
