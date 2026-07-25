import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPosMesas } from '@/lib/pos-data'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(rows: unknown[], ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, json: async () => rows }),
  )
}

const SAMPLE_ROWS = [
  { number: 1,  capacity: 4, zone: 'Entrada',  x_pct: 22.00, y_pct: 9.00,  shape: 'round',   sort_order: 0 },
  { number: 2,  capacity: 4, zone: 'Entrada',  x_pct: 30.00, y_pct: 9.00,  shape: 'round',   sort_order: 1 },
  { number: 30, capacity: 8, zone: 'Terraza',  x_pct: 45.00, y_pct: 47.00, shape: 'round-lg', sort_order: 2 },
]

// ─── fetchPosMesas ────────────────────────────────────────────────────────────

describe('fetchPosMesas', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.restoreAllMocks())

  it('returns rows from DB when response is ok', async () => {
    mockFetch(SAMPLE_ROWS)
    const result = await fetchPosMesas('amalay')
    expect(result).toHaveLength(3)
    expect(result[0].number).toBe(1)
    expect(result[0].zone).toBe('Entrada')
    expect(result[2].capacity).toBe(8)
    expect(result[2].shape).toBe('round-lg')
  })

  it('returns [] when HTTP response is not ok', async () => {
    mockFetch([], false)
    const result = await fetchPosMesas('amalay')
    expect(result).toEqual([])
  })

  it('returns [] on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const result = await fetchPosMesas('amalay')
    expect(result).toEqual([])
  })

  it('returns [] for empty table (no rows yet seeded)', async () => {
    mockFetch([])
    const result = await fetchPosMesas('other-client')
    expect(result).toEqual([])
  })

  it('builds correct query URL with client_id and active filter', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchPosMesas('amalay')
    const url: string = fetchSpy.mock.calls[0][0]
    expect(url).toContain('pos_mesas')
    expect(url).toContain('client_id=eq.amalay')
    expect(url).toContain('active=eq.true')
    expect(url).toContain('order=sort_order.asc')
  })

  it('preserves numeric x_pct/y_pct from DB response', async () => {
    mockFetch([{ number: 41, capacity: 6, zone: 'Terraza', x_pct: 36.50, y_pct: 59.00, shape: 'rect-h', sort_order: 18 }])
    const result = await fetchPosMesas('amalay')
    expect(result[0].x_pct).toBe(36.5)
    expect(result[0].y_pct).toBe(59)
  })

  it('handles null zone (non-AMALAY client)', async () => {
    mockFetch([{ number: 1, capacity: 4, zone: null, x_pct: 10, y_pct: 10, shape: 'round', sort_order: 0 }])
    const result = await fetchPosMesas('other-client')
    expect(result[0].zone).toBeNull()
  })
})
