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
    await provisionManagerCredential('1234', 'staff-exp', 'Old Manager', 'gerente')
    // Manually expire the credential
    const raw = localStorage.getItem('pos_manager_credentials_v2')!
    const creds = JSON.parse(raw)
    creds[0].synced_at = Date.now() - 9 * 60 * 60 * 1000  // 9 hours ago > 8h TTL
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify(creds))

    const result = await verifyPinOffline('1234')
    expect(result).toBeNull()
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
    creds[staleIdx].synced_at = Date.now() - 9 * 60 * 60 * 1000
    localStorage.setItem('pos_manager_credentials_v2', JSON.stringify(creds))

    pruneStaleCredentials()
    const managers = listCachedManagers()
    expect(managers.map(m => m.staff_id)).not.toContain('staff-stale')
    expect(managers.map(m => m.staff_id)).toContain('staff-fresh')
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
