// Matriz offline — T-01: internet cae durante una venta activa.
//
// Es el escenario que de verdad importa: hay gente sentada, la comanda está a medias,
// y se cae el internet. Lo que NO puede pasar es perder la orden o el cobro.
//
// Validado en campo el 2026-08-24 04:03-04:07 en AMALAY (caja, WiFi apagado):
//   "se manda y se imprime super bien! nice! todo ya jalando en caja!"
//   "si sale en kds 3 confirmo 4 tambien confirmo y 5 confirmisimo!"
// Ver docs/offline/EVIDENCIA-CAMPO-AMALAY-2026-08-24.md
//
// Esta suite convierte ese camino en algo que corre en CI. Cubre la capa de escritura
// offline: que la orden viva en IDB, que el cobro entre a la cola, y que nada se pierda
// cuando vuelve la red. Lo que NO cubre y sigue necesitando la caja física: el Service
// Worker sirviendo el shell, el WS al KDS por LAN, y la impresora térmica.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  cacheOrder, getCachedOrders, deleteCachedOrder,
  queueOperation, getPendingQueue, markSynced, getSyncQueueSummary,
  cacheCashMovement, getCachedCashMovsByTurno,
} from '@/lib/pos-offline-db'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('T-01 · la venta sigue viva sin internet', () => {
  it('la orden se guarda localmente y se puede releer', async () => {
    await cacheOrder({
      id: 'ord-mesa-7', mesa: 7, status: 'abierta', total: 480,
      items: [{ nombre: 'Arrachera', cantidad: 1 }, { nombre: 'Agua', cantidad: 2 }],
    })

    const ordenes = await getCachedOrders()
    const mesa7 = ordenes.find(o => o.id === 'ord-mesa-7')
    expect(mesa7, 'sin esto, el mesero pierde la mesa al caerse la red').toBeDefined()
    expect(mesa7?.total).toBe(480)
  })

  it('agregar un ítem con la red caída no pierde los anteriores', async () => {
    await cacheOrder({ id: 'ord-1', mesa: 3, status: 'abierta', total: 200,
      items: [{ nombre: 'Café', cantidad: 1 }] })
    // Se cae el internet. El mesero agrega una bebida.
    await cacheOrder({ id: 'ord-1', mesa: 3, status: 'abierta', total: 260,
      items: [{ nombre: 'Café', cantidad: 1 }, { nombre: 'Jugo', cantidad: 1 }] })

    const ordenes = await getCachedOrders()
    const orden = ordenes.find(o => o.id === 'ord-1')
    expect(orden?.items).toHaveLength(2)
    expect(orden?.total, 'el total debe reflejar lo agregado offline').toBe(260)
    expect(ordenes.filter(o => o.id === 'ord-1'),
      'actualizar no puede duplicar la mesa en el mapa').toHaveLength(1)
  })

  it('EL CASO QUE DUELE: el cobro offline entra a la cola, no se evapora', async () => {
    await queueOperation('pos_orders', 'PATCH',
      { id: 'ord-1', status: 'cerrada', total: 260, metodo_pago: 'efectivo' })

    const cola = await getPendingQueue()
    expect(cola.length, 'un cobro que no se encola es dinero que el restaurante no ve').toBe(1)
    expect(cola[0].method).toBe('PATCH')
  })

  it('el movimiento de caja también sobrevive', async () => {
    await cacheCashMovement({
      id: 'mov-1', turno_id: 'turno-1', type: 'venta', amount: 260, created_at: new Date().toISOString(),
    })

    const movs = await getCachedCashMovsByTurno('turno-1')
    expect(movs.length, 'sin esto el corte de caja no cuadra al día siguiente').toBe(1)
    expect(movs[0].amount).toBe(260)
  })

  it('P0 DINERO: un movimiento offline vive en caché Y en la cola — no puede contarse doble', async () => {
    // Así queda un cobro offline: escrito al caché write-through Y encolado para sync.
    await cacheCashMovement({
      id: 'mov-1', turno_id: 'turno-1', type: 'venta', amount: 260, created_at: new Date().toISOString(),
    })
    await queueOperation('pos_cash_movements', 'POST',
      { id: 'mov-1', turno_id: 'turno-1', type: 'venta', amount: 260 })

    const movs = await getCachedCashMovsByTurno('turno-1')
    const total = movs.reduce((s, m) => s + m.amount, 0)

    expect(movs.length, 'el mismo movimiento en dos lados debe leerse UNA vez').toBe(1)
    expect(total, 'contarlo doble infla el arqueo y el corte cierra con sobrante fantasma').toBe(260)
  })

  it('varias mesas offline al mismo tiempo no se pisan', async () => {
    await cacheOrder({ id: 'o-4', mesa: 4, status: 'abierta', total: 100, items: [] })
    await cacheOrder({ id: 'o-9', mesa: 9, status: 'abierta', total: 700, items: [] })
    await cacheOrder({ id: 'o-12', mesa: 12, status: 'abierta', total: 350, items: [] })

    const ordenes = await getCachedOrders()
    expect(ordenes.map(o => o.mesa).sort((a, b) => (a as number) - (b as number))).toEqual([4, 9, 12])
  })
})

describe('T-01 · vuelve el internet', () => {
  it('lo encolado offline se ve como pendiente hasta que sincroniza', async () => {
    await queueOperation('pos_orders', 'PATCH', { id: 'o-1', status: 'cerrada' })
    await queueOperation('pos_orders', 'PATCH', { id: 'o-2', status: 'cerrada' })

    const antes = await getSyncQueueSummary()
    expect(antes.pending, 'el operador tiene que poder VER cuántas faltan').toBe(2)
  })

  it('marcar sincronizado saca de pendientes — así llega a cero', async () => {
    await queueOperation('pos_orders', 'PATCH', { id: 'o-1', status: 'cerrada' })
    const cola = await getPendingQueue()
    await markSynced(cola[0].id as string)

    const despues = await getSyncQueueSummary()
    expect(despues.pending,
      'en campo la cola se quedó atorada en 5; llegar a 0 es la señal de que cerró bien').toBe(0)
  })

  it('cerrar la mesa la saca del mapa', async () => {
    await cacheOrder({ id: 'o-1', mesa: 4, status: 'abierta', total: 260, items: [] })
    await deleteCachedOrder('o-1')

    const ordenes = await getCachedOrders()
    expect(ordenes.find(o => o.id === 'o-1'),
      'en campo la mesa 4 seguía mostrando la orden ya cobrada').toBeUndefined()
  })

  it('sin nada encolado, el resumen dice cero y no truena', async () => {
    const resumen = await getSyncQueueSummary()
    expect(resumen.pending).toBe(0)
  })
})
