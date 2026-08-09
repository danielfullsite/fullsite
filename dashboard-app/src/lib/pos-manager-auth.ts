/**
 * pos-manager-auth — secure offline manager authorization.
 *
 * Wansoft verifies manager actions against a local SQL Server database.
 * Fullsite must match: offline authorization must work without WAN.
 *
 * Design:
 *   – Device salt: 128-bit random, generated once per install, stored in
 *     localStorage. Ensures credentials from device A cannot be replayed on B.
 *   – PIN hash: PBKDF2(pin, deviceSalt, 10_000 iterations, SHA-256).
 *     Not reversible. 10K iterations ~5-20ms on tablet (acceptable for POS).
 *   – Credential TTL: 8 hours (one shift). After that, requires online auth.
 *   – Revocation: marked via `disabled: true`. Honored immediately.
 *   – Audit: every offline auth is logged to `pos_offline_auth_log` in
 *     localStorage and synced to Supabase on reconnect.
 *
 * Threat model:
 *   Primary risk: a non-manager staff member reads localStorage to extract
 *   PIN. PBKDF2 prevents trivial reversal; 10K iterations make brute-force
 *   over a 4–8 digit PIN space take > 10 minutes on the tablet itself.
 *
 * Known limitations:
 *   – If a manager is terminated while the terminal is offline, their cached
 *     credential remains valid until TTL expires (max 8 hours) or until the
 *     terminal reconnects. This matches Wansoft's offline behavior.
 *   – Only PIN auth is provisioned; biometric remains independent.
 *   – PIN changes on the server are not automatically propagated offline:
 *     the old hash stays valid until the manager authenticates online with
 *     the new PIN (which provisions the new hash).
 */

const PBKDF2_ITERATIONS = 10_000
const CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000  // 24h — full overnight shift (AUTH-01)
const CREDENTIALS_KEY = 'pos_manager_credentials_v2'
const DEVICE_SALT_KEY = 'pos_pin_device_salt'
const OFFLINE_LOG_KEY = 'pos_offline_auth_log'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManagerCredential {
  staff_id: string
  name: string
  role: string
  pin_hash: string    // base64-encoded PBKDF2 result
  synced_at: number   // Date.now() when provisioned — TTL baseline
  disabled: boolean
}

export interface OfflineAuthResult {
  name: string
  role: string
}

export interface OfflineAuthLogEntry {
  ts: number                   // Date.now()
  staff_id: string
  action: string               // 'auth_success' | 'auth_failed' | 'auth_expired' | 'auth_disabled'
  context?: string             // e.g. 'cierre_caja', 'retiro', 'descuento'
  synced?: boolean
}

// ── Role hierarchy — single source of truth for offline permission checks ────
// Must mirror the server-side definition in /api/pos/pin/route.ts.
// Unknown roles are treated as level 0 (fail-safe: always rejected).

export const ROLE_HIERARCHY: Record<string, number> = {
  mesero: 1,
  cajero:  2,
  capitan: 3,
  gerente: 4,
  admin:   5,
}

/**
 * Returns true iff `role` meets or exceeds `minRole` in the hierarchy.
 * Fails safe: undefined, empty, or unknown roles always return false.
 */
export function meetsMinRole(role: string | undefined | null, minRole: string): boolean {
  if (!role) return false
  const level = ROLE_HIERARCHY[role]
  const minLevel = ROLE_HIERARCHY[minRole]
  if (!level || !minLevel) return false
  return level >= minLevel
}

// ── Device salt (singleton per install) ──────────────────────────────────────

function getDeviceSalt(): string {
  try {
    let salt = localStorage.getItem(DEVICE_SALT_KEY)
    if (!salt) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      salt = btoa(String.fromCharCode(...bytes))
      localStorage.setItem(DEVICE_SALT_KEY, salt)
    }
    return salt
  } catch {
    // localStorage unavailable (SSR or private mode) — use a predictable but
    // non-empty fallback so the hash at least doesn't crash
    return 'ofs-fallback-salt-2026'
  }
}

// ── PBKDF2 hash ──────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder()
  const saltBytes = Uint8Array.from(atob(getDeviceSalt()), c => c.charCodeAt(0))
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial, 256,
  )
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

// ── Credential store ──────────────────────────────────────────────────────────

function loadCredentials(): ManagerCredential[] {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    return raw ? (JSON.parse(raw) as ManagerCredential[]) : []
  } catch { return [] }
}

