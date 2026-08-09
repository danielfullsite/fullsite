import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── W1-A — autoridad única de depleción ─────────────────────────────────────
//
// Este archivo protegía el guard de doble-deducción de Sistema A (Set de sesión
// _deductedOrderIds). Sistema A fue RETIRADO en W1-A: la depleción por venta la
// ejecuta exclusivamente r1_reconcile_order / r1_reconcile_item (server-side,
// dentro de /api/pos/save-order), con idempotencia a nivel BD:
//   - pos_reconciliation_results con FOR UPDATE + delta por revisión
//   - save_operation_id (r1_save_order_idempotent) + lineage
//     last_inventory_processed_revision para replay/catch-up.
//
// El invariante exactamente-una-vez vive ahora en Postgres y se certifica con
// escenarios SQL sobre staging (certificación W1-A). Lo que este archivo
// garantiza post-retiro es el invariante CLIENTE:
//
//   NINGUNA función client-side de depleción/reversa toca la red ni escribe
//   inventario — bajo llamadas secuenciales, concurrentes o repetidas.

// ─── localStorage mock (needed for _getClientId()) ───────────────────────────
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)

import {
  deductIngredientsForOrder,
  reverseIngredientDeduction,
  deductMarketStockForOrder,
  type OrderItem,
} from '@/lib/pos-data'

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1', menuItemId: 'menu-avocado', nombre: 'Aguacate Toast',
    precio: 120, cantidad: 1, modificadores: [], notas: '',
    precioExtra: 0, subtotal: 120, ...overrides,
  }
}

describe('W1-A — Sistema A retirado: stubs inertes, cero escrituras client-side', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorageMock.clear()
    store['fullsite_client_id'] = 'test-client'
    fetchSpy = vi.fn(() => {
      throw new Error('W1-A violation: client-side depletion attempted a network call')
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  it('TC-DD-01: llamada secuencial doble → cero fetch, todos los items R1_OWNED', async () => {
    const r1 = await deductIngredientsForOrder([makeItem()], 'order-1', 'Mesero')
    const r2 = await deductIngredientsForOrder([makeItem()], 'order-1', 'Mesero')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r1.success).toBe(true)
    expect(r1.deductions).toHaveLength(0)
    expect(r1.resolution.R1_OWNED).toEqual(['Aguacate Toast'])
    expect(r1.resolution.FUZZY_FALLBACK).toHaveLength(0)
    expect(r2.deductions).toHaveLength(0)
  })

  it('TC-DD-02: llamadas concurrentes mismo orderId → cero fetch', async () => {
    const [a, b] = await Promise.all([
      deductIngredientsForOrder([makeItem()], 'order-2', 'Mesero'),
      deductIngredientsForOrder([makeItem()], 'order-2', 'Mesero'),
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(a.deductions).toHaveLength(0)
    expect(b.deductions).toHaveLength(0)
  })

  it('TC-DD-03: orderIds distintos → igualmente inertes (sin estado de sesión)', async () => {
    await deductIngredientsForOrder([makeItem()], 'order-3a', 'Mesero')
    await deductIngredientsForOrder([makeItem()], 'order-3b', 'Mesero')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('TC-DD-04: la reversa client-side es inerte — R1 emite recipe_reversal en el re-save', async () => {
    await expect(
      reverseIngredientDeduction(makeItem(), 'order-4', 'Gerente', 'cliente cambió de opinión'),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('TC-DD-05: la ruta Market legacy es inerte — direct_stock lo descuenta R1', async () => {
    const r = await deductMarketStockForOrder([makeItem({ menuItemId: 'mkt-agua-1' })], 'order-5', 'Cajero')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ success: true, deductions: [], alerts: [] })
  })

  it('TC-DD-06: batchId (envío parcial) no altera el no-op', async () => {
    const r = await deductIngredientsForOrder([makeItem()], 'order-6', 'Mesero', 'batch-2')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
    expect(r.deductions).toHaveLength(0)
  })
})
