import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v }),
  removeItem: vi.fn((k: string) => { delete store[k] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
}
vi.stubGlobal('localStorage', localStorageMock)

// WebCrypto is available in Node 20+ but needs TextEncoder
vi.stubGlobal('TextEncoder', TextEncoder)

import {
  hashPin,
  provisionManagerCredential,
  verifyPinOffline,
  revokeManagerCredential,
  pruneStaleCredentials,
  listCachedManagers,
  getPendingOfflineAuthLog,
  markOfflineAuthLogSynced,
  meetsMinRole,
  ROLE_HIERARCHY,
} from '@/lib/pos-manager-auth'

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
})

describe('hashPin', () => {
  it('returns a non-empty base64 string', async () => {
    const hash = await hashPin('1234')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(10)
  })

  it('same PIN produces same hash on same device (same salt)', async () => {
    const h1 = await hashPin('5678')
    const h2 = await hashPin('5678')
    expect(h1).toBe(h2)
  })

  it('different PINs produce different hashes', async () => {
    const h1 = await hashPin('1234')
    const h2 = await hashPin('5678')
    expect(h1).not.toBe(h2)
  })
})

describe('provisionManagerCredential + verifyPinOffline', () => {
  it('verify succeeds after provisioning', async () => {
    await provisionManagerCredential('9999', 'staff-1', 'Ana Gerente', 'gerente')
    const result = await verifyPinOffline('9999')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Ana Gerente')
    expect(result?.role).toBe('gerente')
  })

  it('wrong PIN returns null', async () => {
    await provisionManagerCredential('9999', 'staff-1', 'Ana Gerente', 'gerente')
    const result = await verifyPinOffline('0000')
    expect(result).toBeNull()
  })

  it('provision overwrites existing credential for same staff_id', async () => {
    await provisionManagerCredential('1111', 'staff-1', 'Ana Gerente', 'gerente')
    await provisionManagerCredential('2222', 'staff-1', 'Ana Gerente', 'gerente')
    expect(await verifyPinOffline('1111')).toBeNull()
    expect(await verifyPinOffline('2222')).not.toBeNull()
  })

  it('multiple credentials — each verifies with its own PIN', async () => {
    await provisionManagerCredential('1111', 'staff-1', 'Ana', 'gerente')
    await provisionManagerCredential('2222', 'staff-2', 'Luis', 'supervisor')
    expect((await verifyPinOffline('1111'))?.name).toBe('Ana')
    expect((await verifyPinOffline('2222'))?.name).toBe('Luis')
  })
})

describe('TTL expiration', () => {
  it('expired credential is rejected', async () => {
    // Provision as if 25 hours ago (past the 24h TTL)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() - 25 * 60 * 60 * 1000))
    await provisionManagerCredential('1234', 'staff-exp', 'Old Manager', 'gerente')
    vi.useRealTimers()

    const result = await verifyPinOffline('1234')
    expect(result).toBeNull()
  })

  it('fresh credential within TTL is accepted', async () => {
    await provisionManagerCredential('4321', 'staff-fresh', 'Fresh Manager', 'gerente')
    const result = await verifyPinOffline('4321')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Fresh Manager')
  })
})

describe('revokeManagerCredential', () => {
  it('revoked credential is rejected immediately', async () => {
    await provisionManagerCredential('7777', 'staff-r', 'Revoked User', 'gerente')
    revokeManagerCredential('staff-r')
    const result = await verifyPinOffline('7777')
    expect(result).toBeNull()
  })
})

