// Suite offline del lado BROWSER — valida la capa IndexedDB del POS (pos-offline-db)
// con fake-indexeddb. Es la "otra mitad" del offline: lo que el navegador cachea y
// encola cuando no hay internet. Complementa la suite del local-server (Node).
//
// NO cubre (necesita hardware/browser real): service worker en el device, boot de
// Electron, red LAN. Cubre: cache de menú/órdenes/turno/pagos, la cola de sync
// (queue → mark synced → clear), y retries — la lógica de escritura offline.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  cacheMenu, getCachedMenu,
  cacheOrder, getCachedOrders, deleteCachedOrder,
  queueOperation, getPendingQueue, markSynced, incrementRetry, clearSyncedItems, getSyncQueueSummary,
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
})

describe('pos-offline-db — cola de sync (el corazón del offline)', () => {
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
    await incrementRetry(id)
    await incrementRetry(id)
    const item = (await getPendingQueue()).find((i) => i.id === id)
    expect(item?.retries).toBe(2)
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
