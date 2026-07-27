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
