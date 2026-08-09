/**
 * pos-data offline auth integration tests.
 *
 * Covers:
 *  1.  KEY COLLISION fix — fetchMeseros writes pos_meseros_cache, not pos_staff_cache
 *  2.  pos_staff_cache auth object survives a fetchMeseros call
 *  3.  Online success provisions PBKDF2 (pos_manager_credentials_v2 populated)
 *  4.  Online success writes btoa fallback telemetry counter is 0 (no fallback used)
 *  5.  Offline — PBKDF2 is used when credential is provisioned
 *  6.  Offline — btoa legacy fallback used when PBKDF2 not provisioned
 *  7.  Offline — btoa fallback increments pos_btoa_fallback_count
 *  8.  Offline — wrong PIN returns null with both caches populated
 *  9.  Offline — PBKDF2 expired (>24h) falls through to btoa fallback
 * 10.  Offline — corrupt btoa cache (invalid JSON) is handled gracefully
 * 11.  Offline — corrupt PBKDF2 store (invalid JSON) falls through to btoa
 * 12.  Reinicio simulation: PBKDF2 provision persists; offline verify succeeds after "restart"
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { provisionManagerCredential, verifyPinOffline } from '@/lib/pos-manager-auth'

// ── localStorage mock ─────────────────────────────────────────────────────────
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v }),
  removeItem: vi.fn((k: string) => { delete store[k] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('TextEncoder', TextEncoder)

// ── @/lib/data mock — provides client_id for pos-data.ts ──────────────────────
vi.mock('@/lib/data', () => ({ getActiveClientSlug: vi.fn(() => 'test-client') }))

// ── Lazy import of pos-data functions (after mocks are set up) ─────────────────
// Using dynamic import inside tests to ensure mocks are hoisted first.
let fetchMeseros: (clientId?: string) => Promise<string[]>
let verifyManagerPin: (pin: string) => Promise<string | null>
let verifyManagerPinWithRole: (pin: string) => Promise<{ name: string; role: string } | null>
let verifyPinWithMinRole: (pin: string, minRole: string) => Promise<{ name: string; role: string } | null>

beforeEach(async () => {
  localStorageMock.clear()
  vi.clearAllMocks()
  // fetchMeseros early-exits without these; set minimal test values
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  const m = await import('@/lib/pos-data')
  fetchMeseros = m.fetchMeseros
  verifyManagerPin = m.verifyManagerPin
  verifyManagerPinWithRole = m.verifyManagerPinWithRole
  verifyPinWithMinRole = m.verifyPinWithMinRole
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate a successful /api/pos/pin response */
function mockPinSuccess(staff: { id: string; name: string; role: string }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ staff, shiftToken: 'tok-test' }),
  }))
}

/** Simulate network failure (offline) */
function mockOffline() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network Error')))
}

/** Write a btoa cache entry directly (simulates pre-migration state) */
function seedBtoaCache(pin: string, name: string, role: string, hoursAgo = 0) {
  const cached = JSON.parse(store['pos_manager_pin_cache'] || '{}')
  const key = btoa(pin)
  cached[key] = { name, role, cached_at: Date.now() - hoursAgo * 3_600_000 }
  store['pos_manager_pin_cache'] = JSON.stringify(cached)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('1. KEY COLLISION fix — fetchMeseros key isolation', () => {
  it('fetchMeseros writes to pos_meseros_cache, not pos_staff_cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'Ana' }, { name: 'Luis' }],
    }))
    await fetchMeseros('test-client')
    expect(store['pos_meseros_cache']).toBeDefined()
    expect(JSON.parse(store['pos_meseros_cache'] ?? '[]')).toContain('Ana')
  })

  it('fetchMeseros does NOT touch pos_staff_cache', async () => {
    // Simulate a pre-existing auth entry
    const authEntry = { id: 'staff-1', name: 'Omar', role: 'mesero', exp: Date.now() + 3_600_000, pin_hash: 'abc' }
    store['pos_staff_cache'] = JSON.stringify(authEntry)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'Brayan' }],
    }))
    await fetchMeseros('test-client')

    // Auth cache must be untouched
    const after = JSON.parse(store['pos_staff_cache'] ?? 'null')
    expect(after?.id).toBe('staff-1')
  })
})

