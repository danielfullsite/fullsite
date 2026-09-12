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

describe('Delayed account snapshots across terminals', () => {
  test('atomic full transfer moves pending kitchen work to a new destination and survives hydration', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'src', mesa: 1, items: [{ id: 'coffee' }], total: 58, order_revision: 1 }))
    const transfer = makeEvent(EVENT.ORDER_ITEMS_TRANSFERRED, { command_id: 'move', item_id: 'coffee',
      source_order: { id: 'src', mesa: 1, items: [], total: 0, status: 'cancelada', order_revision: 2 },
      target_order: { id: 'dst', mesa: 2, items: [{ id: 'coffee' }], total: 58, status: 'enviada', order_revision: 1 } })
    state.apply(transfer)
    const secondary = new RestaurantState()
    secondary.hidratarDesdeSnapshot(state.toSnapshot())
    for (const replica of [state, secondary]) {
      replica.apply(transfer)
      replica.apply(makeEvent(EVENT.STATE_SYNC, { orders: [], mesas: [], kds_queue: [], order_snapshot_complete: true }))
      assert.deepEqual(replica.getKdsQueue().map(q => [q.order_id, q.items_sent.map(i => i.id)]), [['dst', ['coffee']]])
      assert.equal(JSON.parse(replica.toSnapshot().kds_orders.find(o => o.id === 'dst').items)[0].id, 'coffee')
      assert.equal(replica.getOrder('dst').total, 58)
      assert.equal(replica.getOrder('src').status, 'cancelada')
      assert.notEqual(replica.getOrder('src').payment_status, 'pagada')
      assert.equal(replica.getMesa(1).status, 'libre')
      assert.deepEqual(replica.toSnapshot().salon_orders.map(o => o.id), ['dst'])
    }
  })

  test('partial transfer remaps completed positions by item identity and retains other kitchen work', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'src', mesa: 1, items: [{ id: 'done' }, { id: 'pending' }], total: 116, order_revision: 1 }))
    state.apply(makeEvent(EVENT.KDS_ITEM_STATUS, { order_id: 'src', kds_item_status: { 0: true, 1: false } }))
    state.apply(makeEvent(EVENT.ORDER_ITEMS_TRANSFERRED, { command_id: 'move', item_id: 'done',
      source_order: { id: 'src', mesa: 1, items: [{ id: 'pending' }], total: 58, status: 'enviada', order_revision: 2 },
      target_order: { id: 'dst', mesa: 2, items: [{ id: 'done' }], total: 58, status: 'enviada', order_revision: 1 } }))
    assert.deepEqual(JSON.parse(state.getOrder('src').kds_item_status), { 0: false })
    assert.deepEqual(JSON.parse(state.getOrder('dst').kds_item_status), { 0: true })
    assert.deepEqual(state.getKdsQueue().map(q => q.order_id), ['src', 'dst'])
  })

  test('delayed transfer preserves newer business snapshots and does not revive a cancelled destination', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'src', mesa: 1, items: [{ id: 'remaining' }], total: 58, order_revision: 4 }))
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'dst', mesa: 2, items: [{ id: 'moved' }, { id: 'new-round' }], total: 116, order_revision: 3 }))
    const payload = { command_id: 'move', item_id: 'moved',
      source_order: { id: 'src', mesa: 1, items: [], total: 0, status: 'enviada', order_revision: 2 },
      target_order: { id: 'dst', mesa: 2, items: [{ id: 'moved' }], total: 58, status: 'enviada', order_revision: 1 } }
    state.apply(makeEvent(EVENT.ORDER_ITEMS_TRANSFERRED, payload))
    assert.equal(state.getOrder('src').total, 58)
    assert.equal(state.getOrder('dst').total, 116)
    assert.equal(state.getOrder('dst').order_revision, 3)
    assert.equal(state.getKdsQueue().find(q => q.order_id === 'dst').items_sent.length, 2)
    state.apply(makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'dst', mesa: 2 }))
    state.apply(makeEvent(EVENT.ORDER_ITEMS_TRANSFERRED, { ...payload, command_id: 'another-notice' }))
    assert.equal(state.getOrder('dst').status, 'cancelada')
    assert.equal(state.getKdsQueue().some(q => q.order_id === 'dst'), false)
  })
  test('cancelled identities survive repeated snapshot hydration and reject late sends and upserts', () => {
    const caja = new RestaurantState()
    caja.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'old', mesa: 1, items: [{ id: 'a' }], total: 58 }))
    caja.apply(makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'old', mesa: 1 }))
    caja.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'new', mesa: 1, items: [{ id: 'b' }], total: 116 }))
    const secondary = new RestaurantState()
    secondary.hidratarDesdeSnapshot(caja.toSnapshot())
    const reconnected = new RestaurantState()
    reconnected.hidratarDesdeSnapshot(secondary.toSnapshot())
    for (const state of [caja, secondary, reconnected]) {
      for (const type of [EVENT.ORDER_UPSERTED, EVENT.ORDER_SENT]) {
        state.apply(makeEvent(type, { order_id: 'old', mesa: 1, items: [{ id: 'a' }], total: 58 }))
      }
      assert.equal(state.getOrder('old').status, 'cancelada')
      assert.equal(state.getMesa(1).order_id, 'new')
      assert.deepEqual(state.toSnapshot().salon_orders.map(o => o.id), ['new'])
      assert.deepEqual(state.toSnapshot().kds_orders.map(o => o.id), ['new'])
    }
  })

  test('older full upserts and sends cannot overwrite a newer round after reconnect', () => {
    const caja = new RestaurantState()
    caja.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'o', mesa: 2, items: [{ id: 'a' }, { id: 'b' }], total: 116, order_revision: 3 }))
    const secondary = new RestaurantState()
    secondary.hidratarDesdeSnapshot(caja.toSnapshot())
    for (const state of [caja, secondary]) {
      for (const type of [EVENT.ORDER_UPSERTED, EVENT.ORDER_SENT]) {
        state.apply(makeEvent(type, { order_id: 'o', mesa: 1, items: [{ id: 'a' }], total: 58, order_revision: 2 }))
      }
      assert.equal(state.getOrder('o').total, 116)
      assert.equal(state.getOrder('o').order_revision, 3)
      assert.equal(JSON.parse(state.getOrder('o').items).length, 2)
      assert.equal(state.getMesa(2).order_id, 'o')
      assert.equal(state.getMesa(1).order_id, null)
      assert.equal(state.getKdsQueue()[0].items_sent.length, 2)
      // Kitchen progress is independent of the account revision.
      state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'o', status: 'lista' }))
      assert.equal(state.getOrder('o').preparation_status, 'lista')
      assert.equal(state.getOrder('o').order_revision, 3)
    }
  })

  test('equal and newer account revisions still apply, as do unversioned legacy offline events', () => {
    const state = new RestaurantState()
    const send = (revision, id) => state.apply(makeEvent(EVENT.ORDER_SENT, {
      order_id: 'o', mesa: 1, items: [{ id }], total: 58, ...(revision === undefined ? {} : { order_revision: revision }),
    }))
    send(3, 'initial')
    send(3, 'equal')
    assert.equal(JSON.parse(state.getOrder('o').items)[0].id, 'equal')
    send(4, 'newer')
    assert.equal(state.getOrder('o').order_revision, 4)
    send(undefined, 'legacy')
    assert.equal(JSON.parse(state.getOrder('o').items)[0].id, 'legacy')
    send(0, 'offline')
    assert.equal(JSON.parse(state.getOrder('o').items)[0].id, 'offline')
  })
})

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

  test('concurrent kitchen deltas merge instead of erasing another screen', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      order_id: 'shared-kitchen', mesa: 4, status: 'preparando',
      items: [{ id: 'food' }, { id: 'drink' }],
    }, 1))

    // Cocina and barra act from the same stale snapshot. A full-map replacement
    // makes the second command erase the first; item deltas must commute.
    state.apply(makeEvent(EVENT.KDS_ITEM_STATUS, {
      order_id: 'shared-kitchen', kds_item_delta: { item_index: 0, done: true },
    }, 2))
    state.apply(makeEvent(EVENT.KDS_ITEM_STATUS, {
      order_id: 'shared-kitchen', kds_item_delta: { item_index: 1, done: true },
    }, 3))

    assert.deepEqual(JSON.parse(state.getOrder('shared-kitchen').kds_item_status), {
      0: true,
      1: true,
    })
  })

  test('D2 ORDER_CLOSED conserva trabajo pendiente en KDS', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT,   { order_id: 'o1', mesa: '2', items_sent: [{ id: 'i1' }] }, 1))
    state.apply(makeEvent(EVENT.ORDER_CLOSED, { order_id: 'o1', mesa: '2' }, 2))
    assert.equal(state.getKdsQueue().length, 1)
    assert.equal(state.toSnapshot().salon_orders.length, 0)
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

  test('D2 cancelada sale de cocina, pagada sigue pendiente', () => {
    // Bateria adversarial 2026-09-02: cancelar en el POS dejaba la tarjeta viva
    // en el KDS LAN — cocina preparando un platillo muerto.
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      command_id: 'cx1', order_id: 'oc1', mesa: 4, mesero: 'm',
      items: [{ nombre: 'Bowl', station: 'cocina' }], status: 'enviada',
    }, 1))
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      command_id: 'cx2', order_id: 'oc2', mesa: 6, mesero: 'm',
      items: [{ nombre: 'Sopa', station: 'cocina' }], status: 'enviada',
    }, 2))
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'oc1', mesa: 4, status: 'cancelada' }, 3))
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'oc2', mesa: 6, status: 'pagada' }, 4))
    const snap = state.toSnapshot()
    assert.equal(snap.kds_orders.length, 1)
    assert.equal(snap.kds_orders[0].id, 'oc2')
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

  test('D1 una orden aceptada local no desaparece por ausencia en nube después de 45s', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'stale-1', mesa: '9', items: [] }, 1))
    // envejecemos la orden más allá de la ventana de gracia
    const o = state._orders.get('stale-1')
    o.updated_at = new Date(Date.now() - (RestaurantState.SYNC_GRACE_MS + 5000)).toISOString()
    // el poll ya no la ve (fue cerrada en otra terminal) → debe liberarse
    state.apply(makeEvent(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, 2))
    assert.equal(state.getMesa('9').status, 'ocupada', 'la ausencia cloud no es un recibo de cierre')
  })

  // ── Una fila CERRADA en nube sí es recibo (2026-09-10) ─────────────────────
  //
  // D1 dice que la AUSENCIA no cierra nada. Esto es lo contrario: la fila existe y
  // dice `cerrada`. En modo legacy la nube es la autoridad de cobro; si el
  // ORDER_CLOSED de la LAN se perdió, esta orden quedaba `enviada` aquí para
  // siempre y la mesa se podía volver a cobrar (video de Eduardo, 2026-08-24).
  describe('una fila cerrada en nube liquida la orden local', () => {
    const filaCerrada = (id, mesa, extra = {}) => ({
      id, mesa, status: 'cerrada', items: '[]', closed_at: '2026-09-10T20:00:00.000Z', ...extra,
    })
    const poll = (orders, seq) => makeEvent(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [], orders, synced_at: new Date().toISOString(),
    }, seq)

    test('REGRESION: libera la mesa, marca pagada y saldo 0, y la saca del salón', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-1', mesa: '5', total: 58, items: [{ n: 'café' }] }, 1))
      assert.equal(state.getMesa('5').status, 'ocupada', 'premisa')

      state.apply(poll([filaCerrada('loc-1', 5)], 2))

      assert.equal(state.getMesa('5').status, 'libre')
      assert.equal(state.getMesa('5').order_id, null)
      const o = state._orders.get('loc-1')
      assert.equal(o.payment_status, 'pagada')
      assert.equal(o.saldo, 0)
      assert.equal(o.closed_at, '2026-09-10T20:00:00.000Z', 'conserva la hora de cierre de la nube')
      assert.ok(!state.toSnapshot().salon_orders.some(s => s.order_id === 'loc-1'), 'ya no debe dinero')
    })

    test('conserva los platillos y la preparación pendiente (D2): pagada antes de cocinar sigue en cocina', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-2', mesa: '6', items: [{ n: 'sopa' }] }, 1))
      state.apply(poll([filaCerrada('loc-2', 6)], 2))
      const o = state._orders.get('loc-2')
      assert.deepEqual(JSON.parse(o.items), [{ n: 'sopa' }], 'la fila de nube (items vacíos) NO pisa los platillos locales')
      assert.ok(state.toSnapshot().kds_orders.some(k => k.order_id === 'loc-2'), 'la comanda sigue en cocina')
    })

    test('pagada, closed y paid cuentan igual que cerrada', () => {
      for (const status of ['pagada', 'closed', 'paid']) {
        const state = new RestaurantState()
        state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-3', mesa: '3', items: [] }, 1))
        state.apply(poll([filaCerrada('loc-3', 3, { status })], 2))
        assert.equal(state.getMesa('3').status, 'libre', status)
      }
    })

    test('una fila ABIERTA en nube no toca la orden local (el continue de siempre)', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-4', mesa: '4', items: [{ n: 'taco' }] }, 1))
      state.apply(poll([filaCerrada('loc-4', 4, { status: 'enviada', items: '[{"n":"otra cosa"}]' })], 2))
      assert.equal(state.getMesa('4').status, 'ocupada')
      assert.deepEqual(JSON.parse(state._orders.get('loc-4').items), [{ n: 'taco' }])
      assert.notEqual(state._orders.get('loc-4').payment_status, 'pagada')
    })

    test('una fila cerrada de OTRA orden en la misma mesa no libera la mesa', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'vieja', mesa: '8', items: [] }, 1))
      state.apply(makeEvent(EVENT.ORDER_CLOSED, { order_id: 'vieja', mesa: '8' }, 2))
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'nueva', mesa: '8', items: [] }, 3))
      assert.equal(state.getMesa('8').order_id, 'nueva', 'premisa')
      // la nube todavía trae la vieja como cerrada (turno abierto): no es recibo de la nueva
      state.apply(poll([filaCerrada('vieja', 8)], 4))
      assert.equal(state.getMesa('8').status, 'ocupada')
      assert.equal(state.getMesa('8').order_id, 'nueva')
    })

    test('idempotente: el mismo poll dos veces deja el mismo estado', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-5', mesa: '2', items: [] }, 1))
      const samePoll = poll([filaCerrada('loc-5', 2)], 2)
      state.apply(samePoll)
      const antes = JSON.stringify(state.toSnapshot())
      state.apply({ ...samePoll, sequence: 3 })
      const despues = JSON.stringify(state.toSnapshot())
      assert.equal(despues, antes)
    })

    test('en modo caja el poll sigue siendo observacional: no liquida nada', () => {
      const state = new RestaurantState({ localAuthorityEnabled: true })
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-6', mesa: '7', items: [] }, 1))
      state.apply(poll([filaCerrada('loc-6', 7)], 2))
      assert.equal(state.getMesa('7').status, 'ocupada')
      assert.notEqual(state._orders.get('loc-6').payment_status, 'pagada')
    })

    test('la ausencia sigue sin ser recibo (D1 no cambia): sin fila, la mesa sigue ocupada', () => {
      const state = new RestaurantState()
      state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'loc-7', mesa: '1', items: [] }, 1))
      state.apply(poll([], 2))
      assert.equal(state.getMesa('1').status, 'ocupada')
    })
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

  test('un poll de otro turno no borra comandas locales sin cierre autorizado', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, {
      order_id: 'old-order', mesa: '4', turno_id: 'turno-anterior', items: [{ n: 'taco' }],
    }))

    state.apply(makeEvent(EVENT.STATE_SYNC, {
      mesas: [], kds_queue: [],
      turno: { id: 'turno-actual', opened_at: new Date().toISOString() },
      synced_at: new Date().toISOString(),
    }))

    assert.equal(state.toSnapshot().kds_orders.length, 1)
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


