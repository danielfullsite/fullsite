import { describe, it, expect, vi, beforeEach } from 'vitest'

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
