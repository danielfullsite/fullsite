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
const serverResult = (status: 'COMPLETE' | 'BLOCKED' | 'PENDING') => ({ ok: true, json: async () => ({ inventory_status: status, inventory_pending: status !== 'COMPLETE' }) })

beforeEach(() => {
  vi.resetAllMocks()
  mockStats.mockReturnValue({ state: 'READY' })
})

describe('sale reconciliation delegates ownership to the server', () => {
  it('a READY browser policy cannot split the order between local and R1 writers', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetMode.mockImplementation((id: string) => id === 'item-latte' ? 'recipe' : null)
    mockFetch.mockResolvedValue(serverResult('COMPLETE'))
    const result = await deductIngredientsForOrder([recipeItem, nonRecipeItem], 'pay-001', 'Omar')
    expect(result).toMatchObject({ success: true, inventory_status: 'COMPLETE', deductions: [] })
    expect(Object.values(result.resolution).flat()).toEqual([])
    expect(mockIsReady).not.toHaveBeenCalled()
    expect(mockGetMode).not.toHaveBeenCalled()
    expect(mockLogPolicyGateFailure).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/pos/inventory/reconcile')
    expect(JSON.parse(options.body)).toEqual({ order_id: 'pay-001' })
  })

  it('a missing browser policy still asks the canonical server and cannot claim pending inventory succeeded', async () => {
    mockIsReady.mockReturnValue(false)
    mockStats.mockReturnValue({ state: 'FAILED' })
    mockFetch.mockResolvedValue(serverResult('PENDING'))
    const result = await deductIngredientsForOrder([recipeItem, nonRecipeItem], 'pay-002', 'Omar')
    expect(result).toMatchObject({ success: false, inventory_status: 'PENDING', deductions: [] })
    expect(result.alerts.length).toBeGreaterThan(0)
    expect(result.resolution.GATE_FAILED).toEqual([])
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockStats).not.toHaveBeenCalled()
  })

  it('BLOCKED remains blocked without browser fallback, reclassification, or ownership telemetry', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetMode.mockReturnValue('recipe')
    mockFetch.mockResolvedValue(serverResult('BLOCKED'))
    const result = await deductIngredientsForOrder([recipeItem], 'pay-003', 'Omar')
    expect(result.success).toBe(false)
    expect(result.inventory_status).toBe('BLOCKED')
    expect(result.alerts.length).toBeGreaterThan(0)
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockLogPolicyGateFailure).not.toHaveBeenCalled()
    expect(mockGetMode).not.toHaveBeenCalled()
  })
})

describe('independent policy telemetry', () => {
  it('fallo de telemetría: el flujo no lanza ni bloquea', async () => {
    const { logPolicyGateFailure: realFn } =
      await vi.importActual<typeof import('@/lib/inventory-policy')>('@/lib/inventory-policy')

    mockFetch.mockRejectedValue(new Error('network refused'))

    expect(() => realFn('amalay', 'pay-004', 'FAILED', 'test')).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
  })
})
