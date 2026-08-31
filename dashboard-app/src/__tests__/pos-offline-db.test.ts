// Suite offline del lado BROWSER — valida la capa IndexedDB del POS (pos-offline-db)
// con fake-indexeddb. Es la "otra mitad" del offline: lo que el navegador cachea y
// encola cuando no hay internet. Complementa la suite del local-server (Node).
//
// NO cubre (necesita hardware/browser real): service worker en el device, boot de
// Electron, red LAN. Cubre: cache de menú/órdenes/turno/pagos, la cola de sync
// (queue → mark synced → clear), y retries — la lógica de escritura offline.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  cacheMenu, getCachedMenu,
  cacheOrder, getCachedOrders, getCachedActiveOrders, reconcileCachedActiveOrders, deleteCachedOrder,
  warmActiveOrdersCache,
  clearLocalOrderData,
  queueOperation, getPendingQueue, markSynced, incrementRetry, clearSyncedItems, getSyncQueueSummary,
  getSyncQueueDiagnostics, resolveSyncConflictKeepServer, resolveSyncConflictApplyLocal,
  repairReplayData,
  cacheTurno, getCachedActiveTurno, closeCachedTurno,
  cachePaymentMethods, getCachedPaymentMethods,
  cacheStaff, getCachedStaff,
  cacheInventory, getCachedInventory,
  cacheCashMovement, getCachedCashMovsByTurno,
} from '@/lib/pos-offline-db'

// DB fresca por test (aislamiento total)
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('pos-offline-db — cache de catálogos (lectura offline)', () => {
  it('menú: round-trip cache → get', async () => {
    await cacheMenu([{ id: 'g1', name: 'Chilaquiles' }, { id: 'g2', name: 'Café' }])
    const menu = await getCachedMenu()
    expect(menu.length).toBe(2)
    expect(menu.map((m) => m.id).sort()).toEqual(['g1', 'g2'])
  })

  it('formas de pago, staff e inventario: round-trip', async () => {
    await cachePaymentMethods([{ id: 'p1', name: 'Efectivo' }])
    await cacheStaff([{ id: 's1', name: 'Ana', pin: '1234' }])
    await cacheInventory([{ ingredient_id: 'i1', name: 'Aguacate', stock: 10 }])
    expect((await getCachedPaymentMethods()).length).toBe(1)
    expect((await getCachedStaff())[0].name).toBe('Ana')
    expect((await getCachedInventory())[0].ingredient_id).toBe('i1')
  })
})

describe('pos-offline-db — órdenes offline', () => {
  it('guarda una orden offline y la lee; luego la borra', async () => {
    await cacheOrder({ id: 'o1', mesa: '5', status: 'enviada', items: [{ n: 'taco' }] })
    let orders = await getCachedOrders()
    expect(orders.find((o) => o.id === 'o1')).toBeTruthy()
    await deleteCachedOrder('o1')
    orders = await getCachedOrders()
    expect(orders.find((o) => o.id === 'o1')).toBeFalsy()
  })

  it('el mapa offline nunca pinta órdenes cerradas o canceladas como mesas ocupadas', async () => {
    await cacheOrder({ id: 'activa', client_id: 'amalay', mesa: 4, status: 'enviada', updated_at: '2026-08-31T01:00:00Z' })
    await cacheOrder({ id: 'cerrada', client_id: 'amalay', mesa: 5, status: 'cerrada', updated_at: '2026-08-31T02:00:00Z' })
    await cacheOrder({ id: 'cancelada', client_id: 'amalay', mesa: 6, status: 'cancelada', updated_at: '2026-08-31T03:00:00Z' })

    const active = await getCachedActiveOrders('amalay')

    expect(active.map(order => order.id)).toEqual(['activa'])
  })

  it('reconciliación elimina ocupaciones fantasma pero preserva una orden offline pendiente', async () => {
    await cacheOrder({ id: 'fantasma', client_id: 'amalay', mesa: 1, status: 'enviada' })
    await cacheOrder({ id: 'pendiente-local', client_id: 'amalay', mesa: 2, status: 'enviada' })
    await cacheOrder({ id: 'historial', client_id: 'amalay', mesa: 3, status: 'cerrada' })

    await reconcileCachedActiveOrders(
      [{ id: 'servidor', client_id: 'amalay', mesa: 4, status: 'preparando' }],
      'amalay',
      ['pendiente-local'],
    )

    const all = await getCachedOrders()
    expect(all.map(order => order.id).sort()).toEqual(['historial', 'pendiente-local', 'servidor'])
    expect((await getCachedActiveOrders('amalay')).map(order => order.id).sort()).toEqual(['pendiente-local', 'servidor'])
  })

  it('limpieza total purga órdenes y su replay, pero conserva operaciones de caja', async () => {
    const memory = new Map<string, string>([
      ['pos_order_4', '{"items":[1]}'], ['pos_draft_9', '{"items":[2]}'],
      ['pos_mesas_orders', '{}'], ['pos_print_queue', '[{"id":"print-1"}]'],
      ['fullsite_offline_queue', JSON.stringify([
        { table: 'pos_orders', data: { id: 'o1' } },
        { table: 'pos_cash_movements', data: { id: 'cash-1' } },
      ])],
    ])
    const storage = {
      get length() { return memory.size },
      key: (i: number) => [...memory.keys()][i] ?? null,
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => { memory.set(k, v) },
      removeItem: (k: string) => { memory.delete(k) },
    } as Storage
    await cacheOrder({ id: 'o1', mesa: 4 })
    await queueOperation('pos_orders', 'POST', { id: 'o1' })
    await queueOperation('pos_audit_log', 'POST', { order_id: 'o1' })
    await queueOperation('pos_cash_movements', 'POST', { id: 'cash-1' })

    await clearLocalOrderData(storage)

    expect(await getCachedOrders()).toEqual([])
    expect((await getPendingQueue()).map(item => item.table)).toEqual(['pos_cash_movements'])
    expect(memory.has('pos_order_4')).toBe(false)
    expect(memory.has('pos_draft_9')).toBe(false)
    expect(memory.has('pos_mesas_orders')).toBe(false)
    expect(memory.has('pos_print_queue')).toBe(true)
    expect(JSON.parse(memory.get('fullsite_offline_queue') || '[]')).toEqual([
      { table: 'pos_cash_movements', data: { id: 'cash-1' } },
    ])
  })
})

