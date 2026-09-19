import type { MovementRequest } from './inventory'
import { inventoryRequestError } from './inventory-movement-contract'

const DB = 'fullsite-inventory-intents-v1'
type Pending = { scope: string; request: MovementRequest }

/** Token claims select a LOCAL storage partition only. The server still verifies
 * the signature, membership, role and tenant before authorizing any movement.
 * Tokens and secrets are never persisted in this inventory journal. */
export function inventoryActorScope(token: string, tenant: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 2 && parts.length !== 3) return null
    const payload = parts[parts.length === 3 ? 1 : 0].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))))
    if (typeof decoded.sub !== 'string' || !decoded.sub || decoded.sub.length > 200 || /[\u0000-\u001f\u007f]/.test(decoded.sub)) return null
    if (parts.length === 2 && decoded.cid !== tenant) return null
    return JSON.stringify([tenant, parts.length === 2 ? 'shift_token' : 'supabase_session', decoded.sub])
  } catch { return null }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
const intent = ({ idempotency_key: _key, ...request }: MovementRequest) => canonical(request)

async function transaction<T>(scope: string, change: (current: Pending | undefined, store: IDBObjectStore) => T): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('INVENTORY_DURABLE_STORAGE_REQUIRED')); return }
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'scope' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('INVENTORY_DURABLE_STORAGE_REQUIRED'))
    request.onblocked = () => reject(new Error('INVENTORY_DURABLE_STORAGE_REQUIRED'))
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite'), store = tx.objectStore('pending')
      let result: T, failure: unknown
      const read = store.get(scope)
      read.onsuccess = () => {
        try { result = change(read.result, store) } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve(result)
      tx.onabort = tx.onerror = () => reject(failure || new Error('INVENTORY_DURABLE_STORAGE_REQUIRED'))
    })
  } finally { db.close() }
}

/** The transaction settles before network activity. Concurrent tabs cannot
 * replace a pending intent. A renewed token for the same actor keeps its scope. */
export async function retainInventoryIntent(scope: string, request: MovementRequest): Promise<{ request: MovementRequest; fresh: boolean; sameIntent: boolean }> {
  return transaction(scope, (current, store) => {
    if (current) {
      if (current.scope !== scope || inventoryRequestError(current.request)) throw new Error('INVENTORY_PENDING_INTENT_INVALID')
      return { request: current.request, fresh: false, sameIntent: intent(current.request) === intent(request) }
    }
    store.put({ scope, request } satisfies Pending)
    return { request, fresh: true, sameIntent: true }
  })
}

export async function releaseInventoryIntent(scope: string, request: MovementRequest): Promise<void> {
  return transaction(scope, (current, store) => {
    // A delayed second ACK must not delete a newer operation from another tab.
    if (current && canonical(current.request) === canonical(request)) store.delete(scope)
  })
}