describe('pruneStaleCredentials', () => {
  it('removes expired and disabled credentials', async () => {
    await provisionManagerCredential('1234', 'staff-fresh', 'Fresh', 'gerente')
    await provisionManagerCredential('5678', 'staff-stale', 'Stale', 'gerente')
    // Expire the stale one
    const raw = localStorage.getItem('pos_manager_credentials_v2')!
    const creds = JSON.parse(raw)
    const staleIdx = creds.findIndex((c: { staff_id: string }) => c.staff_id === 'staff-stale')
    creds[staleIdx].synced_at = Date.now() - 25 * 60 * 60 * 1000  // 25h > 24h TTL
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify(creds))

    pruneStaleCredentials()
    const managers = listCachedManagers()
    expect(managers.map(m => m.staff_id)).not.toContain('staff-stale')
    expect(managers.map(m => m.staff_id)).toContain('staff-fresh')
  })
})

describe('TTL — 24h boundary', () => {
  it('credential at 23h 59m 59s is still accepted', async () => {
    await provisionManagerCredential('5555', 'staff-ttl', 'Fresh Manager', 'gerente')
    const raw = localStorage.getItem('pos_manager_credentials_v2')!
    const creds = JSON.parse(raw)
    creds[0].synced_at = Date.now() - (24 * 60 * 60 * 1000 - 1000) // 1s before expiry
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify(creds))
    const result = await verifyPinOffline('5555')
    expect(result).not.toBeNull()
  })

  it('credential at exactly 24h+1ms is rejected', async () => {
    await provisionManagerCredential('6666', 'staff-exp2', 'Expired Manager', 'gerente')
    const raw = localStorage.getItem('pos_manager_credentials_v2')!
    const creds = JSON.parse(raw)
    creds[0].synced_at = Date.now() - (24 * 60 * 60 * 1000 + 1)
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify(creds))
    const result = await verifyPinOffline('6666')
    expect(result).toBeNull()
  })
})

describe('corrupt credential store', () => {
  it('returns null and does not throw when store contains invalid JSON', async () => {
    localStorage.setItem('pos_manager_credentials_v2', 'NOT_VALID_JSON{{{')
    const result = await verifyPinOffline('1234')
    expect(result).toBeNull()
  })

  it('returns null when store has valid JSON but wrong-shaped objects', async () => {
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify([{ bad: 'data' }, { also: 'bad' }]))
    const result = await verifyPinOffline('1234')
    expect(result).toBeNull()
  })
})

describe('re-provisioning after revocation', () => {
  it('re-provisioning a revoked credential re-enables access', async () => {
    await provisionManagerCredential('4444', 'staff-rev2', 'Manager Rev', 'gerente')
    revokeManagerCredential('staff-rev2')
    expect(await verifyPinOffline('4444')).toBeNull()
    // Online auth succeeds → re-provision
    await provisionManagerCredential('4444', 'staff-rev2', 'Manager Rev', 'gerente')
    expect(await verifyPinOffline('4444')).not.toBeNull()
  })

  it('revoking one does not affect others', async () => {
    await provisionManagerCredential('1111', 'staff-a', 'Manager A', 'gerente')
    await provisionManagerCredential('2222', 'staff-b', 'Manager B', 'admin')
    revokeManagerCredential('staff-a')
    expect(await verifyPinOffline('1111')).toBeNull()
    expect(await verifyPinOffline('2222')).not.toBeNull()
  })
})

describe('migration from legacy btoa cache', () => {
  it('PBKDF2 store is independent — does not read btoa cache', async () => {
    // Simulate a legacy btoa cache entry (as written by old pos-data.ts)
    const legacyCache = { [btoa('1234')]: { name: 'Legacy Manager', role: 'gerente', cached_at: Date.now() } }
    localStorage.setItem('pos_manager_pin_cache', JSON.stringify(legacyCache))

    // verifyPinOffline reads only the PBKDF2 store — should NOT find the btoa entry
    const result = await verifyPinOffline('1234')
    expect(result).toBeNull()
  })

  it('PBKDF2 provisioning does not wipe the legacy btoa cache', async () => {
    const legacyCache = { [btoa('1234')]: { name: 'Legacy Manager', role: 'gerente', cached_at: Date.now() } }
    localStorage.setItem('pos_manager_pin_cache', JSON.stringify(legacyCache))

    // Provision a DIFFERENT pin with PBKDF2
    await provisionManagerCredential('5678', 'staff-new', 'New Manager', 'admin')

    // Legacy cache must be untouched
    const still = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    expect(still[btoa('1234')]?.name).toBe('Legacy Manager')
  })

  it('after online auth + PBKDF2 provision, PIN verifies via PBKDF2', async () => {
    // Simulates what pos-data.ts does on successful online auth
    await provisionManagerCredential('1234', 'staff-m', 'Migrated Manager', 'gerente')
    const result = await verifyPinOffline('1234')
    expect(result?.name).toBe('Migrated Manager')
    expect(result?.role).toBe('gerente')
  })
})

