// IndexedDB offline storage for POS
// Stores menu, orders, inventory, and sync queue for offline-first operation

const DB_NAME = 'fullsite_pos'
const DB_VERSION = 1

// ─── Replay Transport Classes ───────────────────────────────────────────────
// APP_API: replay through application API routes (Next.js /api/pos/*)
//   - revision-aware, passes through r1_save_order + r1_reconcile_order
//   - REQUIRED for all reconciliation-relevant order state mutations
// SUPABASE_REST: replay directly to Supabase PostgREST
//   - for non-reconciliation-relevant data (audit logs, market stock, inventory movements)
//   - MUST NOT be used for reconciliation-relevant pos_orders mutations
type ReplayTransport = 'APP_API' | 'SUPABASE_REST'

// ─── Error Classification ───────────────────────────────────────────────────
// TRANSIENT_RETRYABLE: network failure, 5xx, fetch error — will retry
// STALE_WRITE_CONFLICT: revision mismatch — TERMINAL, no auto-retry, no overwrite
// TERMINAL_NON_RETRYABLE: malformed payload, validation rejection — cannot succeed unchanged
type SyncErrorClass = 'TRANSIENT_RETRYABLE' | 'STALE_WRITE_CONFLICT' | 'TERMINAL_NON_RETRYABLE'

interface SyncQueueItem {
  id: string
  table: string
  method: 'POST' | 'PATCH' | 'DELETE'
  data: Record<string, unknown>
  endpoint?: string
  transport?: ReplayTransport    // explicit routing — APP_API or SUPABASE_REST
  created_at: string
  synced: boolean
  retries: number
  base_version?: string          // server updated_at at time of queue, for conflict detection
  conflict?: boolean             // true if sync detected a conflict — requires manual resolution
  error_class?: SyncErrorClass   // classified error state
  error_detail?: string          // human-readable error detail for operator recovery
  server_revision?: number       // server revision at time of conflict (evidence)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('menu')) {
        db.createObjectStore('menu', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('orders')) {
        const store = db.createObjectStore('orders', { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('mesa', 'mesa', { unique: false })
      }
      if (!db.objectStoreNames.contains('inventory')) {
        db.createObjectStore('inventory', { keyPath: 'ingredient_id' })
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        const store = db.createObjectStore('sync_queue', { keyPath: 'id' })
        store.createIndex('synced', 'synced', { unique: false })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    }
  })
}

// ─── Menu Cache ─────────────────────────────────────────────────────────────

export async function cacheMenu(categories: Record<string, unknown>[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('menu', 'readwrite')
  const store = tx.objectStore('menu')
  store.clear()
  for (const cat of categories) {
    store.put(cat)
  }
  // Save timestamp
  const metaTx = db.transaction('meta', 'readwrite')
  metaTx.objectStore('meta').put({ key: 'menu_cached_at', value: new Date().toISOString() })
}

export async function getCachedMenu(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('menu', 'readonly')
    const request = tx.objectStore('menu').getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => resolve([])
  })
}

// ─── Orders Cache ───────────────────────────────────────────────────────────

export async function cacheOrder(order: Record<string, unknown>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('orders', 'readwrite')
  tx.objectStore('orders').put(order)
}

export async function getCachedOrders(status?: string): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('orders', 'readonly')
    if (status) {
      const index = tx.objectStore('orders').index('status')
      const request = index.getAll(status)
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([])
    } else {
      const request = tx.objectStore('orders').getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([])
    }
  })
}

export async function deleteCachedOrder(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('orders', 'readwrite')
  tx.objectStore('orders').delete(id)
}

// ─── Inventory Cache ────────────────────────────────────────────────────────

export async function cacheInventory(items: Record<string, unknown>[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('inventory', 'readwrite')
  const store = tx.objectStore('inventory')
  store.clear()
  for (const item of items) {
    store.put(item)
  }
}

export async function getCachedInventory(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('inventory', 'readonly')
    const request = tx.objectStore('inventory').getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => resolve([])
  })
}

