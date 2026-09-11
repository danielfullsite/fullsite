import type { MovementRequest } from './inventory'

const DB_NAME = 'fullsite_inventory_operations'
const STORE = 'pending'
export const INVENTORY_PENDING_EVENT = 'fullsite:inventory-pending'
export interface PendingMovement { scope: string; page: string; request: MovementRequest; created_at: string }
const scopeOf = (clientId: string) => JSON.stringify([clientId])
export const inventoryPage = () => typeof window === 'undefined' ? '/' : window.location.pathname
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value
const same = (a: MovementRequest, b: MovementRequest) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(INVENTORY_PENDING_EVENT)) }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'scope' })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}
/** A read/write IDB transaction serializes competing tabs before network I/O.
 * An unresolved count retains its original delta even after balances change. */
export async function freezeInventoryMovement(request: MovementRequest, page = inventoryPage()): Promise<MovementRequest> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE)
      const scope = scopeOf(request.client_id)
      let frozen: MovementRequest, conflict = false
      const read = store.get(scope)
      read.onsuccess = () => {
        const previous = read.result as PendingMovement | undefined
        if (previous && !same(previous.request, request)) { conflict = true; tx.abort(); return }
        frozen = previous?.request || JSON.parse(JSON.stringify(request))
        if (!previous) store.put({ scope, page, request: frozen, created_at: new Date().toISOString() })
      }
      tx.oncomplete = () => resolve(frozen)
      tx.onabort = () => reject(new Error(conflict ? 'INVENTORY_PENDING: recupera el movimiento pendiente antes de guardar otro' : 'INVENTORY_STORAGE_UNAVAILABLE'))
      tx.onerror = () => reject(new Error('INVENTORY_STORAGE_UNAVAILABLE'))
    })
  } finally { db.close(); notify() }
}
export async function readPendingMovement(clientId: string): Promise<PendingMovement | null> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const read = db.transaction(STORE, 'readonly').objectStore(STORE).get(scopeOf(clientId))
      read.onsuccess = () => resolve(read.result || null)
      read.onerror = () => reject(read.error)
    })
  } finally { db.close() }
}
/** Clear only the request whose outcome was confirmed; a stale response cannot
 * clear another tab's subsequent intentional movement. */
export async function resolvePendingMovement(request: MovementRequest): Promise<void> {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE)
      const scope = scopeOf(request.client_id), read = store.get(scope)
      read.onsuccess = () => { if (read.result && same(read.result.request, request)) store.delete(scope) }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close(); notify() }
}
