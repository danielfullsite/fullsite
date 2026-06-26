// IndexedDB offline storage for POS
// Stores menu, orders, inventory, and sync queue for offline-first operation

const DB_NAME = 'fullsite_pos'
const DB_VERSION = 1

interface SyncQueueItem {
  id: string
  table: string
  method: 'POST' | 'PATCH' | 'DELETE'
  data: Record<string, unknown>
  endpoint?: string
  created_at: string
  synced: boolean
  retries: number
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
  endpoint?: string
): Promise<string> {
  const db = await openDB()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const item: SyncQueueItem = {
    id,
    table,
    method,
    data,
    endpoint,
    created_at: new Date().toISOString(),
    synced: false,
    retries: 0,
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

export async function syncAll(): Promise<{ synced: number; failed: number }> {
  const queue = await getPendingQueue()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    if (item.retries >= 5) continue // skip items that failed too many times

    const url = item.endpoint
      ? `${SUPABASE_URL}/rest/v1/${item.endpoint}`
      : `${SUPABASE_URL}/rest/v1/${item.table}`

    try {
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
      if (res.ok || res.status === 409) {
        await markSynced(item.id)
        synced++
      } else {
        await incrementRetry(item.id)
        failed++
      }
    } catch {
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