// ─── Sync Queue ─────────────────────────────────────────────────────────────

export async function queueOperation(
  table: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  data: Record<string, unknown>,
  endpoint?: string,
  base_version?: string,
  transport?: ReplayTransport
): Promise<string> {
  const db = await openDB()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const item: SyncQueueItem = {
    id,
    table,
    method,
    data,
    endpoint,
    transport,
    created_at: new Date().toISOString(),
    synced: false,
    retries: 0,
    base_version,
  }
  const tx = db.transaction('sync_queue', 'readwrite')
  tx.objectStore('sync_queue').put(item)
  return id
}

export async function getPendingQueue(): Promise<SyncQueueItem[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('sync_queue', 'readonly')
    const request = tx.objectStore('sync_queue').getAll()
    request.onsuccess = () => resolve((request.result || []).filter((item: SyncQueueItem) => !item.synced))
    request.onerror = () => resolve([])
  })
}

export async function markSynced(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const request = store.get(id)
  request.onsuccess = () => {
    const item = request.result
    if (item) {
      item.synced = true
      store.put(item)
    }
  }
}

export async function incrementRetry(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const request = store.get(id)
  request.onsuccess = () => {
    const item = request.result
    if (item) {
      item.retries += 1
      store.put(item)
    }
  }
}

export async function clearAllPending(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  tx.objectStore('sync_queue').clear()
}

export async function clearTerminalItems(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const request = store.getAll()
  request.onsuccess = () => {
    for (const item of request.result) {
      if (!item.synced && (!item.endpoint || item.endpoint === 'undefined') && item.retries >= 3) {
        store.delete(item.id)
      }
    }
  }
}

export async function clearSyncedItems(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const request = store.getAll()
  request.onsuccess = () => {
    for (const item of request.result) {
      if (item.synced) store.delete(item.id)
    }
  }
}

// ─── Sync Engine ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ─── Transport Resolution ──────────────────────────────────────────────────
// Determines replay transport for a queue item.
// Priority: explicit transport field > endpoint prefix detection > default SUPABASE_REST
// Endpoint prefix detection is unambiguous: only /api/ paths are APP_API routes.
// Legacy persisted items (no transport field) with endpoint=/api/pos/save-order
// are correctly routed via prefix detection — no IndexedDB migration required.
function resolveTransport(item: SyncQueueItem): ReplayTransport {
  if (item.transport) return item.transport
  // Legacy compatibility: detect APP_API from endpoint prefix
  if (item.endpoint?.startsWith('/api/')) return 'APP_API'
  return 'SUPABASE_REST'
}

// ─── APP_API Replay ────────────────────────────────────────────────────────
// Replays through application API routes (e.g. /api/pos/save-order).
// Uses the current page origin as the base URL.
// Returns typed result including committed revision for active state propagation.
interface AppApiReplayResult {
  ok: boolean
  committedRevision?: number  // revision from successful save or idempotent replay
  orderId?: string            // order identity for event routing
  idempotentReplay?: boolean  // true if server recognized this as a replay of already-committed operation
  errorClass?: SyncErrorClass
  detail?: string
  serverRevision?: number     // server revision at conflict time (for STALE_WRITE)
}