describe('pos-offline-db — cola de sync (el corazón del offline)', () => {
  async function classify(id: string, errorClass: string, serverRevision?: number) {
    const req = indexedDB.open('fullsite_pos', 4)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite')
      const store = tx.objectStore('sync_queue')
      const get = store.get(id)
      get.onsuccess = () => store.put({ ...get.result, error_class: errorClass, server_revision: serverRevision, conflict: true })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }

  it('encola una operación → aparece pendiente → markSynced la saca', async () => {
    const id = await queueOperation('pos_orders', 'POST', { id: 'o1', total: 100 }, '/api/pos/save-order')
    let pending = await getPendingQueue()
    expect(pending.length).toBe(1)
    expect(pending[0].table).toBe('pos_orders')
    expect(pending[0].synced).toBe(false)

    await markSynced(id)
    pending = await getPendingQueue()
    expect(pending.length).toBe(0)   // ya no cuenta como pendiente
  })

  it('acumula varias operaciones offline y las drena', async () => {
    await queueOperation('pos_orders', 'POST', { id: 'o1' })
    await queueOperation('pos_orders', 'POST', { id: 'o2' })
    const id3 = await queueOperation('pos_cash_movements', 'POST', { id: 'c1' })
    expect((await getPendingQueue()).length).toBe(3)

    const summary = await getSyncQueueSummary()
    expect(summary.pending).toBeGreaterThan(0)

    // sincroniza todas → limpia las synced
    for (const it of await getPendingQueue()) await markSynced(it.id)
    void id3
    expect((await getPendingQueue()).length).toBe(0)
    await clearSyncedItems()
    // tras limpiar, el store no debe tener basura pendiente
    expect((await getPendingQueue()).length).toBe(0)
  })

  it('incrementRetry sube el contador (para backoff)', async () => {
    const id = await queueOperation('pos_orders', 'POST', { id: 'o1' })
    await incrementRetry(id, 'HTTP 400: schema mismatch')
    await incrementRetry(id)
    const item = (await getPendingQueue()).find((i) => i.id === id)
    expect(item?.retries).toBe(2)
    expect(item?.error_detail).toBe('HTTP 400: schema mismatch')
  })

  it('conservar nube elimina únicamente el conflicto elegido', async () => {
    const conflictId = await queueOperation('pos_orders', 'POST', { order_id: 'o1', mesa: 4 })
    await queueOperation('pos_audit_log', 'POST', { action: 'test' })
    await classify(conflictId, 'TERMINAL_NON_RETRYABLE')

    expect(await resolveSyncConflictKeepServer(conflictId)).toBe(true)
    const left = await getPendingQueue()
    expect(left).toHaveLength(1)
    expect(left[0].table).toBe('pos_audit_log')
  })

  it('aplicar local rebasa revisión, rota idempotency key y conserva payload', async () => {
    const id = await queueOperation('pos_orders', 'POST', {
      order_id: 'o4', mesa: 4, status: 'cerrada', total: 250,
      expected_revision: 1, save_operation_id: 'rejected-op',
    }, '/api/pos/save-order')
    await classify(id, 'STALE_WRITE_CONFLICT', 2)

    const before = (await getPendingQueue())[0]
    expect(await resolveSyncConflictApplyLocal(id, 'manager-token', 'Gerente')).toBe(true)
    const after = (await getPendingQueue())[0]
    expect(after.data.expected_revision).toBe(2)
    expect(after.data.save_operation_id).not.toBe(before.data.save_operation_id)
    expect(after.data.total).toBe(250)
    expect(after.data.conflict_resolution).toBe(true)
    expect(after.error_class).toBeUndefined()
    expect((await getSyncQueueDiagnostics())[0].errorClass).toBe('PENDING')
  })

  it('repara actor nulo de auditoría sin alterar el resto del evento', () => {
    const event = { action: 'item_added', actor: null, mesa: 4, details: '{"item":"agua"}' }
    expect(repairReplayData('pos_audit_log', event, 'Daniel')).toEqual({ ...event, actor: 'Daniel' })
    expect(repairReplayData('pos_audit_log', event).actor).toBe('POS Offline')
    expect(repairReplayData('pos_orders', event)).toBe(event)
  })
})

