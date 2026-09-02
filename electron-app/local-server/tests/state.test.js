'use strict'
// Tests for RestaurantState in-memory state machine
// Run: node --test electron-app/local-server/tests/state.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { RestaurantState } = require('../core/state')
const { EVENT } = require('../protocol')

function makeEvent(type, payload, seq = 1) {
  return { id: `ev-${seq}`, sequence: seq, type, ts: Date.now(), client_id: 'c1', restaurant_id: 'r1', payload }
}

describe('Mesa lifecycle', () => {
  test('ORDER_UPSERTED marks mesa as ocupada', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'o1', mesa: '3', items: [] }))
    assert.equal(state.getMesa('3').status, 'ocupada')
    assert.equal(state.getMesa('3').order_id, 'o1')
  })

  test('ORDER_CLOSED frees the mesa', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'o1', mesa: '3', items: [] }, 1))
    state.apply(makeEvent(EVENT.ORDER_CLOSED,   { order_id: 'o1', mesa: '3' }, 2))
    assert.equal(state.getMesa('3').status, 'libre')
    assert.equal(state.getMesa('3').order_id, null)
  })

  test('ORDER_CANCELLED frees the mesa', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED,  { order_id: 'o2', mesa: '5', items: [] }, 1))
    state.apply(makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'o2', mesa: '5', reason: 'test' }, 2))
    assert.equal(state.getMesa('5').status, 'libre')
  })
})

describe('KDS queue', () => {
  test('ORDER_SENT adds to KDS queue', () => {
    const state = new RestaurantState()
    const items = [{ id: 'i1', name: 'Chilaquiles', cantidad: 1 }]
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'o1', mesa: '2', items_sent: items, station: 'cocina' }))
    assert.equal(state.getKdsQueue().length, 1)
    assert.equal(state.getKdsQueue()[0].order_id, 'o1')
  })

  test('KDS_ITEM_STATUS entregada removes item from queue', () => {
    const state = new RestaurantState()
    const items = [{ id: 'i1' }, { id: 'i2' }]
    state.apply(makeEvent(EVENT.ORDER_SENT,       { order_id: 'o1', mesa: '2', items_sent: items }, 1))
    state.apply(makeEvent(EVENT.KDS_ITEM_STATUS,  { order_id: 'o1', item_id: 'i1', status: 'entregada' }, 2))

    const kds = state.getKdsQueue()
    assert.equal(kds.length, 1)                     // order still in KDS
    assert.equal(kds[0].items_sent.length, 1)       // only i2 remains
    assert.equal(kds[0].items_sent[0].id, 'i2')
  })

  test('ORDER_CLOSED removes entry from KDS queue', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT,   { order_id: 'o1', mesa: '2', items_sent: [{ id: 'i1' }] }, 1))
    state.apply(makeEvent(EVENT.ORDER_CLOSED, { order_id: 'o1', mesa: '2' }, 2))
    assert.equal(state.getKdsQueue().length, 0)
  })
})

describe('Mesa locks', () => {
  test('MESA_LOCK sets locked_by', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.MESA_LOCK, { mesa: '7', client_id: 'terminal-A', expires_ms: Date.now() + 30_000 }))
    assert.equal(state.getMesa('7').locked_by, 'terminal-A')
    assert.ok(state.getLock('7'))
  })

  test('MESA_UNLOCK from same terminal clears lock', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.MESA_LOCK,   { mesa: '7', client_id: 'terminal-A', expires_ms: Date.now() + 30_000 }, 1))
    state.apply(makeEvent(EVENT.MESA_UNLOCK, { mesa: '7', client_id: 'terminal-A' }, 2))
    assert.equal(state.getMesa('7').locked_by, null)
    assert.equal(state.getLock('7'), null)
  })

  test('MESA_UNLOCK from different terminal is ignored', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.MESA_LOCK,   { mesa: '7', client_id: 'terminal-A', expires_ms: Date.now() + 30_000 }, 1))
    state.apply(makeEvent(EVENT.MESA_UNLOCK, { mesa: '7', client_id: 'terminal-B' }, 2))
    assert.equal(state.getMesa('7').locked_by, 'terminal-A') // still locked
  })

  test('gcLocks removes expired locks', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.MESA_LOCK, { mesa: '9', client_id: 'terminal-A', expires_ms: Date.now() - 1 }))
    state.gcLocks()
    assert.equal(state.getLock('9'), null)
  })
})