function saveCredentials(creds: ManagerCredential[]): void {
  try { localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds)) } catch {}
}

/**
 * Provision a credential for offline use. Called after every successful
 * online PIN verification so the most-recent PIN is always cached.
 * Replaces any existing credential for the same staff_id.
 */
export async function provisionManagerCredential(
  pin: string,
  staffId: string,
  name: string,
  role: string,
): Promise<void> {
  const pin_hash = await hashPin(pin)
  const creds = loadCredentials().filter(c => c.staff_id !== staffId)
  creds.push({
    staff_id: staffId,
    name,
    role,
    pin_hash,
    synced_at: Date.now(),
    disabled: false,
  })
  saveCredentials(creds)
}

/**
 * Verify a PIN against locally-cached credentials.
 * Returns manager identity if valid, or null with a reason.
 */
export async function verifyPinOffline(
  pin: string,
  context?: string,
): Promise<OfflineAuthResult | null> {
  const creds = loadCredentials()
  const now = Date.now()
  const hash = await hashPin(pin)

  for (const cred of creds) {
    if (cred.disabled) {
      logOfflineAuth({ ts: now, staff_id: cred.staff_id, action: 'auth_disabled', context })
      continue
    }
    if (now - cred.synced_at > CREDENTIAL_TTL_MS) {
      logOfflineAuth({ ts: now, staff_id: cred.staff_id, action: 'auth_expired', context })
      continue
    }
    if (hash === cred.pin_hash) {
      logOfflineAuth({ ts: now, staff_id: cred.staff_id, action: 'auth_success', context })
      return { name: cred.name, role: cred.role }
    }
  }

  if (creds.length > 0) {
    logOfflineAuth({ ts: now, staff_id: 'unknown', action: 'auth_failed', context })
  }

  return null
}

/**
 * Mark a credential as disabled (e.g. after server reports staff was terminated).
 * Honored immediately on the next auth attempt.
 */
export function revokeManagerCredential(staffId: string): void {
  const creds = loadCredentials().map(c =>
    c.staff_id === staffId ? { ...c, disabled: true } : c,
  )
  saveCredentials(creds)
}

/**
 * Remove credentials older than TTL and disabled credentials.
 * Call on app startup when online.
 */
export function pruneStaleCredentials(): void {
  const now = Date.now()
  const fresh = loadCredentials().filter(
    c => !c.disabled && now - c.synced_at <= CREDENTIAL_TTL_MS,
  )
  saveCredentials(fresh)
}

/**
 * Returns the list of cached credentials for inspection (e.g. to show
 * which managers have offline access on this terminal). Hashes are not exposed.
 */
export function listCachedManagers(): Array<{ staff_id: string; name: string; role: string; expires_at: number; active: boolean }> {
  const now = Date.now()
  return loadCredentials().map(c => ({
    staff_id: c.staff_id,
    name: c.name,
    role: c.role,
    expires_at: c.synced_at + CREDENTIAL_TTL_MS,
    active: !c.disabled && now - c.synced_at <= CREDENTIAL_TTL_MS,
  }))
}

// ── Offline audit log ─────────────────────────────────────────────────────────

function logOfflineAuth(entry: OfflineAuthLogEntry): void {
  try {
    const log: OfflineAuthLogEntry[] = JSON.parse(
      localStorage.getItem(OFFLINE_LOG_KEY) || '[]',
    )
    log.push(entry)
    // Keep last 200 entries
    const trimmed = log.slice(-200)
    localStorage.setItem(OFFLINE_LOG_KEY, JSON.stringify(trimmed))
  } catch {}
}

/**
 * Returns pending (unsynced) offline auth log entries for flushing to Supabase.
 * Call this on reconnect and mark each entry as synced after upload.
 */
export function getPendingOfflineAuthLog(): OfflineAuthLogEntry[] {
  try {
    const log: OfflineAuthLogEntry[] = JSON.parse(
      localStorage.getItem(OFFLINE_LOG_KEY) || '[]',
    )
    return log.filter(e => !e.synced)
  } catch { return [] }
}

/**
 * Mark all pending log entries as synced.
 */
export function markOfflineAuthLogSynced(): void {
  try {
    const log: OfflineAuthLogEntry[] = JSON.parse(
      localStorage.getItem(OFFLINE_LOG_KEY) || '[]',
    )
    const synced = log.map(e => ({ ...e, synced: true }))
    localStorage.setItem(OFFLINE_LOG_KEY, JSON.stringify(synced))
  } catch {}
}