describe('meetsMinRole — role hierarchy enforcement', () => {
  it('exact match: role === minRole is accepted', () => {
    expect(meetsMinRole('capitan', 'capitan')).toBe(true)
    expect(meetsMinRole('gerente', 'gerente')).toBe(true)
    expect(meetsMinRole('admin',   'admin')).toBe(true)
  })

  it('superior role is accepted', () => {
    expect(meetsMinRole('gerente', 'capitan')).toBe(true)
    expect(meetsMinRole('admin',   'capitan')).toBe(true)
    expect(meetsMinRole('admin',   'gerente')).toBe(true)
  })

  it('inferior role is rejected', () => {
    expect(meetsMinRole('mesero',  'capitan')).toBe(false)
    expect(meetsMinRole('cajero',  'capitan')).toBe(false)
    expect(meetsMinRole('capitan', 'gerente')).toBe(false)
    expect(meetsMinRole('gerente', 'admin')).toBe(false)
  })

  it('undefined role is rejected — fail safe', () => {
    expect(meetsMinRole(undefined, 'capitan')).toBe(false)
    expect(meetsMinRole(null,      'gerente')).toBe(false)
    expect(meetsMinRole('',        'mesero')).toBe(false)
  })

  it('unknown role is rejected — fail safe', () => {
    expect(meetsMinRole('supervisor', 'capitan')).toBe(false)
    expect(meetsMinRole('owner',      'gerente')).toBe(false)
  })

  it('unknown minRole rejects everything — fail safe', () => {
    expect(meetsMinRole('admin',   'superadmin')).toBe(false)
    expect(meetsMinRole('gerente', 'director')).toBe(false)
  })

  it('ROLE_HIERARCHY covers exactly the expected roles', () => {
    const roles = Object.keys(ROLE_HIERARCHY).sort()
    expect(roles).toEqual(['admin', 'cajero', 'capitan', 'gerente', 'mesero'])
  })
})

describe('offline audit log', () => {
  it('successful auth appears in log', async () => {
    await provisionManagerCredential('4321', 'staff-log', 'Log Manager', 'gerente')
    await verifyPinOffline('4321', 'cierre_caja')
    const log = getPendingOfflineAuthLog()
    const entry = log.find(e => e.action === 'auth_success' && e.staff_id === 'staff-log')
    expect(entry).toBeDefined()
    expect(entry?.context).toBe('cierre_caja')
  })

  it('failed auth appears in log as auth_failed', async () => {
    await provisionManagerCredential('4321', 'staff-log', 'Log Manager', 'gerente')
    await verifyPinOffline('0000')
    const log = getPendingOfflineAuthLog()
    const entry = log.find(e => e.action === 'auth_failed')
    expect(entry).toBeDefined()
  })

  it('markOfflineAuthLogSynced marks all entries as synced', async () => {
    await provisionManagerCredential('4321', 'staff-log', 'Log Manager', 'gerente')
    await verifyPinOffline('4321')
    markOfflineAuthLogSynced()
    const pending = getPendingOfflineAuthLog()
    expect(pending).toHaveLength(0)
  })
})
