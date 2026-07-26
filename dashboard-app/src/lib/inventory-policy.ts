/**
 * InventoryPolicyService
 *
 * Loads pos_item_inventory_policy once at POS startup and provides O(1) mode
 * lookups during the payment critical path. No network call at payment time.
 *
 * Last-known-good (LKG) cache:
 *   On successful remote fetch the policy map is persisted to localStorage under
 *   lkg_policy_v1_${clientId}. On the next startup the cached map is applied
 *   immediately so the gate is active before the network request completes.
 *   This prevents a failed-network startup from silently reactivating the P0.
 *
 *   Cache tiers:
 *     < 7 days  → WARM: applied immediately, gate active before remote fetch
 *     7–30 days → STALE: used only as emergency fallback if remote fails
 *     > 30 days → discarded
 *
 * Policy change contract:
 *   pos_item_inventory_policy changes are admin-level migrations (not operational).
 *   Changes take effect at the start of the NEXT POS session. Operators MUST
 *   restart all open POS terminals after any policy migration.
 *
 * Failure behavior:
 *   READY_REMOTE / READY_CACHED: gate active, getMode() returns real values.
 *   FAILED_NO_POLICY: no remote AND no valid cache — gate inactive, getMode()
 *   returns null, Sistema A runs (fail-open). console.error + telemetry event.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const LKG_WARM_MS     = 7  * 24 * 60 * 60 * 1000  //  7 days
const LKG_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

// ── Types ────────────────────────────────────────────────────────────────────

export type PolicyCacheState = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'FAILED'

/** Internal source tag — not part of the public state enum */
type PolicySource = 'REMOTE' | 'CACHED'

export interface PolicyStats {
  state: PolicyCacheState
  clientId: string | null
  itemCount: number
  durationMs: number | null
  contentHash: string | null
  loadedAt: number | null
  failureReason: string | null
  attempts: number
  source: PolicySource | null    // REMOTE = live fetch; CACHED = from localStorage LKG
  cacheAgeMs: number | null      // 0 when source=REMOTE; age of entry when source=CACHED
}

interface LKGEntry {
  version: 1
  clientId: string
  rows: { menu_item_id: string; inventory_mode: string }[]
  savedAt: number
  hash: string  // djb2 hash — enables cross-terminal consistency checks
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function lkgKey(clientId: string): string {
  return `lkg_policy_v1_${clientId}`
}

// ── Service ──────────────────────────────────────────────────────────────────

class InventoryPolicyService {
  private _state: PolicyCacheState = 'UNINITIALIZED'
  private _cache = new Map<string, string>()
  private _clientId: string | null = null
  private _durationMs: number | null = null
  private _contentHash: string | null = null
  private _loadedAt: number | null = null
  private _failureReason: string | null = null
  private _attempts = 0
  private _source: PolicySource | null = null
  private _cacheAgeMs: number | null = null

  // ── Private helpers ────────────────────────────────────────────────────────

  private _computeHash(rows: { menu_item_id: string; inventory_mode: string }[]): string {
    const sorted = [...rows].sort((a, b) => a.menu_item_id.localeCompare(b.menu_item_id))
    return djb2(JSON.stringify(sorted))
  }

  private _emit(event: 'policy_cache_loaded' | 'policy_cache_missing', payload: Record<string, unknown>): void {
    console.info(`[policy:event] ${event}`, payload)
  }

  private _readLKG(clientId: string): { entry: LKGEntry; ageMs: number } | null {
    try {
      const raw = localStorage.getItem(lkgKey(clientId))
      if (!raw) return null
      const entry = JSON.parse(raw) as LKGEntry
      // Double-check: version must match and clientId must match (defensive against key collisions)
      if (entry.version !== 1 || entry.clientId !== clientId) return null
      const ageMs = Date.now() - entry.savedAt
      if (ageMs > LKG_FALLBACK_MS) return null  // too old — discard
      return { entry, ageMs }
    } catch {
      return null  // localStorage unavailable (SSR, private browsing, quota exceeded)
    }
  }

  private _writeLKG(clientId: string, rows: { menu_item_id: string; inventory_mode: string }[], hash: string): void {
    try {
      const entry: LKGEntry = { version: 1, clientId, rows, savedAt: Date.now(), hash }
      localStorage.setItem(lkgKey(clientId), JSON.stringify(entry))
    } catch {
      // localStorage unavailable — silently ignored; LKG is best-effort
    }
  }

