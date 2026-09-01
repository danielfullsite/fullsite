// IndexedDB offline storage for POS
// Stores menu, orders, inventory, and sync queue for offline-first operation

const DB_NAME = 'fullsite_pos'
const DB_VERSION = 4

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
// AUTH_EXPIRED: 401 SOLAMENTE — shift token venció (TTL 8h, sin refresh). NO es transient:
//   reintentar en silencio no sirve. Detiene el drenado, PRESERVA la cola y pide
//   re-PIN (emitAuthRequired). Tras re-login, la cola drena sola. Nunca se pierde nada.
//   Un 403 NO entra aquí: 403 = autenticado pero sin permiso, y re-PIN con el mismo staff
//   no lo arregla → se clasifica TERMINAL_NON_RETRYABLE y sólo se aísla ese item.
type SyncErrorClass = 'TRANSIENT_RETRYABLE' | 'STALE_WRITE_CONFLICT' | 'TERMINAL_NON_RETRYABLE' | 'AUTH_EXPIRED'

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
      // v2: offline cache for modifiers and payment methods
      if (!db.objectStoreNames.contains('modifier_groups')) {
        db.createObjectStore('modifier_groups', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('modifiers')) {
        db.createObjectStore('modifiers', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('item_modifier_links')) {
        db.createObjectStore('item_modifier_links', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('payment_methods')) {
        db.createObjectStore('payment_methods', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('staff')) {
        db.createObjectStore('staff', { keyPath: 'id' })
      }
      // v3: turnos — enables offline shift open/close with sync-later
      if (!db.objectStoreNames.contains('turnos')) {
        const store = db.createObjectStore('turnos', { keyPath: 'id' })
        store.createIndex('client_id', 'client_id', { unique: false })
        store.createIndex('closed_at', 'closed_at', { unique: false })
      }
      // v3: cash_movements — retiros, depósitos, fondo offline
      if (!db.objectStoreNames.contains('cash_movements')) {
        const store = db.createObjectStore('cash_movements', { keyPath: 'id' })
        store.createIndex('turno_id', 'turno_id', { unique: false })
      }
      // v4: print_jobs — durable print queue survives localStorage wipe and Electron restart
      if (!db.objectStoreNames.contains('print_jobs')) {
        const store = db.createObjectStore('print_jobs', { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
  })
}

// ─── Menu Cache ─────────────────────────────────────────────────────────────

/**
 * Aislamiento de tenant del store local del POS. Si el navegador ya usó este POS con
 * OTRO `client_id` (ej. brincó de amalay → boruca / esqueleton), limpia el store local
 * (IndexedDB `fullsite_pos` + claves `pos_*` de localStorage) para no mostrar órdenes,
 * comandas o menú de otro restaurante. Devuelve `true` si limpió (el caller debe recargar).
 *
 * SEGURO en una terminal de un solo tenant (AMALAY): el client_id nunca cambia → nunca
 * limpia. Fail-safe: si el client_id actual viene vacío, no toca nada. Solo limpia cuando
 * el tenant guardado es no-vacío Y distinto del actual.
 */
export async function guardTenant(clientId: string): Promise<boolean> {
  if (!clientId) return false
  const db = await openDB()
  const prev = await new Promise<string | null>((resolve) => {
    const tx = db.transaction('meta', 'readonly')
    const r = tx.objectStore('meta').get('tenant')
    r.onsuccess = () => resolve((r.result?.value as string) ?? null)
    r.onerror = () => resolve(null)
  })
  const mismatch = !!prev && prev !== clientId
  if (mismatch) {
    const stores = ['orders', 'sync_queue', 'print_jobs', 'cash_movements', 'inventory', 'menu', 'modifier_groups', 'modifiers', 'item_modifier_links', 'payment_methods', 'staff', 'turnos']
    const present = stores.filter((s) => db.objectStoreNames.contains(s))
    await new Promise<void>((resolve) => {
      const tx = db.transaction(present, 'readwrite')
      for (const s of present) { try { tx.objectStore(s).clear() } catch { /* */ } }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    try {
      const kill: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k.startsWith('pos_') || k === 'fullsite_offline_queue')) kill.push(k)
      }
      kill.forEach((k) => localStorage.removeItem(k))
    } catch { /* */ }
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put({ key: 'tenant', value: clientId })
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  return mismatch
}

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

const ACTIVE_ORDER_STATUSES = new Set(['enviada', 'preparando', 'lista', 'abierta', 'entregada'])

/**
 * Orders safe to paint as occupied while offline. The generic order cache also
 * contains closed/cancelled history, so consumers must not interpret every row
 * as a live table.
 */
export async function getCachedActiveOrders(clientId?: string): Promise<Record<string, unknown>[]> {
  const all = await getCachedOrders()

  // El filtro por tenant FALLA CERRADO. Antes era
  //   `return !clientId || !owner || owner === clientId`
  // y las dos primeras condiciones eran comodines:
  //
  //   `!owner`     -> una orden con client_id vacio se pintaba en el mapa de
  //                   CUALQUIER restaurante. En prod hay 7 asi (jul-2026, $1,879,
  //                   huerfanas de cuando getActiveClientSlug devolvia ''), de modo
  //                   que hoy un segundo cliente en la misma base veria mesas de
  //                   AMALAY ocupadas.
  //   `!clientId`  -> una terminal que no sabe de quien es pintaba las mesas de
  //                   TODOS los tenants del cache.
  //
  // Contra la regla multi-tenant del proyecto: impedir fallback a otro restaurante
  // y fallar cerrado cuando no haya mapping (CLAUDE.md §12).
  //
  // Se excluye en silencio NO: esconder una mesa ocupada es exactamente el fallo
  // que costo la noche del 30-ago (un plano que dice "libre" se ve bien y miente).
  // Por eso cada exclusion se reporta.
  const sinTenant: string[] = []
  const deOtroTenant: string[] = []

  const result = all
    .filter(order => {
      if (!ACTIVE_ORDER_STATUSES.has(String(order.status))) return false
      const owner = String(order.client_id ?? '')
      const id = String(order.id ?? '?')
      if (!owner) { sinTenant.push(id); return false }
      if (!clientId) return false
      if (owner !== clientId) { deOtroTenant.push(id); return false }
      return true
    })
    .sort((a, b) => {
      const bt = Date.parse(String(b.updated_at ?? b.created_at ?? '')) || 0
      const at = Date.parse(String(a.updated_at ?? a.created_at ?? '')) || 0
      return bt - at
    })

  if (!clientId) {
    // La terminal no sabe a que restaurante pertenece. No se pinta NADA: pintar
    // el cache completo mezclaria restaurantes. Es ruidoso a proposito — con este
    // estado el POS tampoco puede guardar bien, asi que hay que verlo.
    console.error('[mesas] la terminal no tiene client_id — no se pinta ninguna mesa del cache')
  }
  if (sinTenant.length) {
    console.warn(`[mesas] ${sinTenant.length} orden(es) en cache sin client_id, excluidas del mapa`, sinTenant)
  }
  if (deOtroTenant.length) {
    console.warn(`[mesas] ${deOtroTenant.length} orden(es) de otro restaurante en este cache`, deOtroTenant)
  }
  return result
}

/**
 * Reconcile the live-table portion of IndexedDB with the authoritative online
 * snapshot. Pending offline IDs are preserved because their queue has not reached
 * the server yet. Historical closed/cancelled rows are left intact for recovery.
 */
export async function reconcileCachedActiveOrders(
  serverOrders: Record<string, unknown>[],
  clientId: string,
  preserveIds: string[] = [],
): Promise<void> {
  const db = await openDB()
  const keep = new Set([
    ...serverOrders.map(order => String(order.id ?? '')).filter(Boolean),
    ...preserveIds.map(String).filter(Boolean),
  ])
  await new Promise<void>((resolve) => {
    const tx = db.transaction('orders', 'readwrite')
    const store = tx.objectStore('orders')
    const request = store.getAll()
    request.onsuccess = () => {
      for (const order of (request.result || []) as Record<string, unknown>[]) {
        const id = String(order.id ?? '')
        const owner = String(order.client_id ?? '')
        const belongsHere = !clientId || !owner || owner === clientId
        if (belongsHere && ACTIVE_ORDER_STATUSES.has(String(order.status)) && !keep.has(id)) {
          store.delete(order.id as IDBValidKey)
        }
      }
      for (const order of serverOrders) store.put(order)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

/**
 * T-26 — Calienta el cache de MESAS OCUPADAS para el arranque en frio sin WAN.
 *
 * POR QUE EXISTE
 *
 * La matriz de certificacion ya cubre dos escenarios de arranque en frio, y
 * ninguno es este:
 *   - T-24: que el mesero pueda ENTRAR sin red        (cerrado en #133)
 *   - T-25: que aparezca el PLANO de mesas sin red    (cerrado en #128)
 * Falta el tercero: que esas mesas digan la VERDAD. Campo AMALAY 2026-08-31,
 * terminal Entrada: el plano salio perfecto —33 mesas, distribucion correcta—
 * con las 15 ocupadas marcadas "Disponible". Un plano ausente se ve roto; un
 * plano que dice "todo libre" se ve bien y miente. El mesero sienta gente en
 * una mesa que debe $713, o le abre segunda cuenta.
 *
 * CAUSA: `getCachedActiveOrders` lee de IndexedDB, y a IndexedDB solo lo
 * llenaba `reconcileCachedActiveOrders` cuando alguien abria el mapa ESTANDO
 * ONLINE. Tras una reinstalacion o una limpieza de storage, el cache queda
 * vacio y nadie lo vuelve a llenar hasta que por casualidad se entra con red.
 * O sea: el mapa offline valia lo que valiera el ultimo calentamiento, y nadie
 * sabia cuando se enfrio.
 *
 * QUE HACE: al hacer login CON red, deja el cache listo para el proximo
 * arranque sin ella. Deterministico, no por casualidad.
 *
 * NO se cachea en el Service Worker a proposito: `sw.js` tiene
 * `/rest/v1/pos_orders` en NEVER_CACHE_PATTERNS porque servir esa respuesta
 * vieja ya rompio el phantom-check y la comanda no llegaba al KDS. Este
 * calentamiento va por IndexedDB, que es el fallback que el propio SW espera.
 */
export async function warmActiveOrdersCache(
  clientId: string,
): Promise<'ok' | 'offline' | 'error' | 'skipped'> {
  if (!clientId) return 'skipped'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  // Se lee al LLAMAR, no al cargar el modulo. Next inlinea NEXT_PUBLIC_* en el
  // bundle igual en ambos casos, y asi la funcion se puede verificar.
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!sbUrl || !sbKey) return 'skipped'

  let serverOrders: Record<string, unknown>[]
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(clientId)}` +
        `&status=in.(enviada,preparando,lista,abierta,entregada)&order=created_at.desc&limit=50`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' },
    )
    if (!res.ok) return 'error'
    serverOrders = await res.json()
    if (!Array.isArray(serverOrders)) return 'error'
  } catch {
    return 'error'
  }

  // RAMA DE FALLA — la que importa. `reconcileCachedActiveOrders` BORRA del cache
  // toda orden activa que no venga en el snapshot del servidor. Una orden creada
  // offline todavia esta subiendo: no aparece ahi. Sin preservarla, calentar
  // BORRARIA una venta real y la mesa se veria libre. Misma regla que usa el mapa
  // en app/pos/mesas/page.tsx (#37): se saltan los items con error terminal
  // —getPendingQueue(true) ya los filtra— y las mesas que el servidor ya conoce.
  const preserveIds: string[] = []
  try {
    const pending = await getPendingQueue(true)
    const syncedMesas = new Set(
      serverOrders.map((o) => o.mesa).filter((m): m is number => typeof m === 'number'),
    )
    for (const item of pending) {
      const d = item.data as Record<string, unknown>
      if (item.table !== 'pos_orders' || typeof d?.mesa !== 'number') continue
      if (!ACTIVE_ORDER_STATUSES.has(String(d.status)) || syncedMesas.has(d.mesa)) continue
      const id = String(d.order_id ?? d.id ?? '')
      if (id) preserveIds.push(id)
    }
  } catch {
    // Cola ilegible: preferimos NO reconciliar antes que borrar ordenes encoladas.
    return 'error'
  }

  try {
    await reconcileCachedActiveOrders(serverOrders, clientId, preserveIds)
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function deleteCachedOrder(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('orders', 'readwrite')
  tx.objectStore('orders').delete(id)
}

/**
 * Purge only order/test-sale state after the owner has deleted every cloud order.
 * Keeps menu, staff, fingerprints, terminal config, print jobs, inventory, turnos
 * and cash movements intact. Order writes must also leave the replay queues or they
 * would recreate the deleted orders on the next reconnect.
 */
export async function clearLocalOrderData(storage?: Storage): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(['orders', 'sync_queue'], 'readwrite')
    tx.objectStore('orders').clear()
    const queue = tx.objectStore('sync_queue')
    const req = queue.getAll()
    req.onsuccess = () => {
      for (const item of (req.result || []) as SyncQueueItem[]) {
        if (item.table === 'pos_orders' || item.table === 'pos_audit_log') queue.delete(item.id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })

  const ls = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!ls) return
  const remove: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && (key === 'pos_mesas_orders' || key.startsWith('pos_order_') || key.startsWith('pos_draft_'))) remove.push(key)
  }
  remove.forEach(key => ls.removeItem(key))

  // Emergency fallback queue used when IndexedDB is temporarily unavailable.
  try {
    const key = 'fullsite_offline_queue'
    const queued = JSON.parse(ls.getItem(key) || '[]') as Array<{ table?: string }>
    const preserved = queued.filter(item => item.table !== 'pos_orders' && item.table !== 'pos_audit_log')
    if (preserved.length > 0) ls.setItem(key, JSON.stringify(preserved))
    else ls.removeItem(key)
  } catch { /* malformed legacy queue: leave it for diagnostics */ }
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
  // Se avisa al encolar ademas de bloquear al reproducir: aqui todavia se sabe QUIEN
  // la creo. En el replay ya no hay pista del origen.
  if (esMutacionSinFiltro(method, endpoint || table)) {
    console.error(
      `[offline-sync] ${method} a "${table}" SIN filtro: tocaria toda la tabla. ` +
      `Pasa un endpoint con filtro, p. ej. "${table}?id=eq.<id>". No se reproducira.`,
    )
  }
  const tx = db.transaction('sync_queue', 'readwrite')
  tx.objectStore('sync_queue').put(item)
  return id
}

export function repairReplayData(
  table: string,
  data: Record<string, unknown>,
  sessionActor = '',
): Record<string, unknown> {
  if (table !== 'pos_audit_log' || (typeof data.actor === 'string' && data.actor.trim())) return data
  return { ...data, actor: sessionActor.trim() || 'POS Offline' }
}

export async function getPendingQueue(actionableOnly = false): Promise<SyncQueueItem[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('sync_queue', 'readonly')
    const request = tx.objectStore('sync_queue').getAll()
    request.onsuccess = () => {
      const all = (request.result || []).filter((item: SyncQueueItem) => !item.synced)
      resolve(actionableOnly ? all.filter((item: SyncQueueItem) => !item.error_class) : all)
    }
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

export async function incrementRetry(id: string, detail = ''): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const store = tx.objectStore('sync_queue')
  const request = store.get(id)
  request.onsuccess = () => {
    const item = request.result
    if (item) {
      item.retries += 1
      if (detail) item.error_detail = detail.slice(0, 500)
      store.put(item)
    }
  }
}

/** Reinicia el contador de reintentos de los items no-terminales de la cola.
 *  Se llama en una sesión FRESCA (re-PIN): un backlog que agotó sus reintentos con
 *  un token vencido merece un re-intento limpio con la credencial nueva. Los items
 *  con error_class (terminal) NO se tocan — esos requieren intervención humana. */
export async function resetSyncQueueRetries(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('sync_queue', 'readwrite')
    const store = tx.objectStore('sync_queue')
    const req = store.getAll()
    req.onsuccess = () => {
      let reset = 0
      for (const item of (req.result || []) as SyncQueueItem[]) {
        if (!item.synced && !item.error_class && (item.retries ?? 0) > 0) {
          item.retries = 0
          store.put(item)
          reset++
        }
      }
      tx.oncomplete = () => resolve(reset)
    }
    req.onerror = () => resolve(0)
  })
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
      // Only delete items that have been explicitly classified as terminal errors
      // AND have exhausted all retries. Items without error_class may still recover.
      if (!item.synced && item.error_class !== undefined && item.retries >= 5) {
        store.delete(item.id)
      }
    }
  }
}

export interface SyncQueueSummary {
  pending: number     // items in queue, not yet synced, no terminal error
  terminal: number    // items with STALE_WRITE_CONFLICT or TERMINAL_NON_RETRYABLE
  conflicts: number   // items with conflict: true (subset of terminal, for display)
  exhausted: number   // items with retries >= 5 but no error_class (transient failures that ran out)
}

export async function getSyncQueueSummary(): Promise<SyncQueueSummary> {
  const queue = await getPendingQueue()
  let pending = 0, terminal = 0, conflicts = 0, exhausted = 0
  for (const item of queue) {
    if (item.error_class === 'STALE_WRITE_CONFLICT' || item.error_class === 'TERMINAL_NON_RETRYABLE') {
      terminal++
      if (item.conflict) conflicts++
    } else if (item.retries >= 5) {
      exhausted++
    } else {
      pending++
    }
  }
  return { pending, terminal, conflicts, exhausted }
}

export interface SyncQueueDiagnostic {
  id: string
  operation: string
  retries: number
  errorClass: string
  detail: string
  orderId: string
  mesa: number | null
  status: string
  total: number | null
  serverRevision: number | null
}

/** Safe operator diagnostics: deliberately excludes queued order/payment payloads. */
export async function getSyncQueueDiagnostics(): Promise<SyncQueueDiagnostic[]> {
  const queue = await getPendingQueue()
  return queue.map(item => {
    const data = item.data || {}
    return {
      id: item.id,
      operation: item.endpoint || item.table || item.method || 'unknown',
      retries: item.retries ?? 0,
      errorClass: item.error_class || ((item.retries ?? 0) >= 5 ? 'RETRIES_EXHAUSTED' : 'PENDING'),
      detail: item.error_detail || '',
      orderId: typeof data.order_id === 'string' ? data.order_id : '',
      mesa: Number.isFinite(Number(data.mesa)) ? Number(data.mesa) : null,
      status: typeof data.status === 'string' ? data.status : '',
      total: Number.isFinite(Number(data.total)) ? Number(data.total) : null,
      serverRevision: typeof item.server_revision === 'number' ? item.server_revision : null,
    }
  })
}

export async function resolveSyncConflictKeepServer(itemId: string): Promise<boolean> {
  const db = await openDB()
  return new Promise(resolve => {
    const tx = db.transaction('sync_queue', 'readwrite')
    const store = tx.objectStore('sync_queue')
    const req = store.get(itemId)
    req.onsuccess = () => {
      const item = req.result as SyncQueueItem | undefined
      if (!item || !item.error_class) { resolve(false); return }
      store.delete(itemId)
      tx.oncomplete = () => resolve(true)
    }
    req.onerror = () => resolve(false)
  })
}

export async function resolveSyncConflictApplyLocal(
  itemId: string,
  approvalToken: string,
  manager: string,
): Promise<boolean> {
  const db = await openDB()
  return new Promise(resolve => {
    const tx = db.transaction('sync_queue', 'readwrite')
    const store = tx.objectStore('sync_queue')
    const req = store.get(itemId)
    req.onsuccess = () => {
      const item = req.result as SyncQueueItem | undefined
      if (!item || item.error_class !== 'STALE_WRITE_CONFLICT' || typeof item.server_revision !== 'number') {
        resolve(false)
        return
      }
      item.data = {
        ...item.data,
        expected_revision: item.server_revision,
        save_operation_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conflict_resolution: true,
        approval_token: approvalToken,
        conflict_resolved_by: manager,
      }
      item.base_version = String(item.server_revision)
      item.retries = 0
      delete item.error_class
      delete item.error_detail
      delete item.server_revision
      delete item.conflict
      store.put(item)
      tx.oncomplete = () => resolve(true)
    }
    req.onerror = () => resolve(false)
  })
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

// ─── BUG-019 / multi-day offline session refresh ─────────────────────────────
// Requisito canónico: el restaurante opera días sin WAN y al volver sincroniza
// TODO automáticamente. Con RLS tenant-scoped, el replay debe ir autenticado. El
// access token de Supabase (1h) y el shift-token (8h) expiran durante un offline
// de días; el refresh token de Supabase es de larga vida. Antes de drenar la
// cola, refrescamos la sesión y usamos el access token fresco para AMBOS
// transportes. Si el refresh falla (refresh token revocado) → FAIL CLOSED: NO
// se drena, NO se envía con anon, la cola se preserva intacta y se pide re-login.
//
// Devuelve el access_token fresco, o null si no hay sesión válida (fail closed).
async function getFreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    const { getSupabase } = await import('./supabase')
    const supabase = getSupabase()
    // getSession() refresca el access token usando el refresh token si expiró.
    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session?.access_token) return null
    // Sanity: el token no debe estar expirado tras el refresh.
    const exp = data.session.expires_at ? data.session.expires_at * 1000 : 0
    if (exp && exp < Date.now()) return null
    return data.session.access_token
  } catch {
    return null
  }
}

// Señal para la UI: la sesión no pudo renovarse (refresh revocado/ausente) →
// se requiere login manual. La cola NO se pierde; se reintenta al re-autenticar.
function emitAuthRequired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pos-sync-auth-required'))
  }
}

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

async function replayViaAppApi(item: SyncQueueItem, accessToken: string): Promise<AppApiReplayResult> {
  const apiPath = item.endpoint!
  // In browser: use window.location.origin. In SSR/worker: fall back to relative URL.
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${base}${apiPath}`

  // Pass x-client-id for legacy compatibility, pero el server NUNCA confía en él
  // para el tenant: withPOSAuth resuelve clientId desde el shift-token o desde
  // client_users (auth.uid()). BUG-019 / multi-day offline: usamos el access
  // token de sesión FRESCO como Authorization (el shift-token de 8h pudo expirar
  // en un offline de días). El path de sesión de withPOSAuth resuelve el tenant
  // server-side de forma no falsificable; si la membership fue revocada mientras
  // el device estuvo offline, el server rechaza (fail closed) y la cola se
  // preserva.
  let clientId = ''
  if (typeof window !== 'undefined') {
    try { clientId = localStorage.getItem('fullsite_client_id') || '' } catch {}
  }

  const res = await fetch(url, {
    method: item.method,
    headers: {
      'Content-Type': 'application/json',
      ...(clientId ? { 'x-client-id': clientId } : {}),
      'Authorization': `Bearer ${accessToken}`,
    },
    body: item.method !== 'DELETE' ? JSON.stringify(item.data) : undefined,
  })

  if (!res.ok) {
    // 401 = NO autenticado: el shift token venció (8h, sin refresh). Re-PIN LO ARREGLA.
    // Se clasifica aparte para detener el drenado, preservar la cola y avisar.
    if (res.status === 401) {
      return { ok: false, errorClass: 'AUTH_EXPIRED', detail: 'HTTP 401 — sesión expirada' }
    }
    // 403 = autenticado PERO no permitido. Re-PIN con el MISMO staff NUNCA lo arregla.
    // Aquí el único 403 alcanzable es MANAGER_APPROVAL_REQUIRED de save-order (rebase de
    // conflicto sin token de gerente firmado online, o con el token ya vencido). Tratarlo
    // como AUTH_EXPIRED dejaba el item colgado sin error_class y abortaba el drenado.
    if (res.status === 403) {
      const errText = await res.text().catch(() => '')
      return { ok: false, errorClass: 'TERMINAL_NON_RETRYABLE', detail: `HTTP 403${errText ? `: ${errText}` : ''}` }
    }
    // A closed/missing shift is an accounting conflict, not a connectivity failure.
    // Preserve the payload for operator recovery and do not retry it into a closed cut.
    if (res.status === 409) {
      const conflictBody = await res.json().catch(() => ({})) as { error?: string }
      return {
        ok: false,
        errorClass: 'TERMINAL_NON_RETRYABLE',
        detail: conflictBody.error || 'TURN_CONFLICT',
      }
    }
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

// ─── Guardia de mutaciones sin filtro ───────────────────────────────────────
/**
 * Un PATCH o DELETE sin filtro en la ruta toca TODAS las filas del tenant.
 *
 * INCIDENTE 2026-08-31, AMALAY. Once turnos quedaron con
 * `closed_at = 20:07:00.918` — el MISMO milisegundo — varios de ellos abiertos
 * despues de esa hora. Once clics no caen en el mismo milisegundo: fue UNA sola
 * escritura tocando once filas.
 *
 * La ruta se arma asi en el replay:
 *
 *   const restPath = item.endpoint || item.table   // -> "pos_turnos"
 *   fetch(`${SUPABASE_URL}/rest/v1/${restPath}`, { method: item.method })
 *
 * Si el item se encolo sin `endpoint`, la URL queda sin filtro y PostgREST aplica
 * el PATCH a todo lo que la credencial alcance. Con DELETE seria un borrado total.
 *
 * `queueOperation` acepta `endpoint` opcional, y hay llamadas que lo omiten — o sea
 * que la forma peligrosa es facil de escribir sin darse cuenta.
 *
 * REGLA: un POST no necesita filtro (inserta). Un PATCH o un DELETE sin `?` en la
 * ruta NO se envia nunca: se marca terminal y queda para revision humana, con el
 * payload intacto.
 */
export function esMutacionSinFiltro(method: string, restPath: string): boolean {
  if (method !== 'PATCH' && method !== 'DELETE') return false
  return !String(restPath ?? '').includes('?')
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

export async function syncAll(options: { retryExhausted?: boolean } = {}): Promise<{ synced: number; failed: number }> {
  if (syncAllRunning) {
    console.log('[offline-sync] syncAll already running — skipping duplicate call')
    return { synced: 0, failed: 0 }
  }
  syncAllRunning = true
  try {
    if (options.retryExhausted) {
      const reset = await resetSyncQueueRetries()
      if (reset > 0) console.log(`[offline-sync] Reactivated ${reset} transient item(s) for a fresh connectivity cycle`)
    }
    return await _syncAllInner()
  } finally {
    syncAllRunning = false
  }
}

async function _syncAllInner(): Promise<{ synced: number; failed: number }> {
  const queue = await getPendingQueue()
  let synced = 0
  let failed = 0

  // BUG-019 / multi-day offline: refrescar la sesión ANTES de drenar. Si no hay
  // sesión válida (refresh token revocado tras días offline, o device sin login),
  // FAIL CLOSED: no drenar, preservar la cola, pedir re-login. Nunca replay con
  // anon (RLS lo rechazaría) ni pérdida de datos.
  const accessToken = queue.length > 0 ? await getFreshAccessToken() : null
  // Los terminales POS entran con PIN → shift token (NO crean sesión de Supabase
  // Auth). El replay APP_API va a /api/pos/save-order, cuyo withPOSAuth valida el
  // shift token igual que en el guardado online (verifyShiftToken primero). Sin
  // este fallback, un terminal con PIN nunca sube sus órdenes offline (getSession
  // = null → fail closed) — regresión de BUG-019. El shift token es credencial
  // válida server-side, así que replay con él es tan seguro como el save online.
  // Fail-closed solo si NO hay NINGÚN token (nunca replay anónimo).
  let shiftToken: string | null = null
  if (typeof window !== 'undefined') {
    try { shiftToken = localStorage.getItem('pos_shift_token') } catch {}
  }
  const appApiToken = accessToken || shiftToken
  if (queue.length > 0 && !appApiToken) {
    console.warn('[offline-sync] sin sesión ni shift token — replay pospuesto (fail closed), cola preservada')
    emitAuthRequired()
    return { synced: 0, failed: queue.length }
  }

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
        // Throttle: space out consecutive print-bearing syncs to prevent printer flooding
        if (synced > 0 || failed > 0) {
          await new Promise<void>(r => setTimeout(r, 400))
        }
        const result = await replayViaAppApi(item, appApiToken!)

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
        } else if (result.errorClass === 'AUTH_EXPIRED') {
          // Sesión expirada (403/401): detener el drenado YA — no tiene caso seguir
          // martillando 403s por cada item. PRESERVAR la cola (sin consumir reintentos
          // ni marcar terminal) y pedir re-PIN. Tras re-login, syncAll drena sola.
          console.warn('[offline-sync] Sesión expirada — replay pausado, se requiere re-PIN. Cola preservada.')
          emitAuthRequired()
          break
        } else if (result.errorClass === 'STALE_WRITE_CONFLICT') {
          // TERMINAL — preserve payload, mark conflict, NO retry, NO overwrite, NO direct PATCH
          console.error(`[offline-sync] ${result.detail}`)
          await markConflict(item.id, 'STALE_WRITE_CONFLICT', result.detail!, result.serverRevision)
          // MES-009: notify active POS page immediately so operator sees it (not just DevTools)
          if (typeof window !== 'undefined') {
            const itemOrderId = typeof (item.data as Record<string, unknown>).order_id === 'string'
              ? (item.data as Record<string, unknown>).order_id as string
              : undefined
            window.dispatchEvent(new CustomEvent('pos-order-conflict', {
              detail: { orderId: itemOrderId, errorDetail: result.detail, serverRevision: result.serverRevision }
            }))
          }
          failed++
        } else if (result.errorClass === 'TERMINAL_NON_RETRYABLE') {
          console.error(`[offline-sync] TERMINAL: ${result.detail}`)
          await markConflict(item.id, 'TERMINAL_NON_RETRYABLE', result.detail!)
          failed++
        } else {
          // TRANSIENT_RETRYABLE
          console.warn(`[offline-sync] Transient failure for ${item.endpoint}: ${result.detail}`)
          await incrementRetry(item.id, result.detail || 'TRANSIENT_RETRYABLE')
          failed++
        }
      } else {
        // ── SUPABASE_REST replay: datos no-orden (turnos, caja, estados KDS) ──
        // Dos caminos según la credencial disponible:
        //  - JWT de Supabase (dashboard): PostgREST directo con RLS tenant-scoped.
        //  - Shift token (terminal POS, sin sesión de Supabase): por el proxy
        //    autenticado /api/pos/db — MISMO camino que las escrituras online
        //    (supabase-fetch-patch). withPOSAuth valida el shift token e inyecta
        //    client_id. Antes esto se difería → en un terminal-PIN los turnos/caja/
        //    estados-KDS offline NUNCA subían (quedaban como "N pendientes" para
        //    siempre). Este es el cierre del gap.
        const restPath = item.endpoint || item.table
        // Falla cerrado: nunca se manda una mutacion que pueda tocar toda la tabla.
        // El payload se conserva para que un humano decida (ver markConflict).
        if (esMutacionSinFiltro(item.method, restPath)) {
          await markConflict(
            item.id,
            'TERMINAL_NON_RETRYABLE',
            `MUTACION_SIN_FILTRO: ${item.method} ${restPath} habria tocado toda la tabla`,
          )
          failed++
          continue
        }
        let url: string
        let reqHeaders: Record<string, string>
        if (accessToken) {
          url = `${SUPABASE_URL}/rest/v1/${restPath}`
          reqHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
        } else if (shiftToken) {
          const base = typeof window !== 'undefined' ? window.location.origin : ''
          url = `${base}/api/pos/db?path=${encodeURIComponent(restPath)}`
          reqHeaders = { Authorization: `Bearer ${shiftToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
        } else {
          await incrementRetry(item.id, 'NO_AUTH_TOKEN')
          failed++
          continue
        }

        let sessionActor = ''
        // Legacy/offline events could be queued before the staff name hydrated,
        // leaving actor=null. pos_audit_log.actor is NOT NULL, so those events
        // otherwise exhaust retries forever. Repair metadata only; preserve the
        // action, order, mesa and details exactly as queued.
        if (item.table === 'pos_audit_log' && typeof window !== 'undefined') {
          try {
            const staff = JSON.parse(sessionStorage.getItem('pos_staff') || '{}')
            if (typeof staff?.name === 'string') sessionActor = staff.name
          } catch {}
        }
        const replayData = repairReplayData(item.table, item.data, sessionActor)

        const res = await fetch(url, {
          method: item.method,
          headers: reqHeaders,
          body: item.method !== 'DELETE' ? JSON.stringify(replayData) : undefined,
        })
        if (res.ok) {
          await markSynced(item.id)
          synced++
        } else if (res.status === 409) {
          // For non-reconciliation-relevant 409, mark as synced (data already exists)
          console.warn(`[offline-sync] 409 on ${item.table} — already exists, marking synced`)
          await markSynced(item.id)
          synced++
        } else if (res.status === 401) {
          // 401 = sesión expirada (igual que APP_API): detener, preservar, pedir re-PIN.
          console.warn('[offline-sync] Sesión expirada en replay REST — se requiere re-PIN. Cola preservada.')
          emitAuthRequired()
          break
        } else if (res.status === 403) {
          // 403 = autenticado PERO no permitido — regla de negocio, NO sesión expirada.
          // Los 403 alcanzables por este camino vienen del proxy /api/pos/db:
          //   • 'manager required'   → pos_cash_movements / pos_cierres escritos por un
          //     staff no-gerente. El shift token lleva el rol del staff LOGUEADO, no el
          //     del gerente que tecleó su PIN para autorizar, así que una caja logueada
          //     como cajero lo dispara en CADA retiro/depósito y en CADA corte nocturno.
          //   • 'table not allowed'  → tabla fuera del allowlist del proxy.
          // Antes esto caía en la rama de arriba y hacía dos daños graves:
          //   1. `break` abortaba el drenado COMPLETO — todas las órdenes y cobros
          //      encolados DESPUÉS de ese item nunca subían (dinero perdido en la nube).
          //   2. `emitAuthRequired` deslogueaba al operador; al re-teclear el PIN se
          //      dispara syncAll de nuevo → mismo 403 → deslogueo otra vez, en bucle
          //      cada ~20s (el interval de autosync). La caja no podía cobrar.
          // Ahora se AÍSLA el item: se marca conflicto (el payload se preserva intacto)
          // y el drenado CONTINÚA con el resto de la cola.
          const errorBody = await res.text().catch(() => '')
          console.error(`[offline-sync] TERMINAL 403 en ${item.table} — regla de negocio, no sesión: ${errorBody}`)
          await markConflict(item.id, 'TERMINAL_NON_RETRYABLE', `HTTP 403${errorBody ? `: ${errorBody}` : ''}`)
          failed++
        } else {
          const errorBody = await res.text().catch(() => '')
          await incrementRetry(item.id, `HTTP ${res.status}${errorBody ? `: ${errorBody}` : ''}`)
          failed++
        }
      }
    } catch (error) {
      // Network error — transient retryable
      await incrementRetry(item.id, error instanceof Error ? error.message : 'NETWORK_ERROR')
      failed++
    }
  }

  // Clean up old synced items
  await clearSyncedItems()
  return { synced, failed }
}

// ─── Modifier Cache (v2) ─────────────────────────────────────────────────────

export async function cacheModifierData(
  groups: Record<string, unknown>[],
  mods: Record<string, unknown>[],
  links: Record<string, unknown>[],
): Promise<void> {
  // Validación de ESCRITURA (defensa en profundidad): solo persistir registros con
  // la FORMA esperada de cada store. Si un caller pasa datos de otra tabla (p.ej.
  // staff/meseros), NO entran a la caché de modificadores. PostgREST devuelve las
  // columnas del SELECT como keys aun si el valor es null, así que la presencia de
  // la key discrimina de forma confiable (un mesero no tiene 'max_selections').
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
  const validGroups = groups.filter(g => isObj(g) && 'id' in g && 'max_selections' in g)
  const validMods   = mods.filter(m => isObj(m) && 'id' in m && 'group_id' in m && 'price' in m)
  const validLinks  = links.filter(l => isObj(l) && 'id' in l && 'group_id' in l)

  const db = await openDB()
  const stores = ['modifier_groups', 'modifiers', 'item_modifier_links'] as const
  const data = [validGroups, validMods, validLinks]
  for (let i = 0; i < stores.length; i++) {
    // No sobrescribir con vacío: una respuesta transitoria vacía (red degradada)
    // NO debe borrar la caché buena. Solo reemplazamos si hay datos válidos.
    if (data[i].length === 0) continue
    const tx = db.transaction(stores[i], 'readwrite')
    const store = tx.objectStore(stores[i])
    store.clear()
    for (const item of data[i]) store.put(item)
  }
  const metaTx = db.transaction('meta', 'readwrite')
  metaTx.objectStore('meta').put({ key: 'modifiers_cached_at', value: new Date().toISOString() })
}

export async function getCachedModifierGroups(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('modifier_groups', 'readonly')
    const req = tx.objectStore('modifier_groups').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

export async function getCachedModifiers(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('modifiers', 'readonly')
    const req = tx.objectStore('modifiers').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

export async function getCachedItemModifierLinks(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('item_modifier_links', 'readonly')
    const req = tx.objectStore('item_modifier_links').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

// ─── Payment Methods Cache (v2) ───────────────────────────────────────────────

export async function cachePaymentMethods(methods: Record<string, unknown>[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('payment_methods', 'readwrite')
  const store = tx.objectStore('payment_methods')
  store.clear()
  for (const m of methods) store.put(m)
  const metaTx = db.transaction('meta', 'readwrite')
  metaTx.objectStore('meta').put({ key: 'payment_methods_cached_at', value: new Date().toISOString() })
}

export async function getCachedPaymentMethods(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('payment_methods', 'readonly')
    const req = tx.objectStore('payment_methods').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

// ─── Staff Cache (v2) ─────────────────────────────────────────────────────────

export async function cacheStaff(staff: Record<string, unknown>[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('staff', 'readwrite')
  const store = tx.objectStore('staff')
  store.clear()
  for (const s of staff) store.put(s)
}

export async function getCachedStaff(): Promise<Record<string, unknown>[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('staff', 'readonly')
    const req = tx.objectStore('staff').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

// ─── Field escape hatch: reset the read-only reference caches ─────────────────
// Limpia SOLO las cachés de REFERENCIA que pueden quedar viejas/corruptas (menú,
// modificadores, métodos de pago, staff, inventario). NUNCA toca sync_queue,
// orders, turnos ni cash_movements — esos guardan datos operativos SIN sincronizar
// que jamás deben perderse. Tras limpiar, un prefetch online los repuebla. Es el
// botón "Actualizar datos offline" para que un gerente recupere sin DevTools.
export async function resetOfflineReferenceCaches(): Promise<void> {
  const db = await openDB()
  const REFERENCE_STORES = ['menu', 'modifier_groups', 'modifiers', 'item_modifier_links', 'payment_methods', 'staff', 'inventory'] as const
  for (const name of REFERENCE_STORES) {
    try {
      const tx = db.transaction(name, 'readwrite')
      tx.objectStore(name).clear()
    } catch { /* el store puede no existir en un DB viejo — ignorar */ }
  }
}

// ─── Orders by Turno ────────────────────────────────────────────────────────

export async function getCachedOrdersByTurno(turnoId: string): Promise<Record<string, unknown>[]> {
  const all = await getCachedOrders()
  return all.filter(o => o.turno_id === turnoId)
}

// ─── Cash Movements by Turno ─────────────────────────────────────────────────
// Reads from both the cash_movements IDB store and the sync_queue (for queued offline moves).

export async function cacheCashMovement(movement: Record<string, unknown>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('cash_movements', 'readwrite')
  tx.objectStore('cash_movements').put(movement)
}

export async function getCachedCashMovsByTurno(turnoId: string): Promise<{ type: string; amount: number }[]> {
  const db = await openDB()
  // Read from cash_movements store (write-through cache: online success + offline)
  const synced: { id: string; type: string; amount: number }[] = await new Promise((resolve) => {
    const tx = db.transaction('cash_movements', 'readonly')
    const req = tx.objectStore('cash_movements').index('turno_id').getAll(IDBKeyRange.only(turnoId))
    req.onsuccess = () => resolve((req.result || []).map((m: Record<string, unknown>) => ({ id: String(m.id ?? ''), type: m.type as string, amount: Number(m.amount) || 0 })))
    req.onerror = () => resolve([])
  })
  // Also check sync_queue for unsynced cash movements, DEDUP por id: un movimiento
  // offline ahora vive en el cache write-through Y en la cola hasta sincronizar;
  // sin dedup se contaria doble en el arqueo. (P0 dinero)
  const seen = new Set(synced.map(m => m.id).filter(Boolean))
  const pending = await getPendingQueue()
  const queued = pending
    .filter(item => item.table === 'pos_cash_movements' && (item.data as Record<string, unknown>).turno_id === turnoId)
    .map(item => ({
      id: String((item.data as Record<string, unknown>).id ?? ''),
      type: (item.data as Record<string, unknown>).type as string,
      amount: Number((item.data as Record<string, unknown>).amount) || 0,
    }))
    .filter(m => !m.id || !seen.has(m.id))
  return [...synced, ...queued].map(({ type, amount }) => ({ type, amount }))
}

// ─── Print Jobs (IDB v4) — durable backup for print-queue.ts localStorage ───

export interface IDBPrintJob {
  id: string
  station: string
  data: string
  type: string
  status: string
  retries: number
  maxRetries: number
  createdAt: string
  lastAttempt: string | null
  error: string | null
  meta?: { mesa?: number; mesero?: string; orderId?: string }
}

export async function saveIDBPrintJob(job: IDBPrintJob): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('print_jobs', 'readwrite')
    tx.objectStore('print_jobs').put(job)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getIDBPrintJobs(): Promise<IDBPrintJob[]> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('print_jobs', 'readonly')
    const req = tx.objectStore('print_jobs').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

export async function deleteIDBPrintJob(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('print_jobs', 'readwrite')
    tx.objectStore('print_jobs').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearIDBPrintedJobs(): Promise<void> {
  const db = await openDB()
  const jobs = await getIDBPrintJobs()
  const printed = jobs.filter(j => j.status === 'printed')
  const tx = db.transaction('print_jobs', 'readwrite')
  const store = tx.objectStore('print_jobs')
  for (const j of printed) store.delete(j.id)
}

// ─── Turno (Shift) Offline Support ──────────────────────────────────────────
// Turnos are cached locally so shifts can open/close without internet.
// The authoritative UUID is generated client-side with crypto.randomUUID()
// so it never changes during sync — no identity swap.

export interface CachedTurno {
  id: string
  client_id: string
  opened_by: string
  fondo_inicial: number
  opened_at: string
  closed_at?: string
  fondo_cierre?: number
  notas?: string
  synced_at?: string      // set when successfully pushed to Supabase
}

export async function cacheTurno(turno: CachedTurno): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turnos', 'readwrite')
    tx.objectStore('turnos').put(turno)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCachedActiveTurno(clientId: string): Promise<CachedTurno | null> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction('turnos', 'readonly')
    const idx = tx.objectStore('turnos').index('client_id')
    const req = idx.getAll(IDBKeyRange.only(clientId))
    req.onsuccess = () => {
      const all: CachedTurno[] = req.result || []
      // active = no closed_at
      const active = all.find(t => !t.closed_at) || null
      resolve(active)
    }
    req.onerror = () => resolve(null)
  })
}

export async function closeCachedTurno(
  id: string,
  fondoCierre: number,
  notas?: string
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turnos', 'readwrite')
    const store = tx.objectStore('turnos')
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const turno: CachedTurno = getReq.result
      if (!turno) { resolve(); return }
      turno.closed_at = new Date().toISOString()
      turno.fondo_cierre = fondoCierre
      if (notas) turno.notas = notas
      store.put(turno)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

export async function markTurnoSynced(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turnos', 'readwrite')
    const store = tx.objectStore('turnos')
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const turno: CachedTurno = getReq.result
      if (!turno) { resolve(); return }
      turno.synced_at = new Date().toISOString()
      store.put(turno)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

// ─── PER-01: drain localStorage emergency buffer into IDB ────────────────────
// localStorage is the emergency fallback when IDB is unavailable mid-operation.
// Items written there are invisible to syncAll(). On every startup, we drain
// them into IDB so they enter the canonical sync queue and are never silently lost.
//
// Idempotent: safe to call multiple times. Clears localStorage only after every
// item has been successfully written to IDB (all-or-nothing, per item).
export async function drainLocalStorageToIdb(): Promise<void> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  const LS_KEY = 'fullsite_offline_queue'
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const items: Record<string, unknown>[] = JSON.parse(raw)
    const unsynced = items.filter(i => !i.synced)
    if (!unsynced.length) { localStorage.removeItem(LS_KEY); return }

    let allOk = true
    for (const item of unsynced) {
      try {
        const method = (item.method as string | undefined) || 'PATCH'
        await queueOperation(
          (item.table as string) || 'pos_orders',
          method as 'POST' | 'PATCH' | 'DELETE',
          (item.data as Record<string, unknown>) || {},
          (item.endpoint as string | undefined),
          undefined,
          (item.transport as ReplayTransport | undefined),
        )
      } catch {
        allOk = false
      }
    }

    if (allOk) {
      localStorage.removeItem(LS_KEY)
      console.log(`[offline-sync] Drained ${unsynced.length} item(s) from localStorage to IDB sync_queue`)
    }
  } catch (e) {
    console.warn('[offline-sync] drainLocalStorageToIdb failed:', e)
  }
}

// ─── Auto-sync on reconnect ──────────────────────────────────────────────────
// When internet returns, automatically sync pending operations.

let autoSyncRegistered = false
let isSyncing = false

export function registerAutoSync() {
  if (autoSyncRegistered || typeof window === 'undefined') return
  autoSyncRegistered = true

  // Drain any emergency localStorage items into IDB before the first sync
  drainLocalStorageToIdb().catch(() => {})

  // 1. On reconnect: sync pending
  window.addEventListener('online', async () => {
    if (isSyncing) {
      console.log('[offline-sync] Sync already in progress — skipping')
      return
    }
    isSyncing = true
    console.log('[offline-sync] Internet restored — syncing pending operations...')
    try {
      const { synced, failed } = await syncAll({ retryExhausted: true })
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
          const { synced, failed } = await syncAll({ retryExhausted: true })
          console.log(`[offline-sync] Mount sync complete: ${synced} synced, ${failed} failed`)
          isSyncing = false
        }
      } catch {
        isSyncing = false
      }
    }, 2000) // small delay to let the app initialize
  }

  // 3. Periodic safety net. El evento 'online' es poco confiable: puede NO
  //    dispararse en cada reconexión (quirk del navegador), dejando órdenes
  //    offline atoradas hasta una recarga manual. Cada 20s, si hay red y quedan
  //    items ACCIONABLES (no synced, no terminal, no agotados en reintentos),
  //    drena la cola. Garantiza que las comandas offline suban solas.
  setInterval(async () => {
    if (isSyncing || !navigator.onLine) return
    try {
      const queue = await getPendingQueue(true) // excluye terminales (error_class)
      const actionable = queue.filter(i => (i.retries ?? 0) < 5)
      if (actionable.length === 0) return
      isSyncing = true
      const { synced, failed } = await syncAll()
      if (synced > 0 || failed > 0) {
        console.log(`[offline-sync] Periodic sync: ${synced} synced, ${failed} failed`)
      }
    } catch {
      /* transitorio — el siguiente tick reintenta */
    } finally {
      isSyncing = false
    }
  }, 20000)
}