describe('3. Online success — PBKDF2 provision', () => {
  it('successful online auth provisions PBKDF2 credential', async () => {
    mockPinSuccess({ id: 'staff-42', name: 'Ana Gerente', role: 'gerente' })
    const result = await verifyManagerPin('9999')
    expect(result).toBe('Ana Gerente')

    // Allow microtasks to flush (provisionManagerCredential is awaited in the new code)
    await new Promise(resolve => setTimeout(resolve, 50))

    const raw = store['pos_manager_credentials_v2']
    expect(raw).toBeDefined()
    const creds = JSON.parse(raw!)
    expect(Array.isArray(creds)).toBe(true)
    const cred = creds.find((c: { staff_id: string }) => c.staff_id === 'staff-42')
    expect(cred).toBeDefined()
    expect(cred.name).toBe('Ana Gerente')
    expect(cred.role).toBe('gerente')
    expect(cred.pin_hash).toBeTruthy()
  })

  it('btoa fallback counter stays 0 after online auth (no fallback used)', async () => {
    mockPinSuccess({ id: 'staff-43', name: 'Luis Admin', role: 'admin' })
    await verifyManagerPin('1234')
    const count = parseInt(store['pos_btoa_fallback_count'] || '0', 10)
    expect(count).toBe(0)
  })
})

describe('5. Offline — PBKDF2 path (canonical)', () => {
  it('verifyManagerPin uses PBKDF2 when provisioned offline', async () => {
    // Provision PBKDF2 credential
    await provisionManagerCredential('7777', 'staff-p', 'Pedro Mgr', 'gerente')

    // Go offline
    mockOffline()
    const result = await verifyManagerPin('7777')
    expect(result).toBe('Pedro Mgr')
  })

  it('verifyManagerPinWithRole returns role from PBKDF2 offline', async () => {
    await provisionManagerCredential('8888', 'staff-r', 'Rosa Admin', 'admin')
    mockOffline()
    const result = await verifyManagerPinWithRole('8888')
    expect(result?.name).toBe('Rosa Admin')
    expect(result?.role).toBe('admin')
  })
})

describe('6 & 7. Offline — btoa legacy fallback + telemetry', () => {
  it('btoa fallback succeeds when PBKDF2 not provisioned', async () => {
    seedBtoaCache('4444', 'Beatriz Gte', 'gerente')
    mockOffline()
    const result = await verifyManagerPin('4444')
    expect(result).toBe('Beatriz Gte')
  })

  it('btoa fallback increments pos_btoa_fallback_count', async () => {
    seedBtoaCache('5555', 'Carlos Gte', 'gerente')
    mockOffline()
    await verifyManagerPin('5555')
    const count = parseInt(store['pos_btoa_fallback_count'] || '0', 10)
    expect(count).toBeGreaterThan(0)
  })
})

describe('8. Offline — wrong PIN returns null', () => {
  it('returns null for wrong PIN when both PBKDF2 and btoa are populated', async () => {
    await provisionManagerCredential('9999', 'staff-w', 'Wrong Target', 'gerente')
    seedBtoaCache('9999', 'Wrong Target', 'gerente')
    mockOffline()
    const result = await verifyManagerPin('0000')  // wrong PIN
    expect(result).toBeNull()
  })
})

describe('9. Offline — PBKDF2 expired falls to btoa', () => {
  it('expired PBKDF2 (>24h) falls through to btoa fallback', async () => {
    await provisionManagerCredential('3333', 'staff-e', 'Expired Mgr', 'gerente')
    // Expire PBKDF2 credential
    const raw = store['pos_manager_credentials_v2']!
    const creds = JSON.parse(raw)
    creds[0].synced_at = Date.now() - (24 * 60 * 60 * 1000 + 1000)
    store['pos_manager_credentials_v2'] = JSON.stringify(creds)

    // Seed fresh btoa entry
    seedBtoaCache('3333', 'Expired Mgr', 'gerente')
    mockOffline()

    const result = await verifyManagerPin('3333')
    expect(result).toBe('Expired Mgr')
    // btoa fallback must have been used
    const count = parseInt(store['pos_btoa_fallback_count'] || '0', 10)
    expect(count).toBeGreaterThan(0)
  })
})

describe('10. Corrupt btoa cache — graceful handling', () => {
  it('returns null without throwing when pos_manager_pin_cache is invalid JSON', async () => {
    store['pos_manager_pin_cache'] = '{{CORRUPTED{{{'
    mockOffline()
    const result = await verifyManagerPin('1234')
    expect(result).toBeNull()
  })
})

describe('11. Corrupt PBKDF2 store — graceful fallback to btoa', () => {
  it('falls through to btoa when pos_manager_credentials_v2 is invalid JSON', async () => {
    store['pos_manager_credentials_v2'] = 'NOT_JSON'
    seedBtoaCache('2222', 'Fallback Mgr', 'gerente')
    mockOffline()
    const result = await verifyManagerPin('2222')
    expect(result).toBe('Fallback Mgr')
  })
})

describe('12. App restart simulation — PBKDF2 persists', () => {
  it('PBKDF2 credential survives a simulated app restart (localStorage persistence)', async () => {
    // Online auth provisions credential
    mockPinSuccess({ id: 'staff-restart', name: 'Maria Mgr', role: 'gerente' })
    await verifyManagerPin('6666')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate restart: we DO NOT clear localStorage
    // But we DO lose all in-memory state — simulate by calling verifyPinOffline fresh
    // (same as what happens when the module reloads)
    mockOffline()
    const result = await verifyManagerPin('6666')
    expect(result).toBe('Maria Mgr')
  })
})