describe('Turno', () => {
  test('TURNO_OPENED sets turno', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.TURNO_OPENED, { turno_id: 't1', opened_by: 'encargado', ts: Date.now() }))
    assert.ok(state.hasActiveTurno())
    assert.equal(state.getTurno().id, 't1')
  })

  test('TURNO_CLOSED clears turno', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.TURNO_OPENED, { turno_id: 't1', opened_by: 'e', ts: Date.now() }, 1))
    state.apply(makeEvent(EVENT.TURNO_CLOSED, { turno_id: 't1' }, 2))
    assert.equal(state.hasActiveTurno(), false)
  })

  test('TURNO_CLOSED limpia el piso: ordenes, KDS y mesas no sobreviven al cierre', () => {
    // Regresion del empalme: el KDS en modo LAN amanecia con las comandas de
    // ayer porque el cierre solo soltaba el turno.
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.TURNO_OPENED, { turno_id: 't1', opened_by: 'e', ts: Date.now() }, 1))
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      command_id: 'c1', order_id: 'o1', mesa: 5, mesero: 'm',
      items: [{ nombre: 'Bowl', station: 'cocina' }], status: 'enviada',
    }, 2))
    const result = state.apply(makeEvent(EVENT.TURNO_CLOSED, { turno_id: 't1' }, 3))
    assert.equal(state.hasActiveTurno(), false)
    const snap = state.toSnapshot()
    assert.equal(snap.kds_orders.length, 0)
    assert.deepEqual(result.changed.sort(), ['kds', 'mesas', 'orders', 'turno'])
  })
})

describe('STATE_SYNC (Supabase poll)', () => {
  test('bulk sync replaces mesa state', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.STATE_SYNC, {
      mesas: [
        { mesa: '1', status: 'ocupada', order_id: 'o-abc' },
        { mesa: '2', status: 'libre',   order_id: null },
      ],
      kds_queue: [],
      turno: null,
      synced_at: new Date().toISOString(),
    }))
    assert.equal(state.getMesa('1').status, 'ocupada')
    assert.equal(state.getMesa('2').status, 'libre')
  })
})

describe('Snapshot', () => {
  test('toSnapshot returns serializable object', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'o1', mesa: '3', items: [] }, 1))
    const snap  = state.toSnapshot()
    const json  = JSON.stringify(snap)
    const back  = JSON.parse(json)
    assert.equal(back.mesas['3'].status, 'ocupada')
  })
})

describe('Clobber / STATE_SYNC merge (GAP-002)', () => {
  test('una orden local FRESCA sobrevive un poll vacío (no clobber)', () => {
    const state = new RestaurantState()
    // orden creada localmente → mesa 5 ocupada
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'local-1', mesa: '5', items: [{ n: 'taco' }] }, 1))
    assert.equal(state.getMesa('5').status, 'ocupada')
    // el poll corre ANTES de que Supabase tenga la orden → mesas vacío
    state.apply(makeEvent(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, 2))
    // antes del fix: la mesa quedaba 'libre' (la orden desaparecía). Ahora sobrevive.
    assert.equal(state.getMesa('5').status, 'ocupada', 'la orden local fresca NO debe borrarse')
    assert.equal(state.getMesa('5').order_id, 'local-1')
  })

  test('el poll SÍ actualiza mesas que no tienen orden local fresca', () => {
    const state = new RestaurantState()
    // el poll trae una orden de otra terminal
    state.apply(makeEvent(EVENT.STATE_SYNC, {
      mesas: [{ mesa: '7', status: 'ocupada', order_id: 'remote-9' }],
      kds_queue: [], synced_at: new Date().toISOString(),
    }, 1))
    assert.equal(state.getMesa('7').status, 'ocupada')
    assert.equal(state.getMesa('7').order_id, 'remote-9')
  })

  test('orden local VIEJA ausente del poll SÍ se reconcilia (Supabase manda tras la gracia)', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'stale-1', mesa: '9', items: [] }, 1))
    // envejecemos la orden más allá de la ventana de gracia
    const o = state._orders.get('stale-1')
    o.updated_at = new Date(Date.now() - (RestaurantState.SYNC_GRACE_MS + 5000)).toISOString()
    // el poll ya no la ve (fue cerrada en otra terminal) → debe liberarse
    state.apply(makeEvent(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, 2))
    assert.equal(state.getMesa('9').status, 'libre', 'orden vieja ausente del poll se reconcilia')
  })

  test('la orden protegida sigue en el KDS tras el poll', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'k-1', mesa: '2', items: [{ n: 'sopa' }] }, 1))
    const kdsBefore = state.getKdsQueue().some(k => k.order_id === 'k-1')
    state.apply(makeEvent(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, 2))
    const kdsAfter = state.getKdsQueue().some(k => k.order_id === 'k-1')
    assert.ok(kdsBefore, 'ORDER_SENT debe encolar en KDS')
    assert.ok(kdsAfter, 'la orden fresca debe seguir en el KDS tras el poll')
  })

  test('un turno nuevo elimina comandas completas del turno anterior', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      order_id: 'old-order', mesa: '4', turno_id: 'turno-anterior', items: [{ n: 'taco' }],
    }))

    state.apply(makeEvent(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [],
      turno: { id: 'turno-actual', opened_at: new Date().toISOString() },
      synced_at: new Date().toISOString(),
    }))

    assert.equal(state.toSnapshot().kds_orders.length, 0)
  })

  test('STATE_SYNC conserva la identidad real del turno y su conflicto', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [],
      turno: { id: 't2', opened_by: 'Eduardo', opened_at: new Date().toISOString(), conflict_count: 2 },
    }))
    assert.equal(state.getTurno().id, 't2')
    assert.equal(state.getTurno().conflict_count, 2)
  })
})
