import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InventoryPolicyService } from '@/lib/inventory-policy'

// ─── fetch mock helpers ──────────────────────────────────────────────────────

type FetchBehavior =
  | { ok: true;  rows: { menu_item_id: string; inventory_mode: string }[] }
  | { ok: false; status: number }
  | { throws: string }

function makeFetch(behaviors: FetchBehavior[]): typeof fetch {
  let call = 0
  return vi.fn().mockImplementation(async () => {
    const b = behaviors[Math.min(call++, behaviors.length - 1)]
    if ('throws' in b) throw new Error(b.throws)
    if (!b.ok) return { ok: false, status: b.status, json: async () => [] } as unknown as Response
    return { ok: true, status: 200, json: async () => b.rows } as unknown as Response
  }) as unknown as typeof fetch
}

// ─── localStorage mock ───────────────────────────────────────────────────────

function makeLocalStorage(): Storage & { _store: Record<string, string> } {
  const _store: Record<string, string> = {}
  return {
    _store,
    getItem:    (k) => _store[k] ?? null,
    setItem:    (k, v) => { _store[k] = v },
    removeItem: (k) => { delete _store[k] },
    clear:      () => { Object.keys(_store).forEach(k => delete _store[k]) },
    key:        (i) => Object.keys(_store)[i] ?? null,
    get length() { return Object.keys(_store).length },
  }
}

// ─── env / global stubs ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',      'https://test.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key')
  vi.stubGlobal('localStorage', makeLocalStorage())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROWS_A = [
  { menu_item_id: 'item-1', inventory_mode: 'recipe' },
  { menu_item_id: 'item-2', inventory_mode: 'direct_stock' },
]

const ROWS_B = [
  { menu_item_id: 'item-99', inventory_mode: 'direct_stock' },
]

// ── Helper: build a raw LKGEntry for localStorage pre-seeding ────────────────
function makeLKGEntry(
  clientId: string,
  rows: typeof ROWS_A,
  opts?: { ageMs?: number; version?: number; hash?: string }
) {
  const ageMs = opts?.ageMs ?? 0
  return JSON.stringify({
    version:  opts?.version ?? 1,
    clientId,
    rows,
    savedAt:  Date.now() - ageMs,
    hash:     opts?.hash ?? 'test-hash',
  })
}

const DAY_MS   = 24 * 60 * 60 * 1000
const WARM_MS  = 6 * DAY_MS   // < 7 days → warm
const STALE_MS = 10 * DAY_MS  // 7–30 days → stale fallback
const OLD_MS   = 31 * DAY_MS  // > 30 days → discard


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 1 — State machine
// ═══════════════════════════════════════════════════════════════════════════════

