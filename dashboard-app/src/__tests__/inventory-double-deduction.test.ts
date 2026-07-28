import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  store['fullsite_client_id'] = 'test-client'
  vi.restoreAllMocks()
})

// ─── Imports after mocking ────────────────────────────────────────────────────
import { deductIngredientsForOrder, type OrderItem } from '@/lib/pos-data'
import { inventoryPolicyService } from '@/lib/inventory-policy'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1', menuItemId: 'menu-avocado', nombre: 'Aguacate Toast',
    precio: 120, cantidad: 1, modificadores: [], notas: '',
    precioExtra: 0, subtotal: 120, ...overrides,
  }
}

/**
 * Stateful fetch mock: tracks PATCH calls to pos_inventory and maintains
 * a real stock value that changes with each write, so a second sequential
 * call reads the updated value (stale-read double-deduction scenario).
 *
 * NOTE: No `recipePageCalled` flag needed. getRecipes() breaks the pagination
 * loop when rows.length < 1000 — returning 1 row is sufficient to stop it.
 * A shared flag would incorrectly suppress recipes on the second deduct call.
 */
function makeStatefulFetchMock() {
  const patchCalls: { ingredientId: string; newStock: number }[] = []
  let currentStock = 10  // stock starts at 10; each PATCH updates it

  const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    // recipes — always return the same 1-row list; loop breaks on rows.length < 1000
    if (url.includes('pos_recipes_old')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { menu_item_name: 'aguacate toast', ingredient_id: 'avocado-id', quantity: 1, unit: 'pz' },
        ],
      })
    }
    // pos_inventory stock (GET) — returns live currentStock value
    if (url.includes('pos_inventory') && !url.includes('pos_inventory_movements') && opts?.method !== 'PATCH') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ ingredient_id: 'avocado-id', stock: currentStock, reorder_point: 2 }],
      })
    }
    // pos_ingredients (name/unit)
    if (url.includes('pos_ingredients')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'avocado-id', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 25, yield_factor: 1, active: true },
        ],
      })
    }
    // recipe_ref lookup
    if (url.includes('pos_menu_items') && url.includes('recipe_ref')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 'menu-avocado', recipe_ref: 'aguacate toast' }],
      })
    }
    // PATCH pos_inventory — the stock write we track
    if (url.includes('pos_inventory') && opts?.method === 'PATCH') {
      const body = JSON.parse(opts?.body as string)
      patchCalls.push({ ingredientId: 'avocado-id', newStock: body.stock })
      currentStock = body.stock
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })

  return { fetchMock, patchCalls }
}

// ─── P0: Double Deduction Regression Suite ───────────────────────────────────

/**
 * These tests document the P0 double-deduction bug:
 *
 *   ROOT CAUSE: deductIngredientsForOrder() has NO deduction-level idempotency.
 *   _gateFailureOrderIds only deduplicates telemetry events, not actual DB writes.
 *
 *   In handlePayment() (pos/page.tsx:3214), the call is fire-and-forget:
 *     deductIngredientsForOrder(...).then(...).catch(...)   // no await
 *   operationLock is released in the finally block (line 3279) BEFORE the
 *   deduction promise resolves. A second handlePayment() call can enter while
 *   the first deduction is still in-flight, causing a second deduction.
 *
 *   FIX REQUIRED: add a deduction-level idempotency guard inside
 *   deductIngredientsForOrder() that short-circuits on seen orderIds,
 *   independent of the gate-failure guard.
 *
 *   These tests FAIL in the current implementation and must PASS after the fix.
 */