describe('Late LAN notifications cannot resurrect cancelled orders', () => {
  test('a delayed cancellation cannot free a table occupied by another order', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'old', mesa: 5, items: [] }, 1))
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'new', mesa: 5, items: [] }, 2))
    state.apply(makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'old', mesa: 5 }, 3))
    assert.equal(state.getMesa('5').order_id, 'new')
    assert.equal(state.getMesa('5').status, 'ocupada')
  })

  test('a delayed update after cancellation cannot reopen the account', () => {
    const state = new RestaurantState()
    state.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'old', mesa: 5, items: [] }, 1))
    state.apply(makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'old', mesa: 5 }, 2))
    state.apply(makeEvent(EVENT.ORDER_UPSERTED, { order_id: 'old', mesa: 5, status: 'enviada', total: 58 }, 3))
    assert.equal(state.toSnapshot().salon_orders.length, 0)
    assert.equal(state.getMesa('5').status, 'libre')
  })
})


test('cancelled identity survives replay, a delayed send and stale cloud rows', () => {
  const history = [
    makeEvent(EVENT.ORDER_SENT, { order_id: 'old', mesa: 5, items: [{ id: 'coffee' }] }, 1),
    makeEvent(EVENT.ORDER_CANCELLED, { order_id: 'old', mesa: 5 }, 2),
  ]
  const restarted = new RestaurantState()
  for (const event of history) restarted.apply(event)
  restarted.apply(makeEvent(EVENT.ORDER_SENT, { order_id: 'old', mesa: 5, items: [{ id: 'coffee' }] }, 3))
  restarted.apply(makeEvent(EVENT.STATE_SYNC, { orders: [{ id: 'old', mesa: 5, status: 'enviada', items: '[]' }], mesas: [{ mesa: 5, order_id: 'old', status: 'ocupada' }], kds_queue: [{ order_id: 'old', mesa: 5 }] }, 4))
  assert.equal(restarted.toSnapshot().salon_orders.length, 0)
  assert.equal(restarted.toSnapshot().kds_orders.length, 0)
  assert.equal(restarted.toSnapshot().kds_queue.length, 0)
  assert.equal(restarted.getMesa('5').status, 'libre')
})