describe('State machine', () => {
  it('starts UNINITIALIZED', () => {
    const svc = new InventoryPolicyService()
    expect(svc.stats().state).toBe('UNINITIALIZED')
    expect(svc.isReady()).toBe(false)
  })

  it('reaches READY on successful remote fetch', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')
    expect(svc.stats().state).toBe('READY')
    expect(svc.isReady()).toBe(true)
    expect(svc.stats().itemCount).toBe(2)
    expect(svc.stats().source).toBe('REMOTE')
    expect(svc.stats().cacheAgeMs).toBe(0)
    expect(svc.stats().contentHash).toHaveLength(8)
  })

  it('reaches FAILED after all retries fail with no cache', async () => {
    vi.stubGlobal('fetch', makeFetch([{ throws: 'network error' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')
    expect(svc.stats().state).toBe('FAILED')
    expect(svc.stats().attempts).toBe(3)
    expect(svc.stats().failureReason).toContain('network error')
    expect(svc.stats().source).toBeNull()
  })

  it('retries on HTTP error before failing', async () => {
    vi.stubGlobal('fetch', makeFetch([
      { ok: false, status: 503 },
      { ok: false, status: 503 },
      { ok: true,  rows: ROWS_A },
    ]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')
    expect(svc.stats().state).toBe('READY')
    expect(svc.stats().attempts).toBe(3)
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — getMode
// ═══════════════════════════════════════════════════════════════════════════════

describe('getMode', () => {
  it('returns null when UNINITIALIZED', () => {
    expect(new InventoryPolicyService().getMode('item-1')).toBeNull()
  })

  it('returns null when FAILED', async () => {
    vi.stubGlobal('fetch', makeFetch([{ throws: 'err' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')
    expect(svc.getMode('item-1')).toBeNull()
  })

  it('returns mode for known item when READY', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')
    expect(svc.getMode('item-1')).toBe('recipe')
    expect(svc.getMode('item-2')).toBe('direct_stock')
    expect(svc.getMode('item-unknown')).toBeNull()
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 3 — READY state preservation (original tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('READY state preservation', () => {
  it('keeps previous READY state when re-init fails with no cache', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    vi.stubGlobal('fetch', makeFetch([{ throws: 'network down' }]))
    await svc.initialize('client-2')

    expect(svc.stats().state).toBe('READY')
    expect(svc.isReady()).toBe(true)
    expect(svc.getMode('item-1')).toBe('recipe')
    expect(svc.stats().failureReason).toContain('network down')
  })

  it('keeps previous READY state when re-init gets HTTP errors', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    vi.stubGlobal('fetch', makeFetch([{ ok: false, status: 500 }]))
    await svc.initialize('client-2')

    expect(svc.isReady()).toBe(true)
    expect(svc.getMode('item-1')).toBe('recipe')
  })

  it('replaces READY state when re-init succeeds with new client', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_B }]))
    await svc.initialize('client-2')

    expect(svc.isReady()).toBe(true)
    expect(svc.getMode('item-99')).toBe('direct_stock')
    expect(svc.getMode('item-1')).toBeNull()
  })

  it('returns early with warning for same-client mid-session re-init', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    const fetchSpy = makeFetch([{ throws: 'should not be called' }])
    vi.stubGlobal('fetch', fetchSpy)
    await svc.initialize('client-1')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(svc.isReady()).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Re-init same client mid-session'))
  })

  it('concurrent LOADING guard prevents duplicate fetches', async () => {
    let resolveFetch!: () => void
    const slowFetch = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => { resolveFetch = r })
      return { ok: true, status: 200, json: async () => ROWS_A } as unknown as Response
    })
    vi.stubGlobal('fetch', slowFetch as unknown as typeof fetch)

    const svc = new InventoryPolicyService()
    const p1 = svc.initialize('client-1')
    const p2 = svc.initialize('client-1')

    expect(svc.stats().state).toBe('LOADING')
    resolveFetch()
    await Promise.all([p1, p2])
    expect(svc.stats().state).toBe('READY')
    expect(slowFetch).toHaveBeenCalledTimes(1)
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 4 — Last-known-good (LKG) cache
// ═══════════════════════════════════════════════════════════════════════════════

describe('LKG cache — warm path (<7 days)', () => {
  it('applies warm cache immediately when remote fails — gate active, FAILED_NO_POLICY not emitted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: WARM_MS }))

    vi.stubGlobal('fetch', makeFetch([{ throws: 'no network' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    expect(svc.stats().state).toBe('READY')
    expect(svc.getMode('item-1')).toBe('recipe')
    expect(svc.stats().source).toBe('CACHED')
    expect(svc.stats().cacheAgeMs).toBeGreaterThan(0)
    expect(errorSpy).not.toHaveBeenCalled()  // FAILED_NO_POLICY must NOT fire
  })

  it('upgrades CACHED → REMOTE when remote succeeds after warm cache', async () => {
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: WARM_MS }))

    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_B }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    // Remote rows (ROWS_B) overwrite cache rows (ROWS_A)
    expect(svc.stats().source).toBe('REMOTE')
    expect(svc.stats().cacheAgeMs).toBe(0)
    expect(svc.getMode('item-99')).toBe('direct_stock')
    expect(svc.getMode('item-1')).toBeNull()
  })

  it('does not use cache from a different clientId', async () => {
    // Cache written for 'client-A', but we initialize with 'client-B'
    localStorage.setItem('lkg_policy_v1_client-A', makeLKGEntry('client-A', ROWS_A, { ageMs: WARM_MS }))

    vi.stubGlobal('fetch', makeFetch([{ throws: 'no network' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-B')

    expect(svc.stats().state).toBe('FAILED')
    expect(svc.getMode('item-1')).toBeNull()
  })

  it('discards cache entry whose version does not match', async () => {
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: WARM_MS, version: 0 as unknown as 1 }))

    vi.stubGlobal('fetch', makeFetch([{ throws: 'no network' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    expect(svc.stats().state).toBe('FAILED')
  })

  it('persists LKG to localStorage after successful remote fetch', async () => {
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    const raw = localStorage.getItem('lkg_policy_v1_client-1')
    expect(raw).not.toBeNull()
    const entry = JSON.parse(raw!)
    expect(entry.version).toBe(1)
    expect(entry.clientId).toBe('client-1')
    expect(entry.rows).toEqual(ROWS_A)
    expect(entry.hash).toHaveLength(8)
    expect(entry.savedAt).toBeGreaterThan(0)
  })
})

describe('LKG cache — stale path (7–30 days)', () => {
  it('uses stale cache as emergency fallback when remote fails', async () => {
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: STALE_MS }))

    vi.stubGlobal('fetch', makeFetch([{ throws: 'no network' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    expect(svc.stats().state).toBe('READY')
    expect(svc.getMode('item-1')).toBe('recipe')
    expect(svc.stats().source).toBe('CACHED')
  })

  it('does NOT apply stale cache before remote attempt — no early READY', async () => {
    // Stale entry exists; remote succeeds with fresh data
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: STALE_MS }))

    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_B }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    // Remote data wins — stale cache was never promoted before the fetch
    expect(svc.getMode('item-99')).toBe('direct_stock')
    expect(svc.getMode('item-1')).toBeNull()
    expect(svc.stats().source).toBe('REMOTE')
  })
})

describe('LKG cache — discard path (>30 days)', () => {
  it('ignores cache older than 30 days', async () => {
    localStorage.setItem('lkg_policy_v1_client-1', makeLKGEntry('client-1', ROWS_A, { ageMs: OLD_MS }))

    vi.stubGlobal('fetch', makeFetch([{ throws: 'no network' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    expect(svc.stats().state).toBe('FAILED')
    expect(svc.getMode('item-1')).toBeNull()
  })
})

describe('FAILED_NO_POLICY telemetry', () => {
  it('emits console.error with FAILED_NO_POLICY when no remote and no valid cache', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal('fetch', makeFetch([{ throws: 'timeout' }]))
    const svc = new InventoryPolicyService()
    await svc.initialize('client-1')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('FAILED_NO_POLICY'),
    )
    expect(svc.stats().state).toBe('FAILED')
  })
})

describe('LKG cache — terminal restart flow (Test 7)', () => {
  it('READY_REMOTE → restart → READY_CACHED → remote refresh → READY_REMOTE with updated map', async () => {
    // Session 1: remote fetch succeeds, writes LKG
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_A }]))
    const svc1 = new InventoryPolicyService()
    await svc1.initialize('client-1')
    expect(svc1.stats().source).toBe('REMOTE')

    // Verify LKG was written
    expect(localStorage.getItem('lkg_policy_v1_client-1')).not.toBeNull()

    // Session 2 (new service instance = terminal restart): warm cache loaded first
    vi.stubGlobal('fetch', makeFetch([{ ok: true, rows: ROWS_B }]))  // remote returns updated rows
    const svc2 = new InventoryPolicyService()
    await svc2.initialize('client-1')

    // Remote data must overwrite the cached version — map reflects ROWS_B, not ROWS_A
    expect(svc2.stats().source).toBe('REMOTE')
    expect(svc2.getMode('item-99')).toBe('direct_stock')  // from ROWS_B
    expect(svc2.getMode('item-1')).toBeNull()             // was in ROWS_A, not in ROWS_B

    // LKG was updated to new content
    const entry = JSON.parse(localStorage.getItem('lkg_policy_v1_client-1')!)
    expect(entry.rows).toEqual(ROWS_B)
  })
})