describe('pos-offline-db — turno offline', () => {
  it('abre turno, lo lee como activo, lo cierra → deja de estar activo', async () => {
    const turno = {
      id: 'T1', client_id: 'amalay', opened_by: 's1',
      fondo_inicial: 500, opened_at: new Date().toISOString(),
    }
    await cacheTurno(turno)
    const active = await getCachedActiveTurno('amalay')
    expect(active?.id).toBe('T1')

    await closeCachedTurno('T1', 1200, 'cierre de prueba')
    const afterClose = await getCachedActiveTurno('amalay')
    expect(afterClose).toBeNull()   // ya no hay turno activo
  })

  it('aísla turnos por cliente (no cruza tenants)', async () => {
    await cacheTurno({ id: 'TA', client_id: 'amalay', opened_by: 's1', fondo_inicial: 0, opened_at: new Date().toISOString() })
    await cacheTurno({ id: 'TB', client_id: 'otro-cliente', opened_by: 's2', fondo_inicial: 0, opened_at: new Date().toISOString() })
    expect((await getCachedActiveTurno('amalay'))?.id).toBe('TA')
    expect((await getCachedActiveTurno('otro-cliente'))?.id).toBe('TB')
  })
})

describe('pos-offline-db — movimientos de efectivo (respaldan el fix del Corte X offline)', () => {
  it('round-trip de movimientos cacheados por turno', async () => {
    await cacheCashMovement({ id: 'm1', turno_id: 'T1', type: 'retiro', amount: 100 })
    await cacheCashMovement({ id: 'm2', turno_id: 'T1', type: 'deposito', amount: 50 })
    await cacheCashMovement({ id: 'm3', turno_id: 'OTRO', type: 'retiro', amount: 999 })
    const movs = await getCachedCashMovsByTurno('T1')
    expect(movs.length).toBe(2)                         // no cruza turnos
    expect(movs.reduce((s, m) => s + m.amount, 0)).toBe(150)
  })

  it('combina cacheados + los que siguen en la cola de sync (creados offline)', async () => {
    await cacheCashMovement({ id: 'm1', turno_id: 'T1', type: 'retiro', amount: 100 })
    // movimiento creado offline: aún en la cola de sync, no persistido
    await queueOperation('pos_cash_movements', 'POST', { id: 'm2', turno_id: 'T1', type: 'deposito', amount: 50 })
    const movs = await getCachedCashMovsByTurno('T1')
    expect(movs.length).toBe(2)                         // cacheado + encolado
    expect(movs.some((m) => m.type === 'deposito' && m.amount === 50)).toBe(true)
  })
})


// ─── T-26: el mapa de mesas dice la VERDAD tras un arranque en frio ──────────
//
// Campo AMALAY 2026-08-31, terminal Entrada: el plano salio perfecto (33 mesas,
// distribucion correcta) con las 15 mesas ocupadas marcadas "Disponible". La
// matriz ya cubria que el mesero pudiera ENTRAR sin red (T-24) y que apareciera
// el PLANO (T-25) — nadie cubria que ese plano dijera la verdad.
//
// El riesgo de este calentamiento no es que no caliente: es que BORRE. Reconciliar
// elimina del cache toda orden activa ausente del snapshot del servidor, y una
// orden creada offline todavia esta subiendo. Por eso casi todas estas pruebas
// son de la rama de falla.