  private _applyRows(
    rows: { menu_item_id: string; inventory_mode: string }[],
    hash: string,
    source: PolicySource,
    ageMs: number,
    t0: number,
  ): void {
    this._cache = new Map(rows.map(r => [r.menu_item_id, r.inventory_mode]))
    this._contentHash = hash
    this._source = source
    this._cacheAgeMs = ageMs
    this._durationMs = Math.round(performance.now() - t0)
    this._loadedAt = Date.now()
    this._state = 'READY'
    this._emit('policy_cache_loaded', {
      clientId: this._clientId,
      source,
      ageDays: Math.round(ageMs / 86400000),
      hash,
      itemCount: this._cache.size,
      ...(ageMs > LKG_WARM_MS && { stale: true }),
    })
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async initialize(clientId: string): Promise<void> {
    if (this._state === 'LOADING') return

    if (this._state === 'READY' && this._clientId === clientId) {
      // Policy changes require POS restart — mid-session re-init is a symptom
      // of a migration running while the terminal was open
      console.warn(
        '[policy] Re-init same client mid-session — kept existing READY state. ' +
        'Policy changes require POS terminal restart to take effect.'
      )
      return
    }

    // Preserve current READY state as fallback for a different-clientId re-init that fails
    const prevState    = this._state
    const prevCache    = this._cache
    const prevClientId = this._clientId

    this._state    = 'LOADING'
    this._clientId = clientId
    const t0       = performance.now()

    // ── Step 1: Load LKG cache ──────────────────────────────────────────────
    const lkg     = this._readLKG(clientId)
    const lkgWarm = lkg !== null && lkg.ageMs <= LKG_WARM_MS

    if (lkgWarm) {
      // Warm cache: gate is active immediately, before the remote fetch completes
      this._applyRows(lkg!.entry.rows, lkg!.entry.hash, 'CACHED', lkg!.ageMs, t0)
    }

    // ── Step 2: Always attempt remote (even when cache was applied) ─────────
    const MAX_ATTEMPTS = 3
    let lastError = ''

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this._attempts = attempt
      try {
        const res = await fetch(
          `${SB_URL}/rest/v1/pos_item_inventory_policy` +
          `?client_id=eq.${encodeURIComponent(clientId)}&select=menu_item_id,inventory_mode`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
        )
        if (!res.ok) {
          lastError = `HTTP ${res.status}`
          continue
        }

        const rows: { menu_item_id: string; inventory_mode: string }[] = await res.json()
        const hash = this._computeHash(rows)
        this._writeLKG(clientId, rows, hash)
        this._applyRows(rows, hash, 'REMOTE', 0, t0)
        console.info(
          `[policy] READY | source=REMOTE client=${clientId} items=${this._cache.size} ` +
          `duration=${this._durationMs}ms hash=${hash}`
        )
        return
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    // ── Step 3: Remote failed ───────────────────────────────────────────────
    this._durationMs    = Math.round(performance.now() - t0)
    this._failureReason = lastError

    if (this.isReady()) {
      // Gate is already active via warm LKG or prevState=READY — keep it
      console.warn(
        `[policy] remote FAILED | gate active via ${this._source}=${this._contentHash} ` +
        `cacheAge=${Math.round((this._cacheAgeMs ?? 0) / 86400000)}d | reason=${lastError}`
      )
      return
    }

    // Try stale LKG (7–30 days) as last resort
    if (lkg && !lkgWarm) {
      const ageDays = Math.round(lkg.ageMs / 86400000)
      this._applyRows(lkg.entry.rows, lkg.entry.hash, 'CACHED', lkg.ageMs, t0)
      console.warn(
        `[policy] remote FAILED | stale LKG (${ageDays}d) applied as emergency fallback ` +
        `| hash=${this._contentHash} items=${this._cache.size}`
      )
      return
    }

    // No LKG at all — check if there was a previous READY state (different clientId)
    if (prevState === 'READY') {
      this._state    = 'READY'
      this._cache    = prevCache
      this._clientId = prevClientId
      this._source   = 'CACHED'
      console.warn(
        `[policy] Re-init FAILED | kept previous READY state for client=${prevClientId} ` +
        `| reason=${lastError}`
      )
      return
    }

    // Truly no policy available — gate inactive
    this._state = 'FAILED'
    this._emit('policy_cache_missing', { clientId, reason: lastError })
    console.error(
      `[policy] FAILED_NO_POLICY | no remote, no cache | gate inactive | ` +
      `fallback=Sistema A | reason=${lastError}`
    )
  }

  /**
   * Returns the inventory_mode for an item, or null if:
   * - Service is not READY (initialization pending or failed)
   * - Item has no entry in pos_item_inventory_policy
   *
   * Callers must treat null as "apply legacy behavior" (fail-open).
   */
  getMode(menuItemId: string): string | null {
    if (this._state !== 'READY') return null
    return this._cache.get(menuItemId) ?? null
  }

  isReady(): boolean {
    return this._state === 'READY'
  }

  stats(): PolicyStats {
    return {
      state:         this._state,
      clientId:      this._clientId,
      itemCount:     this._cache.size,
      durationMs:    this._durationMs,
      contentHash:   this._contentHash,
      loadedAt:      this._loadedAt,
      failureReason: this._failureReason,
      attempts:      this._attempts,
      source:        this._source,
      cacheAgeMs:    this._cacheAgeMs,
    }
  }
}

export const inventoryPolicyService = new InventoryPolicyService()
export { InventoryPolicyService }  // exported for unit tests only
