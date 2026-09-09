'use strict'
// ¿Una orden de Rappi/Uber sobrevive un ciclo de poll que no la menciona?
//
// POR QUÉ ESTA PRUEBA EXISTE
//
// La línea instalada en AMALAY (1.3.12) trae un arreglo que esta rama NO tiene:
//
//   e135e481  fix(kds): el aislamiento por turno respeta las órdenes delivery activas
//
//   "La reconciliación borraba de _orders toda orden _kds_sent ausente del poll de
//    pos_orders pasada la gracia — pero las órdenes Rappi/Uber viven en delivery_orders
//    y su ingesta es exactly-once por command_id, así que una orden delivery viva
//    desaparecía del KDS a los 45s y no revivía."
//
// Antes de portar ese arreglo hay que saber si esta rama tiene el mismo bug. Su lógica
// de protección es distinta —protege por `!_from_cloud`, no por lista de delivery— y una
// orden de delivery entra por comando local, no por el poll. Puede que ya esté cubierta.
//
// Esto no se deduce leyendo: se reproduce. Si la orden sobrevive, no hay que portar nada
// y el arreglo de allá resolvía un problema que aquí no existe. Si desaparece, es un
// bloqueo para instalar en AMALAY: la cocina dejaría de ver los pedidos de Rappi a los
// 45 segundos, en plena operación.
//
// Run: node --test electron-app/local-server/tests/delivery-no-desaparece-del-kds.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { RestaurantState } = require('../core/state')
const { EVENT } = require('../protocol')

const ev = (type, payload, seq = 1) =>
  ({ id: `ev-${seq}`, sequence: seq, type, ts: Date.now(), client_id: 'c1', restaurant_id: 'r1', payload })

/** Una orden de Rappi tal como la arma deliveryOrderCommand() en index.js. */
const ordenDeRappi = (orderId = 'rappi-1') => ({
  order_id: orderId,
  mesa: null,
  mesero: '🟠 Rappi',
  status: 'enviada',
  items: [{ id: 'i1', nombre: 'Bowl de pollo', cantidad: 1, station: 'cocina' }],
  personas: 1,
  total: 320,
  delivery: true,
  platform: 'rappi',
  platform_order_id: 'RP-99',
})

/** Envejecer la orden más allá de la gracia de sincronización, como haría el reloj. */
function envejecer(state, orderId) {
  const o = state._orders.get(orderId)
  assert.ok(o, `la orden ${orderId} debería existir antes de envejecerla`)
  const viejo = new Date(Date.now() - RestaurantState.SYNC_GRACE_MS - 5000).toISOString()
  o.created_at = viejo
  o.updated_at = viejo
}

describe('Una orden de delivery viva no se cae del KDS', () => {
  test('sobrevive un poll de pos_orders que no la menciona, pasada la gracia', () => {
    const state = new RestaurantState()
    state.apply(ev(EVENT.ORDER_UPSERTED, ordenDeRappi(), 1))
    state._orders.get('rappi-1')._kds_sent = true
    envejecer(state, 'rappi-1')

    // El poll trae el estado de pos_orders. Rappi vive en delivery_orders, así que
    // NUNCA va a aparecer aquí: ni en mesas ni en la cola del KDS.
    state.apply(ev(EVENT.STATE_SYNC, {
      mesas: [{ mesa: '3', status: 'ocupada', order_id: 'pos-otra' }],
      kds_queue: [],
      turno: { id: 'turno-abierto' },
      synced_at: new Date().toISOString(),
    }, 2))

    assert.ok(
      state._orders.has('rappi-1'),
      'la orden de Rappi desapareció del KDS por no estar en el poll de pos_orders — ' +
      'la cocina dejaría de verla a los 45 segundos',
    )
  })

  test('tampoco se cae por no traer turno_id, que las de delivery nunca traen', () => {
    // El aislamiento por turno borra lo que pertenece a OTRO turno. Una orden de
    // delivery no tiene turno: su ciclo de vida es delivery_orders.status. No puede
    // caer en esa regla por omisión.
    const state = new RestaurantState()
    state.apply(ev(EVENT.ORDER_UPSERTED, ordenDeRappi('rappi-2'), 1))
    const o = state._orders.get('rappi-2')
    o._kds_sent = true
    assert.equal(o.turno_id, undefined, 'una orden de delivery no debería traer turno_id')
    envejecer(state, 'rappi-2')

    state.apply(ev(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [], turno: { id: 'turno-nuevo' },
      synced_at: new Date().toISOString(),
    }, 2))

    assert.ok(state._orders.has('rappi-2'), 'se cayó al cambiar de turno')
  })

  test('una orden POS normal SÍ se limpia cuando el poll ya no la trae', () => {
    // El contraste importa: si nada se limpiara, la prueba de arriba pasaría por la
    // razón equivocada y el tablero se llenaría de comandas viejas.
    const state = new RestaurantState()
    state.apply(ev(EVENT.ORDER_UPSERTED, { order_id: 'pos-1', mesa: '7', items: [], status: 'enviada' }, 1))
    const o = state._orders.get('pos-1')
    o._kds_sent = true
    o._from_cloud = true          // vino del poll, no de la caja
    envejecer(state, 'pos-1')

    state.apply(ev(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [], turno: { id: 'turno-abierto' },
      synced_at: new Date().toISOString(),
    }, 2))

    assert.ok(!state._orders.has('pos-1'), 'una orden de nube ausente y vencida debe limpiarse')
  })
})