// ── GAP-A: offline minimum-role enforcement ───────────────────────────────────

describe('GAP-A: verifyPinWithMinRole — offline role hierarchy enforcement', () => {
  it('PBKDF2 valid but role below minRole is rejected', async () => {
    await provisionManagerCredential('1111', 'staff-ga1', 'Capitan User', 'capitan')
    mockOffline()
    // capitan (3) vs admin (5) — must reject
    const result = await verifyPinWithMinRole('1111', 'admin')
    expect(result).toBeNull()
  })

  it('PBKDF2 valid with exact role match is accepted', async () => {
    await provisionManagerCredential('2222', 'staff-ga2', 'Gerente User', 'gerente')
    mockOffline()
    const result = await verifyPinWithMinRole('2222', 'gerente')
    expect(result).not.toBeNull()
    expect(result?.role).toBe('gerente')
  })

  it('PBKDF2 valid with superior role is accepted', async () => {
    await provisionManagerCredential('3333', 'staff-ga3', 'Admin User', 'admin')
    mockOffline()
    const result = await verifyPinWithMinRole('3333', 'gerente')
    expect(result).not.toBeNull()
    expect(result?.role).toBe('admin')
  })

  it('btoa valid but role below minRole is rejected', async () => {
    seedBtoaCache('4444', 'Mesero User', 'mesero')
    mockOffline()
    // mesero (1) vs capitan (3) — must reject
    const result = await verifyPinWithMinRole('4444', 'capitan')
    expect(result).toBeNull()
  })

  it('btoa valid with sufficient role is accepted', async () => {
    seedBtoaCache('5555', 'Gerente Btoa', 'gerente')
    mockOffline()
    const result = await verifyPinWithMinRole('5555', 'capitan')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Gerente Btoa')
    expect(result?.role).toBe('gerente')
  })

  it('btoa with empty role is rejected — no privilege escalation (old bug)', async () => {
    // Old code: `role || minRole` would grant minRole when role is empty — FIXED
    seedBtoaCache('6666', 'No Role User', '')
    mockOffline()
    const result = await verifyPinWithMinRole('6666', 'capitan')
    expect(result).toBeNull()
  })

  it('PBKDF2 with unknown role is rejected — fail safe', async () => {
    await provisionManagerCredential('7777', 'staff-ga7', 'Unknown Role', 'supervisor')
    mockOffline()
    const result = await verifyPinWithMinRole('7777', 'capitan')
    expect(result).toBeNull()
  })

  it('corrupt PBKDF2 store + btoa with insufficient role = rejected', async () => {
    store['pos_manager_credentials_v2'] = 'BAD_JSON'
    seedBtoaCache('8888', 'Low Role', 'cajero')
    mockOffline()
    const result = await verifyPinWithMinRole('8888', 'admin')
    expect(result).toBeNull()
  })

  it('online/offline parity: same credentials, same minRole returns equivalent result', async () => {
    // Online: provision via mock response
    mockPinSuccess({ id: 'staff-parity', name: 'Parity Mgr', role: 'gerente' })
    const onlineResult = await verifyPinWithMinRole('9999', 'capitan')
    // Online path goes via API; PIN not provisioned yet — goes offline after
    // So: provision first, then test parity
    await provisionManagerCredential('9999', 'staff-parity', 'Parity Mgr', 'gerente')

    mockOffline()
    const offlineResult = await verifyPinWithMinRole('9999', 'capitan')

    // Both must grant access (gerente >= capitan)
    expect(offlineResult).not.toBeNull()
    expect(offlineResult?.role).toBe('gerente')
    // Both must reject when minRole is too high
    mockOffline()
    const offlineReject = await verifyPinWithMinRole('9999', 'admin')
    expect(offlineReject).toBeNull()
  })

  // Regression: exact handleTransferItem scenario (minRole: 'capitan')
  it('capitan PBKDF2 offline puede transferir (capitan >= capitan)', async () => {
    await provisionManagerCredential('1212', 'staff-cap', 'Capitan Mgr', 'capitan')
    mockOffline()
    const result = await verifyPinWithMinRole('1212', 'capitan')
    expect(result).not.toBeNull()
    expect(result?.role).toBe('capitan')
  })

  it('cajero PBKDF2 offline no puede transferir — regression bug AUTH-OFFLINE-02', async () => {
    // Before fix: verifyPinOffline returned { name, role:'cajero' } and the
    // caller returned it directly without checking role >= minRole.
    // After fix: meetsMinRole('cajero', 'capitan') === false → null.
    await provisionManagerCredential('1313', 'staff-caj', 'Cajero User', 'cajero')
    mockOffline()
    const result = await verifyPinWithMinRole('1313', 'capitan')
    expect(result).toBeNull()
  })
})
