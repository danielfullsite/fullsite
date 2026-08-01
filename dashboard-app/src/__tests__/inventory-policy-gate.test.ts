import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock inventory-policy BEFORE importing pos-data ──────────────────────────
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

// ── Global stubs ──────────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('performance', { now: vi.fn(() => 0) })
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})

// ── Import after mocks ────────────────────────────────────────────────────────
import { deductIngredientsForOrder } from '@/lib/pos-data'

// ── Test helpers ──────────────────────────────────────────────────────────────
const makeItem = (menuItemId: string, nombre: string) => ({
  id: `${menuItemId}-order-item`,
  menuItemId,
  nombre,
  precio: 80,
  cantidad: 1,
  precioExtra: 0,
  subtotal: 80,
  modificadores: [],
  notas: '',
})
const recipeItem   = makeItem('item-latte', 'Café Latte')
const nonRecipeItem = makeItem('item-croissant', 'Croissant')
const okEmpty = () => ({ ok: true, json: () => Promise.resolve([]) })

beforeEach(() => {
  vi.resetAllMocks()
  mockStats.mockReturnValue({ state: 'READY' })
})

describe('inventory gate in deductIngredientsForOrder', () => {
  it('política READY: filtra recipe y permite Sistema A solo para no-recipe', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetMode.mockImplementation((id: string) =>
      id === 'item-latte' ? 'recipe' : null
    )
    mockFetch.mockResolvedValue(okEmpty())

    const result = await deductIngredientsForOrder(
      [recipeItem, nonRecipeItem], 'pay-001', 'Omar'
    )

    expect(result.resolution.R1_OWNED).toContain('Café Latte')
    expect(result.resolution.R1_OWNED).not.toContain('Croissant')
    expect(mockLogPolicyGateFailure).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalled()
  })

  it('política no disponible: no llama Sistema A', async () => {
    mockIsReady.mockReturnValue(false)
    mockStats.mockReturnValue({ state: 'FAILED' })

    const result = await deductIngredientsForOrder(
      [recipeItem, nonRecipeItem], 'pay-002', 'Omar'
    )

    expect(result).toMatchObject({ success: true, deductions: [], alerts: [] })
    expect(result.resolution.GATE_FAILED).toHaveLength(2)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('política no disponible: intenta registrar policy_gate_failure', async () => {
    mockIsReady.mockReturnValue(false)
    mockStats.mockReturnValue({ state: 'FAILED' })

    await deductIngredientsForOrder([recipeItem], 'pay-003', 'Omar')

    expect(mockLogPolicyGateFailure).toHaveBeenCalledOnce()
    expect(mockLogPolicyGateFailure).toHaveBeenCalledWith(
      expect.any(String),
      'pay-003',
      'FAILED',
      'Omar',
    )
  })

  it('fallo de telemetría: el flujo no lanza ni bloquea', async () => {
    const { logPolicyGateFailure: realFn } =
      await vi.importActual<typeof import('@/lib/inventory-policy')>('@/lib/inventory-policy')

    mockFetch.mockRejectedValue(new Error('network refused'))

    expect(() => realFn('amalay', 'pay-004', 'FAILED', 'test')).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
  })
})
