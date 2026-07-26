/**
 * InventoryPolicyService
 *
 * Loads pos_item_inventory_policy once at POS startup and provides O(1) mode
 * lookups during the payment critical path. No network call at payment time.
 *
 * Policy change contract:
 *   pos_item_inventory_policy changes are admin-level migrations (not operational).
 *   Changes take effect at the start of the NEXT POS session. Operators MUST
 *   restart all open POS terminals after any policy migration.
 *   Re-initializing this service mid-session is detected and warned.
 *
 * Failure behavior:
 *   If initialization fails (FAILED state), getMode() returns null.
 *   Callers must fail-open: apply legacy behavior, not block the payment.
 *   See I-5 in R1-INVENTORY-CUTOVER.md.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export type PolicyCacheState = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'FAILED'

export interface PolicyStats {
  state: PolicyCacheState
  clientId: string | null
  itemCount: number
  durationMs: number | null
  contentHash: string | null
  loadedAt: number | null
  failureReason: string | null
  attempts: number
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

class InventoryPolicyService {
  private _state: PolicyCacheState = 'UNINITIALIZED'
  private _cache = new Map<string, string>()
  private _clientId: string | null = null
  private _durationMs: number | null = null
  private _contentHash: string | null = null
  private _loadedAt: number | null = null
  private _failureReason: string | null = null
  private _attempts = 0

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

    // If currently READY, preserve the valid map as fallback in case re-init fails.
    // A failed re-initialization must never leave the service in a worse state than before.
    const prevState = this._state
    const prevCache = this._cache
    const prevClientId = this._clientId

    this._state = 'LOADING'
    this._clientId = clientId
    const t0 = performance.now()
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
        this._cache = new Map(rows.map(r => [r.menu_item_id, r.inventory_mode]))
        this._durationMs = Math.round(performance.now() - t0)
        this._loadedAt = Date.now()

        const sorted = [...this._cache.entries()].sort(([a], [b]) => a.localeCompare(b))
        this._contentHash = djb2(JSON.stringify(sorted))

        this._state = 'READY'
        console.info(
          `[policy] READY | client=${clientId} items=${this._cache.size} ` +
          `duration=${this._durationMs}ms hash=${this._contentHash}`
        )
        return
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    // All attempts failed. If we had a valid READY state before this call, restore it.
    // This guarantees that a failed re-initialization never corrupts a previously good map.
    this._durationMs = Math.round(performance.now() - t0)
    this._failureReason = lastError

    if (prevState === 'READY') {
      this._state = 'READY'
      this._cache = prevCache
      this._clientId = prevClientId
      console.warn(
        `[policy] Re-init FAILED | kept previous READY state | ` +
        `client=${clientId} attempts=${this._attempts} reason=${lastError}`
      )
    } else {
      this._state = 'FAILED'
      console.warn(
        `[policy] FAILED | client=${clientId} attempts=${this._attempts} ` +
        `reason=${lastError} fallback=legacy`
      )
    }
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
      state: this._state,
      clientId: this._clientId,
      itemCount: this._cache.size,
      durationMs: this._durationMs,
      contentHash: this._contentHash,
      loadedAt: this._loadedAt,
      failureReason: this._failureReason,
      attempts: this._attempts,
    }
  }
}

export const inventoryPolicyService = new InventoryPolicyService()
export { InventoryPolicyService }  // exported for unit tests only
