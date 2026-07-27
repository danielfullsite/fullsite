'use client'
// ── ServerRegistry ─────────────────────────────────────────────────────────────
// Persists successful Local Server endpoints across sessions.
// Uses localStorage — simple, synchronous, no IDB overhead for discovery.
//
// Registry is keyed by restaurant_id. Each entry tracks the endpoint, the last
// validated identity, latency, and consecutive failure count. Records older than
// STALE_AFTER_MS are ignored (but not deleted — they may come back online).
//
// Failure tracking: after MAX_CONSECUTIVE_FAILURES failures, a record is excluded
// from getBest() but kept for debugging. It resets on the next success.
//
// The registry does NOT store sensitive data. restaurant_id is already in
// localStorage. server_id and instance_name are public mDNS TXT record values.

const STORAGE_KEY = 'fullsite_server_registry_v1'
const MAX_RECORDS_PER_RESTAURANT = 10
const MAX_CONSECUTIVE_FAILURES = 5
const STALE_AFTER_MS = 24 * 60 * 60 * 1000  // 24h

export interface ServerRecord {
  endpoint: string          // 'http://192.168.1.71:7717'
  restaurantId: string
  branchId: string | null
  serverId: string
  instanceName: string
  version: string
  protocolVersion: string
  lastSeen: number          // unix ms — updated on each successful validation
  lastLatencyMs: number     // round-trip to /identity
  consecutiveFailures: number
}

type RegistryStore = Record<string, ServerRecord[]>  // restaurantId → records, newest first

// ── Storage helpers ───────────────────────────────────────────────────────────

function load(): RegistryStore {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as RegistryStore
  } catch {
    return {}
  }
}

function persist(store: RegistryStore): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

export const ServerRegistry = {
  /**
   * Get the most recently seen, non-failed, non-stale record for a restaurant.
   * Returns null if none found.
   */
  getBest(restaurantId: string): ServerRecord | null {
    const store = load()
    const now = Date.now()
    return (store[restaurantId] ?? [])
      .filter(r => r.consecutiveFailures < MAX_CONSECUTIVE_FAILURES)
      .filter(r => now - r.lastSeen < STALE_AFTER_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null
  },

  /**
   * Get all non-stale records for a restaurant, ordered by most recently seen.
   * Includes records with failures (up to the caller to filter if needed).
   */
  getAll(restaurantId: string): ServerRecord[] {
    const store = load()
    const now = Date.now()
    return (store[restaurantId] ?? [])
      .filter(r => now - r.lastSeen < STALE_AFTER_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)
  },

  /**
   * Save or update a record after a successful identity validation.
   * Resets consecutiveFailures to 0.
   */
  recordSuccess(record: Omit<ServerRecord, 'consecutiveFailures'>): void {
    const store = load()
    const list: ServerRecord[] = store[record.restaurantId] ?? []
    const idx = list.findIndex(r => r.endpoint === record.endpoint)
    const updated: ServerRecord = { ...record, consecutiveFailures: 0 }
    if (idx >= 0) {
      list[idx] = updated
    } else {
      list.unshift(updated)
    }
    store[record.restaurantId] = list.slice(0, MAX_RECORDS_PER_RESTAURANT)
    persist(store)
  },

  /**
   * Increment the failure counter for an endpoint.
   * Returns the new consecutive failure count.
   */
  recordFailure(restaurantId: string, endpoint: string): number {
    const store = load()
    const list: ServerRecord[] = store[restaurantId] ?? []
    const idx = list.findIndex(r => r.endpoint === endpoint)
    if (idx < 0) return 0
    list[idx] = { ...list[idx], consecutiveFailures: list[idx].consecutiveFailures + 1 }
    store[restaurantId] = list
    persist(store)
    return list[idx].consecutiveFailures
  },

  /** Remove all records for a restaurant (e.g., when reprovisioning). */
  clear(restaurantId: string): void {
    const store = load()
    delete store[restaurantId]
    persist(store)
  },

  /** Expose constants for tests. */
  _constants: {
    MAX_RECORDS_PER_RESTAURANT,
    MAX_CONSECUTIVE_FAILURES,
    STALE_AFTER_MS,
    STORAGE_KEY,
  },
}