const ORDENES_SERVIDOR = [
  { id: 'srv-1', client_id: 'amalay', mesa: 1, status: 'enviada', total: 725 },
  { id: 'srv-2', client_id: 'amalay', mesa: 8, status: 'enviada', total: 713.4 },
]

function fetchOk(rows: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }))
}

beforeEach(() => {
  // Sin esto warmActiveOrdersCache sale por 'skipped' y las pruebas no ejercitan nada.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba'
})

// restoreAllMocks NO deshace stubGlobal. Sin unstubAllGlobals, un
// navigator.onLine=false se filtraba a los tests siguientes y los hacia pasar por
// la rama equivocada — pasaban en verde probando otra cosa. Aplica a toda la suite.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('T-26 — calentar el mapa de mesas al entrar con red', () => {
  it('deja las mesas ocupadas en cache para el proximo arranque sin red', async () => {
    vi.stubGlobal('fetch', fetchOk(ORDENES_SERVIDOR))
    expect(await warmActiveOrdersCache('amalay')).toBe('ok')

    const cached = await getCachedActiveOrders('amalay')
    expect(cached.map(o => o.mesa).sort()).toEqual([1, 8])
  })

  it('REGRESION: una orden encolada offline NO se borra al calentar', async () => {
    // La mesa 20 se levanto sin red: esta en la cola, todavia no en el servidor.
    // Si el calentamiento la borra, la mesa se ve libre y se pierde la cuenta.
    await cacheOrder({ id: 'local-20', client_id: 'amalay', mesa: 20, status: 'enviada', total: 603.2 })
    await queueOperation('pos_orders', 'POST', { order_id: 'local-20', mesa: 20, status: 'enviada' })

    vi.stubGlobal('fetch', fetchOk(ORDENES_SERVIDOR))
    expect(await warmActiveOrdersCache('amalay')).toBe('ok')

    const mesas = (await getCachedActiveOrders('amalay'))
      .map(o => o.mesa as number)
      .sort((a, b) => a - b)
    expect(mesas).toContain(20)          // la encolada sobrevive
    expect(mesas).toEqual([1, 8, 20])    // y ademas llegaron las del servidor
  })

  it('sin red no toca el cache — devuelve offline', async () => {
    await cacheOrder({ id: 'viejo', client_id: 'amalay', mesa: 5, status: 'enviada', total: 100 })
    vi.stubGlobal('navigator', { onLine: false })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(await warmActiveOrdersCache('amalay')).toBe('offline')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await getCachedActiveOrders('amalay')).length).toBe(1)
  })

  it('si el servidor responde error, NO vacia el cache que ya habia', async () => {
    await cacheOrder({ id: 'viejo', client_id: 'amalay', mesa: 5, status: 'enviada', total: 100 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    expect(await warmActiveOrdersCache('amalay')).toBe('error')
    expect((await getCachedActiveOrders('amalay')).length).toBe(1)
  })

  it('si la red se cae a medio fetch, tampoco vacia el cache', async () => {
    await cacheOrder({ id: 'viejo', client_id: 'amalay', mesa: 5, status: 'enviada', total: 100 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await warmActiveOrdersCache('amalay')).toBe('error')
    expect((await getCachedActiveOrders('amalay')).length).toBe(1)
  })

  it('sin client_id no hace nada — nunca escribe sin tenant', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await warmActiveOrdersCache('')).toBe('skipped')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('una respuesta que no es lista se rechaza en vez de borrar todo', async () => {
    await cacheOrder({ id: 'viejo', client_id: 'amalay', mesa: 5, status: 'enviada', total: 100 })
    vi.stubGlobal('fetch', fetchOk({ error: 'jwt expired' }))

    expect(await warmActiveOrdersCache('amalay')).toBe('error')
    expect((await getCachedActiveOrders('amalay')).length).toBe(1)
  })

  it('el escenario de AMALAY: cache frio + login con red = mapa con la verdad', async () => {
    // Cache vacio, como quedo Entrada tras la limpieza de storage.
    expect((await getCachedActiveOrders('amalay')).length).toBe(0)

    vi.stubGlobal('fetch', fetchOk(ORDENES_SERVIDOR))
    await warmActiveOrdersCache('amalay')

    // Ahora, ya sin red, el mapa tiene con que pintar.
    vi.stubGlobal('navigator', { onLine: false })
    const cached = await getCachedActiveOrders('amalay')
    expect(cached.length).toBe(2)
    expect(cached.map(o => o.total).sort((a, b) => (a as number) - (b as number))).toEqual([713.4, 725])
  })
})
