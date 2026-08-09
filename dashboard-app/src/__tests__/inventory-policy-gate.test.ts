import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── W1-A — el gate de policy en Sistema A fue retirado junto con Sistema A ──
//
// Este archivo probaba que deductIngredientsForOrder respetara el gate de
// pos_item_inventory_policy (READY / no-READY, modo recipe vs unclassified).
// Con W1-A ese gate cliente desapareció: la policy la resuelve y PINNEA
// r1_reconcile_item server-side (fail-closed: unclassified → BLOCKED_UNCLASSIFIED,
// visible en inventory_status del save). El servicio de policy en sí se sigue
// probando en inventory-policy.test.ts (LKG cache, hash, estados).
//
// Aquí queda el invariante post-retiro: el stub NO consulta la policy, NO llama
// telemetría de gate y NO toca la red, en ningún estado de policy.

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

const { mockIsReady, mockGetMode, mockStats, mockLogPolicyGateFailure } = vi.hoisted(() => ({
  mockIsReady: vi.fn(),
  mockGetMode: vi.fn(),
  mockStats: vi.fn(),
  mockLogPolicyGateFailure: vi.fn(),
}))

vi.mock('@/lib/inventory-policy', () => ({
  inventoryPolicyService: {
    isReady: mockIsReady,
    getMode: mockGetMode,
    stats: mockStats,
  },
  logPolicyGateFailure: mockLogPolicyGateFailure,
  InventoryPolicyService: class {},
}))

import { deductIngredientsForOrder, type OrderItem } from '@/lib/pos-data'

const item: OrderItem = {
  id: 'i1', menuItemId: 'menu-1', nombre: 'Chilaquiles', precio: 185,
  cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 185,
} as OrderItem

describe('W1-A — stub no consulta policy ni red, en ningún estado', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    store['fullsite_client_id'] = 'test-client'
    fetchSpy = vi.fn(() => { throw new Error('W1-A violation: network call from retired stub') })
    vi.stubGlobal('fetch', fetchSpy)
  })

  it('policy READY: no llama isReady/getMode ni fetch — todo es R1_OWNED', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetMode.mockReturnValue('recipe')
    const r = await deductIngredientsForOrder([item], 'o-ready', 'Mesero')
    expect(r.success).toBe(true)
    expect(r.resolution.R1_OWNED).toEqual(['Chilaquiles'])
    expect(mockIsReady).not.toHaveBeenCalled()
    expect(mockGetMode).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('policy no disponible: tampoco registra policy_gate_failure ni bloquea', async () => {
    mockIsReady.mockReturnValue(false)
    mockStats.mockReturnValue({ state: 'FAILED' })
    const r = await deductIngredientsForOrder([item], 'o-failed', 'Mesero')
    expect(r.success).toBe(true)
    expect(r.resolution.GATE_FAILED).toHaveLength(0)
    expect(mockLogPolicyGateFailure).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