async function replayViaAppApi(item: SyncQueueItem): Promise<AppApiReplayResult> {
  const apiPath = item.endpoint!
  // In browser: use window.location.origin. In SSR/worker: fall back to relative URL.
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${base}${apiPath}`

  const res = await fetch(url, {
    method: item.method,
    headers: { 'Content-Type': 'application/json' },
    body: item.method !== 'DELETE' ? JSON.stringify(item.data) : undefined,
  })

  if (!res.ok) {
    if (res.status >= 500) {
      return { ok: false, errorClass: 'TRANSIENT_RETRYABLE', detail: `HTTP ${res.status}` }
    }
    if (res.status === 400 || res.status === 422) {
      const errText = await res.text().catch(() => '')
      return { ok: false, errorClass: 'TERMINAL_NON_RETRYABLE', detail: `HTTP ${res.status}: ${errText}` }
    }
    return { ok: false, errorClass: 'TRANSIENT_RETRYABLE', detail: `HTTP ${res.status}` }
  }

  // Parse structured response body from /api/pos/save-order
  const body = await res.json().catch(() => ({ ok: false }))
  const dataPayload = item.data as Record<string, unknown>

  if (body.ok) {
    return {
      ok: true,
      committedRevision: typeof body.revision === 'number' ? body.revision : undefined,
      orderId: typeof dataPayload.order_id === 'string' ? dataPayload.order_id : undefined,
      idempotentReplay: body.idempotent_replay === true,
    }
  }

  // Save rejected — classify from body
  if (body.conflict === true) {
    // Check if this is an idempotent replay of a REJECTED operation
    // (the original operation was itself rejected — not a new conflict)
    if (body.idempotent_replay === true) {
      return {
        ok: false,
        errorClass: 'STALE_WRITE_CONFLICT',
        detail: `IDEMPOTENT_REPLAY_OF_REJECTED: original expected rev ${body.expected_revision}, was at ${body.current_revision}`,
        serverRevision: body.current_revision,
      }
    }
    return {
      ok: false,
      errorClass: 'STALE_WRITE_CONFLICT',
      detail: `STALE_WRITE_REJECTED: expected rev ${body.expected_revision}, server at ${body.current_revision}`,
      serverRevision: body.current_revision,
    }
  }

  if (body.error === 'ORDER_NOT_FOUND') {
    return { ok: false, errorClass: 'TERMINAL_NON_RETRYABLE', detail: 'ORDER_NOT_FOUND' }
  }

  if (body.error === 'PAYLOAD_IDENTITY_CORRUPTION') {
    return { ok: false, errorClass: 'TERMINAL_NON_RETRYABLE', detail: 'PAYLOAD_IDENTITY_CORRUPTION' }
  }

  return { ok: false, errorClass: 'TERMINAL_NON_RETRYABLE', detail: body.error || 'UNKNOWN_REJECTION' }
}

// ─── Conflict State Writer ─────────────────────────────────────────────────
// Marks a queue item with classified error state. Payload is PRESERVED for operator recovery.
async function markConflict(
  itemId: string,
  errorClass: SyncErrorClass,
  detail: string,
  serverRevision?: number
): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const existing = await new Promise<SyncQueueItem | undefined>((resolve) => {
    const req = store.get(itemId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
  if (existing) {
    existing.conflict = true
    existing.error_class = errorClass
    existing.error_detail = detail
    if (serverRevision != null) existing.server_revision = serverRevision
    store.put(existing)
  }
}

// Module-level lock: prevents concurrent syncAll from any caller (POS page, registerAutoSync, manual button).
// Without this, two concurrent runs can race: the second reads the queue before the first's markConflict
// completes, causing conflicted items to be re-processed and potentially lost.
let syncAllRunning = false

export async function syncAll(): Promise<{ synced: number; failed: number }> {
  if (syncAllRunning) {
    console.log('[offline-sync] syncAll already running — skipping duplicate call')
    return { synced: 0, failed: 0 }
  }
  syncAllRunning = true
  try {
    return await _syncAllInner()
  } finally {
    syncAllRunning = false
  }
}

async function _syncAllInner(): Promise<{ synced: number; failed: number }> {
  const queue = await getPendingQueue()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    // Skip items in terminal error state — they require operator intervention
    if (item.error_class === 'STALE_WRITE_CONFLICT' || item.error_class === 'TERMINAL_NON_RETRYABLE') {
      continue
    }
    if (item.retries >= 5) continue

    const transport = resolveTransport(item)

    try {
      if (transport === 'APP_API') {
        // ── APP_API replay: through certified application boundary ──
        const result = await replayViaAppApi(item)

        if (result.ok) {
          await markSynced(item.id)
          synced++
          // R2D: Emit order sync event so active POS page can advance revision state
          if (typeof window !== 'undefined' && result.committedRevision != null && result.orderId) {
            window.dispatchEvent(new CustomEvent('pos-order-synced', {
              detail: {
                orderId: result.orderId,
                revision: result.committedRevision,
                idempotentReplay: result.idempotentReplay || false,
              }
            }))
          }
        } else if (result.errorClass === 'STALE_WRITE_CONFLICT') {
          // TERMINAL — preserve payload, mark conflict, NO retry, NO overwrite, NO direct PATCH
          console.error(`[offline-sync] ${result.detail}`)
          await markConflict(item.id, 'STALE_WRITE_CONFLICT', result.detail!, result.serverRevision)
          failed++
        } else if (result.errorClass === 'TERMINAL_NON_RETRYABLE') {
          console.error(`[offline-sync] TERMINAL: ${result.detail}`)
          await markConflict(item.id, 'TERMINAL_NON_RETRYABLE', result.detail!)
          failed++
        } else {
          // TRANSIENT_RETRYABLE
          console.warn(`[offline-sync] Transient failure for ${item.endpoint}: ${result.detail}`)
          await incrementRetry(item.id)
          failed++
        }
      } else {
        // ── SUPABASE_REST replay: direct PostgREST for non-reconciliation data ──
        const url = item.endpoint
          ? `${SUPABASE_URL}/rest/v1/${item.endpoint}`
          : `${SUPABASE_URL}/rest/v1/${item.table}`

        const res = await fetch(url, {
          method: item.method,
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: item.method !== 'DELETE' ? JSON.stringify(item.data) : undefined,
        })
        if (res.ok) {
          await markSynced(item.id)
          synced++
        } else if (res.status === 409) {
          // For non-reconciliation-relevant 409, mark as synced (data already exists)
          console.warn(`[offline-sync] 409 on ${item.table} — already exists, marking synced`)
          await markSynced(item.id)
          synced++
        } else {
          await incrementRetry(item.id)
          failed++
        }
      }
    } catch {
      // Network error — transient retryable
      await incrementRetry(item.id)
      failed++
    }
  }

  // Clean up old synced items
  await clearSyncedItems()
  return { synced, failed }
}

// ─── Auto-sync on reconnect ──────────────────────────────────────────────────
// When internet returns, automatically sync pending operations.

let autoSyncRegistered = false
let isSyncing = false

export function registerAutoSync() {
  if (autoSyncRegistered || typeof window === 'undefined') return
  autoSyncRegistered = true

  // 1. On reconnect: sync pending
  window.addEventListener('online', async () => {
    if (isSyncing) {
      console.log('[offline-sync] Sync already in progress — skipping')
      return
    }
    isSyncing = true
    console.log('[offline-sync] Internet restored — syncing pending operations...')
    try {
      const { synced, failed } = await syncAll()
      if (synced > 0 || failed > 0) {
        console.log(`[offline-sync] Sync complete: ${synced} synced, ${failed} failed`)
      }
    } finally {
      isSyncing = false
    }
  })

  // 2. On mount: if online and queue has items, sync immediately
  // Covers the case where page reloaded while offline, then came back online
  if (navigator.onLine) {
    setTimeout(async () => {
      if (isSyncing) return
      try {
        const queue = await getPendingQueue()
        if (queue.length > 0) {
          isSyncing = true
          console.log(`[offline-sync] Found ${queue.length} pending items on mount — syncing...`)
          const { synced, failed } = await syncAll()
          console.log(`[offline-sync] Mount sync complete: ${synced} synced, ${failed} failed`)
          isSyncing = false
        }
      } catch {
        isSyncing = false
      }
    }, 2000) // small delay to let the app initialize
  }
}