describe('P0 — inventory double-deduction regression', () => {

  beforeEach(() => {
    vi.spyOn(inventoryPolicyService, 'isReady').mockReturnValue(true)
    // All items are non-recipe (Sistema A path)
    vi.spyOn(inventoryPolicyService, 'getMode').mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('TC-DD-01: sequential double call same orderId → PATCH fires exactly once', async () => {
    // This simulates the lock-released-before-deduction scenario:
    // call 1 fires and completes, then call 2 (same orderId) fires because
    // the UI does not prevent it after operationLock is released.
    const { fetchMock, patchCalls } = makeStatefulFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    const item = makeItem({ cantidad: 1 })
    const orderId = 'order-sequential-dd-01'

    const r1 = await deductIngredientsForOrder([item], orderId, 'test-mesero')
    const r2 = await deductIngredientsForOrder([item], orderId, 'test-mesero')

    expect(r1.success).toBe(true)

    // Deduction must have fired exactly once — one PATCH per ingredient
    expect(patchCalls).toHaveLength(1)
    expect(patchCalls[0].newStock).toBe(9)  // stock was 10, deducted 1

    // The second call should have been short-circuited (no additional PATCH)
    // and should indicate the order was already processed
    expect(r2.deductions).toHaveLength(0)
  })

  it('TC-DD-02: concurrent double call same orderId → PATCH fires exactly once', async () => {
    // This simulates two concurrent taps (Promise.all = simultaneous start).
    // Both calls read stock=10, both compute newStock=9 — the second PATCH
    // is a silent double-deduction in the movement ledger (stock appears correct
    // but movement log shows two entries for the same order).
    const { fetchMock, patchCalls } = makeStatefulFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    const item = makeItem({ cantidad: 1 })
    const orderId = 'order-concurrent-dd-02'

    const [r1, r2] = await Promise.all([
      deductIngredientsForOrder([item], orderId, 'terminal-A'),
      deductIngredientsForOrder([item], orderId, 'terminal-B'),
    ])

    // Only one deduction should fire
    expect(patchCalls).toHaveLength(1)

    // One result must show deduction, the other must show idempotent skip
    const totalDeductions = r1.deductions.length + r2.deductions.length
    expect(totalDeductions).toBe(1)
  })

  it('TC-DD-03: different orderIds each deduct independently', async () => {
    // Control test: idempotency must NOT suppress different orders.
    const { fetchMock, patchCalls } = makeStatefulFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    const item = makeItem({ cantidad: 1 })

    await deductIngredientsForOrder([item], 'order-A', 'test-mesero')
    await deductIngredientsForOrder([item], 'order-B', 'test-mesero')

    // Two different orders → two PATCHes
    expect(patchCalls).toHaveLength(2)
    expect(patchCalls[0].newStock).toBe(9)   // stock 10 → 9
    expect(patchCalls[1].newStock).toBe(8)   // stock 9 → 8
  })

  it('TC-DD-04: split parejo — only cuenta 1 deducts, cuenta 2 produces no PATCH', async () => {
    // Verifies the shouldDeductIngredients guard for split-parejo is respected
    // downstream. This guard lives in pos/page.tsx:3212 — tested here via
    // payId differentiation convention `orderId-C1`, `orderId-C2`.
    //
    // For split-parejo, the caller passes orderId-C1 for cuenta 1 (deducts)
    // and must NOT call deductIngredientsForOrder for cuenta 2+.
    // This test verifies that if the guard fails and both accounts call
    // deductIngredientsForOrder with the same BASE orderId, only one fires.
    //
    // NOTE: payId for split is `${orderId}-C${cuenta}` so cuenta 1 and 2
    // have DIFFERENT payIds — this is a separate deduplication concern.
    // The real risk is the same account paying twice (TC-DD-01, TC-DD-02).
    const { fetchMock, patchCalls } = makeStatefulFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    const item = makeItem({ cantidad: 1 })
    const baseOrderId = 'order-split-parejo'

    // cuenta 1 deducts (correct)
    await deductIngredientsForOrder([item], `${baseOrderId}-C1`, 'test-mesero')
    // If caller guard fails and cuenta 2 also calls with same payId — must be no-op
    await deductIngredientsForOrder([item], `${baseOrderId}-C1`, 'test-mesero')

    expect(patchCalls).toHaveLength(1)
  })

  it('TC-DD-06: failed deduction is retryable — orderId not permanently blocked in Set', async () => {
    // If deductIngredientsForOrder() throws (e.g. network error on getRecipes()),
    // the outer catch must remove orderId from _deductedOrderIds so a retry can proceed.
    //
    // NOTE: updateInventoryStock() absorbs its own PATCH errors and returns false —
    // those never reach the outer catch. We trigger a real outer-catch failure by
    // making getRecipes() throw on the first call, then succeed on retry.
    let recipeCallCount = 0
    const patchCalls: number[] = []

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('pos_recipes_old')) {
        recipeCallCount++
        if (recipeCallCount === 1) return Promise.reject(new Error('Network error on first attempt'))
        return Promise.resolve({ ok: true, json: async () => [
          { menu_item_name: 'aguacate toast', ingredient_id: 'avocado-id', quantity: 1, unit: 'pz' },
        ]})
      }
      if (url.includes('pos_inventory') && !url.includes('pos_inventory_movements') && opts?.method !== 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => [
          { ingredient_id: 'avocado-id', stock: 10, reorder_point: 2 },
        ]})
      }
      if (url.includes('pos_ingredients')) {
        return Promise.resolve({ ok: true, json: async () => [
          { id: 'avocado-id', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 25, yield_factor: 1, active: true },
        ]})
      }
      if (url.includes('pos_menu_items') && url.includes('recipe_ref')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'menu-avocado', recipe_ref: 'aguacate toast' }]})
      }
      if (url.includes('pos_inventory') && opts?.method === 'PATCH') {
        patchCalls.push(1)
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    const item = makeItem({ cantidad: 1 })
    const orderId = 'order-retry-dd-06'

    // First call: getRecipes throws → outer catch fires → orderId removed from Set
    const r1 = await deductIngredientsForOrder([item], orderId, 'test-mesero')
    expect(r1.success).toBe(false)

    // Retry: orderId must not be blocked by the idempotency guard
    const r2 = await deductIngredientsForOrder([item], orderId, 'test-mesero')
    expect(r2.success).toBe(true)
    expect(r2.deductions).toHaveLength(1)
    expect(r2.deductions[0].ingredient).toBe('Aguacate')
    expect(patchCalls).toHaveLength(1)  // exactly one PATCH, from the successful retry
  })

  it('TC-DD-05: movement ledger does not log a deduction entry for the idempotent second call', async () => {
    // The movement log (pos_inventory_movements) must not contain two entries
    // for the same orderId. This would corrupt the audit trail.
    const postCalls: string[] = []

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('pos_recipes_old')) {
        return Promise.resolve({ ok: true, json: async () => [
          { menu_item_name: 'aguacate toast', ingredient_id: 'avocado-id', quantity: 1, unit: 'pz' },
        ]})
      }
      if (url.includes('pos_inventory') && !url.includes('pos_inventory_movements') && opts?.method !== 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => [
          { ingredient_id: 'avocado-id', stock: 10, reorder_point: 2 },
        ]})
      }
      if (url.includes('pos_ingredients')) {
        return Promise.resolve({ ok: true, json: async () => [
          { id: 'avocado-id', name: 'Aguacate', unit: 'pz', category: 'produce', cost_per_unit: 25, yield_factor: 1, active: true },
        ]})
      }
      if (url.includes('pos_menu_items') && url.includes('recipe_ref')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'menu-avocado', recipe_ref: 'aguacate toast' }]})
      }
      if (url.includes('pos_inventory_movements') && opts?.method === 'POST') {
        const body = JSON.parse(opts?.body as string)
        postCalls.push(body.order_id ?? 'unknown')
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    const item = makeItem({ cantidad: 1 })
    const orderId = 'order-ledger-dd-05'

    await deductIngredientsForOrder([item], orderId, 'test-mesero')
    await deductIngredientsForOrder([item], orderId, 'test-mesero')

    // Movement log must contain exactly one entry for this orderId
    const entriesForOrder = postCalls.filter(id => id === orderId)
    expect(entriesForOrder).toHaveLength(1)
  })
})
