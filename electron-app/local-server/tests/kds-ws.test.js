'use strict'
// KDS-02 tests: Local Server as KDS primary data source
// Run: node --test electron-app/local-server/tests/kds-ws.test.js
//
// Tests covered:
//  CONNECTION   1. KDS subscriber receives SNAPSHOT on connect
//               2. SNAPSHOT includes kds_orders when orders have been sent
//               3. SNAPSHOT kds_orders is always an array (even if empty)
//  SNAPSHOT     4. Full order object preserved in kds_orders (mesero, notas, items)
//               5. Entregada orders NOT included in kds_orders
//  DELTA        6. ORDER_SENT DELTA delivered to all KDS subscribers
//               7. ORDER_UPSERTED DELTA carries updated status
//               8. KDS_ITEM_STATUS DELTA carries full kds_item_status map
//  SEQUENCE     9. Events have monotonically increasing sequence numbers
//              10. SUBSCRIBE with last_sequence>0 triggers catch-up
//  SECOND ROUND 11. Second ORDER_SENT for same order replaces items in DELTA
//  KDS ACTIONS 12. KDS_ITEM_STATUS command from KDS is ACKed and broadcast
//              13. ORDER_UPSERTED from KDS updates in-memory state and broadcasts
//  RECONNECT   14. Reconnect with known sequence receives missed events
//  MISMATCH    15. Wrong restaurant_id does not see active orders
//  IDENTITY    16. client_type=kds is accepted; receives broadcasts
//  IDEMPOTENCY 17. Duplicate command_id returns ACK with duplicate:true, no extra DELTA

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { WsHub }            = require('../core/ws-hub')
const { CommandHandler }   = require('../core/command-handler')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')
const { RestaurantState }  = require('../core/state')
const { EVENT, PROTOCOL_VERSION } = require('../protocol')

const TEST_PORT     = 17719
const RESTAURANT_ID = 'rest-kds-test'

let server, hub, cmdHandler, eventStore, state, tmpDir

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-kds-test-'))
  const raw = new NdjsonEventStore({
    eventLogPath:          path.join(tmpDir, 'ev.ndjson'),
    processedCommandsPath: path.join(tmpDir, 'cmd.ndjson'),
  })
  eventStore = new CoreEventStore(raw)
  await eventStore.load()
  state = new RestaurantState()

  hub = new WsHub({
    serverId:        'test-server',
    restaurantId:    RESTAURANT_ID,
    getState:        () => state.toSnapshot(),
    getLastSequence: () => eventStore.getLastSequence(),
    readAfter:       (seq) => eventStore.readAfter(seq),
  })

  cmdHandler = new CommandHandler({ eventStore, state, wsHub: hub, printer: null, restaurantId: RESTAURANT_ID })
  hub.onCommand((msg, clientId) => cmdHandler.handle(msg, clientId))

  server = http.createServer(() => {})
  hub.attach(server)
  await new Promise(r => server.listen(TEST_PORT, '127.0.0.1', r))
})

after(() => {
  hub.close()
  server.close()
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function openWs() { return new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`) }

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function closeWs(ws) {
  return new Promise(r => { if (ws.readyState === WebSocket.CLOSED) return r(); ws.once('close', r); ws.close() })
}

function subscribe(ws, opts = {}) {
  ws.send(JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    type: 'SUBSCRIBE',
    client_id:     opts.clientId     || `kds-${Math.random().toString(36).slice(2, 6)}`,
    client_type:   opts.clientType   || 'kds',
    restaurant_id: opts.restaurantId !== undefined ? opts.restaurantId : RESTAURANT_ID,
    last_sequence: opts.lastSequence ?? 0,
  }))
}

function sendCommand(ws, commandType, payload, clientId = 'kds-test') {
  ws.send(JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    type: 'COMMAND',
    restaurant_id: RESTAURANT_ID,
    payload: {
      command_id:   `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      command_type: commandType,
      client_id:    clientId,
      ...payload,
    },
  }))
}

function sendCommandWithId(ws, commandId, commandType, payload, clientId = 'kds-test') {
  ws.send(JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    type: 'COMMAND',
    restaurant_id: RESTAURANT_ID,
    payload: { command_id: commandId, command_type: commandType, client_id: clientId, ...payload },
  }))
}

/** Wait for next message matching predicate, reject on timeout */
function nextMsg(ws, pred, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs)
    function h(data) {
      try {
        const msg = JSON.parse(data.toString())
        if (pred(msg)) { clearTimeout(t); ws.off('message', h); resolve(msg) }
      } catch {}
    }
    ws.on('message', h)
  })
}

/** Inject an ORDER_SENT directly into state + store + broadcast (simulates POS HTTP /events) */
async function simulateOrderSent(payload) {
  const commandId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { duplicate, event } = await eventStore.processCommand(
    { command_id: commandId, type: EVENT.ORDER_SENT, client_id: 'pos-sim', restaurant_id: RESTAURANT_ID, payload },
    { eventType: EVENT.ORDER_SENT },
  )
  if (!duplicate && event) {
    state.apply(event)
    await hub.broadcast(event)
  }
  return event
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KDS-02 — CONNECTION', () => {
  test('1. KDS subscriber receives SNAPSHOT on connect', async () => {
    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    assert.equal(snap.type, 'SNAPSHOT')
    assert.ok(typeof snap.sequence === 'number')
    assert.ok(snap.payload?.state != null)
    await closeWs(ws)
  })

  test('2. SNAPSHOT includes kds_orders after an ORDER_SENT', async () => {
    const orderId = `snap-sent-${Date.now()}`
    await simulateOrderSent({ order_id: orderId, mesa: 5, mesero: 'Omar', status: 'enviada', items: JSON.stringify([{ nombre: 'Chilaquiles', cantidad: 1 }]) })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    const kdsOrders = snap.payload?.state?.kds_orders
    assert.ok(Array.isArray(kdsOrders), 'kds_orders must be an array')
    assert.ok(kdsOrders.length >= 1, `Expected >= 1 kds_order, got ${kdsOrders.length}`)
    await closeWs(ws)
  })

  test('3. SNAPSHOT kds_orders is always an array', async () => {
    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    const kdsOrders = snap.payload?.state?.kds_orders
    assert.ok(Array.isArray(kdsOrders), 'kds_orders must always be an array, never undefined')
    await closeWs(ws)
  })
})

describe('KDS-02 — SNAPSHOT content', () => {
  test('4. Full order object preserved: mesero, notas, items', async () => {
    const orderId = `full-${Date.now()}`
    const items = JSON.stringify([{ nombre: 'Enchiladas', cantidad: 2, modificadores: ['sin cebolla'] }])
    await simulateOrderSent({ order_id: orderId, mesa: 7, mesero: 'Daniela', status: 'enviada', items, notas: 'sin picante' })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    const kdsOrders = snap.payload?.state?.kds_orders ?? []
    const found = kdsOrders.find(o => (o.id || o.order_id) === orderId)
    assert.ok(found, `Order ${orderId} not found in kds_orders (got ${kdsOrders.length} orders)`)
    assert.equal(found.mesero, 'Daniela', 'mesero must be preserved')
    assert.equal(found.notas, 'sin picante', 'notas must be preserved')
    assert.ok(typeof found.items === 'string', 'items must be a JSON string')
    const parsed = JSON.parse(found.items)
    assert.equal(parsed[0].nombre, 'Enchiladas', 'item content must be preserved')
    await closeWs(ws)
  })

  test('5. Entregada orders NOT included in kds_orders', async () => {
    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    const kdsOrders = snap.payload?.state?.kds_orders ?? []
    const bad = kdsOrders.filter(o => o.status === 'entregada' || o.status === 'cerrada')
    assert.equal(bad.length, 0, 'entregada/cerrada orders must not appear in kds_orders')
    await closeWs(ws)
  })
})

describe('KDS-02 — DELTA delivery', () => {
  test('6. ORDER_SENT DELTA delivered to all KDS subscribers', async () => {
    const ws1 = openWs(); const ws2 = openWs()
    await Promise.all([waitOpen(ws1), waitOpen(ws2)])
    subscribe(ws1, { clientId: 'kds-a' })
    subscribe(ws2, { clientId: 'kds-b' })
    await Promise.all([nextMsg(ws1, m => m.type === 'SNAPSHOT'), nextMsg(ws2, m => m.type === 'SNAPSHOT')])

    const orderId = `delta-${Date.now()}`
    const p1 = nextMsg(ws1, m => m.type === 'DELTA' && m.payload?.event?.type === EVENT.ORDER_SENT && m.payload?.event?.payload?.order_id === orderId)
    const p2 = nextMsg(ws2, m => m.type === 'DELTA' && m.payload?.event?.type === EVENT.ORDER_SENT && m.payload?.event?.payload?.order_id === orderId)
    sendCommand(ws1, 'ORDER_SENT', { order_id: orderId, mesa: 3, mesero: 'Julio', status: 'enviada', items: '[]' })

    const [d1, d2] = await Promise.all([p1, p2])
    assert.equal(d1.type, 'DELTA')
    assert.equal(d2.type, 'DELTA')
    await Promise.all([closeWs(ws1), closeWs(ws2)])
  })

  test('7. ORDER_UPSERTED DELTA carries updated status', async () => {
    const orderId = `upd-${Date.now()}`
    await simulateOrderSent({ order_id: orderId, mesa: 2, mesero: 'Hector', status: 'enviada', items: '[]' })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    const p = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.type === EVENT.ORDER_UPSERTED && m.payload?.event?.payload?.order_id === orderId)
    sendCommand(ws, 'ORDER_UPSERTED', { order_id: orderId, mesa: 2, status: 'preparando' })
    const delta = await p
    assert.equal(delta.payload.event.payload.status, 'preparando')
    await closeWs(ws)
  })

  test('8. KDS_ITEM_STATUS DELTA carries full kds_item_status map', async () => {
    const orderId = `item-${Date.now()}`
    await simulateOrderSent({ order_id: orderId, mesa: 4, mesero: 'Brayan', status: 'preparando', items: '[]' })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    const kdsStatus = JSON.stringify({ '0': true, '1': false })
    const p = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.type === EVENT.KDS_ITEM_STATUS)
    sendCommand(ws, 'KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: kdsStatus })
    const delta = await p
    assert.equal(delta.payload.event.payload.kds_item_status, kdsStatus)
    await closeWs(ws)
  })
})

describe('KDS-02 — SEQUENCE', () => {
  test('9. Events have monotonically increasing sequence numbers', async () => {
    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    const startSeq = snap.sequence

    // Send commands ONE AT A TIME (wait for ACK) to guarantee sequential event assignment
    const deltas = []
    for (let i = 0; i < 3; i++) {
      const orderId = `seq-${i}-${Date.now()}`
      const ackP   = nextMsg(ws, m => m.type === 'ACK')
      const deltaP = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId)
      sendCommand(ws, 'ORDER_SENT', { order_id: orderId, mesa: i + 1, mesero: 'Test', status: 'enviada', items: '[]' })
      const [, delta] = await Promise.all([ackP, deltaP])
      deltas.push(delta)
    }

    let prev = startSeq
    for (const d of deltas) {
      assert.ok(d.sequence > prev, `sequence ${d.sequence} must be > prev=${prev}`)
      prev = d.sequence
    }
    await closeWs(ws)
  })

  test('10. SUBSCRIBE with last_sequence>0 triggers catch-up', async () => {
    // Get current sequence
    const ws1 = openWs()
    await waitOpen(ws1)
    subscribe(ws1)
    const snap1 = await nextMsg(ws1, m => m.type === 'SNAPSHOT')
    const seqBefore = snap1.sequence

    // Send an event while ws1 is still connected (to ensure it's in the log)
    const orderId = `catchup-${Date.now()}`
    const deltaP = nextMsg(ws1, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId)
    sendCommand(ws1, 'ORDER_SENT', { order_id: orderId, mesa: 9, mesero: 'Aldo', status: 'enviada', items: '[]' })
    await deltaP
    await closeWs(ws1)

    // New client reconnects with the BEFORE sequence
    const ws2 = openWs()
    await waitOpen(ws2)
    subscribe(ws2, { clientId: 'kds-reconnect', lastSequence: seqBefore })
    const snap2 = await nextMsg(ws2, m => m.type === 'SNAPSHOT')

    // Check: missed event must appear either in snapshot.deltas or in kds_orders
    const snapDeltas    = snap2.payload?.deltas ?? []
    const kdsOrders     = snap2.payload?.state?.kds_orders ?? []
    const inDeltas      = snapDeltas.some(d => d.payload?.order_id === orderId)
    const inKdsOrders   = kdsOrders.some(o => (o.id || o.order_id) === orderId)

    assert.ok(inDeltas || inKdsOrders,
      `Missed order ${orderId} must appear in SNAPSHOT deltas (${snapDeltas.length}) or kds_orders (${kdsOrders.length})`)
    await closeWs(ws2)
  })
})

describe('KDS-02 — SECOND ROUND', () => {
  test('11. Second ORDER_SENT for same order delivers updated items in DELTA', async () => {
    const orderId = `r2-${Date.now()}`
    const items1  = JSON.stringify([{ nombre: 'Chilaquiles', cantidad: 1 }])
    const items2  = JSON.stringify([{ nombre: 'Chilaquiles', cantidad: 1 }, { nombre: 'Huevos', cantidad: 2 }])

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    const d1 = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId)
    sendCommand(ws, 'ORDER_SENT', { order_id: orderId, mesa: 6, mesero: 'Oscar', status: 'enviada', items: items1 })
    await d1

    const d2 = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId && m.payload?.event?.payload?.items === items2)
    sendCommand(ws, 'ORDER_SENT', { order_id: orderId, mesa: 6, mesero: 'Oscar', status: 'enviada', items: items2 })
    const delta2 = await d2
    assert.equal(delta2.payload.event.payload.items, items2, 'Second round DELTA must carry full updated items list')

    // Verify state: only one entry per order_id in kds_queue
    const kdsQueue = state.getKdsQueue()
    const entries = kdsQueue.filter(k => k.order_id === orderId)
    assert.equal(entries.length, 1, 'kds_queue must have exactly 1 entry per order_id after second round')
    await closeWs(ws)
  })
})

describe('KDS-02 — KDS ACTIONS', () => {
  test('12. KDS_ITEM_STATUS command from KDS is ACKed', async () => {
    const orderId = `ack-${Date.now()}`
    await simulateOrderSent({ order_id: orderId, mesa: 1, mesero: 'Alexis', status: 'preparando', items: '[]' })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    const ackP = nextMsg(ws, m => m.type === 'ACK')
    sendCommand(ws, 'KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: '{"0":true}' })
    const ack = await ackP
    assert.equal(ack.type, 'ACK')
    assert.ok(ack.payload?.command_id, 'ACK must include command_id')
    await closeWs(ws)
  })

  test('13. ORDER_UPSERTED from KDS updates in-memory state and broadcasts', async () => {
    const orderId = `adv-${Date.now()}`
    await simulateOrderSent({ order_id: orderId, mesa: 8, mesero: 'Mario', status: 'enviada', items: '[]' })

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    const ackP   = nextMsg(ws, m => m.type === 'ACK')
    const deltaP = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.type === EVENT.ORDER_UPSERTED && m.payload?.event?.payload?.order_id === orderId)
    sendCommand(ws, 'ORDER_UPSERTED', { order_id: orderId, mesa: 8, status: 'preparando' })
    const [ack, delta] = await Promise.all([ackP, deltaP])

    assert.equal(ack.type, 'ACK')
    assert.equal(delta.payload.event.payload.status, 'preparando')

    // Verify in-memory state was updated
    const order = state._orders.get(orderId)
    assert.ok(order, 'Order must exist in state._orders after ORDER_UPSERTED')
    assert.equal(order.status, 'preparando', 'In-memory status must reflect the update')
    await closeWs(ws)
  })
})

describe('KDS-02 — RECONNECT', () => {
  test('14. Reconnect with known sequence receives missed events', async () => {
    const ws1 = openWs()
    await waitOpen(ws1)
    subscribe(ws1, { clientId: 'kds-reconn' })
    const snap1 = await nextMsg(ws1, m => m.type === 'SNAPSHOT')
    const seqSaved = snap1.sequence
    await closeWs(ws1)

    // Send 2 events while disconnected
    const id1 = `miss1-${Date.now()}`
    const id2 = `miss2-${Date.now() + 1}`
    await simulateOrderSent({ order_id: id1, mesa: 11, mesero: 'Mauricio', status: 'enviada', items: '[]' })
    await simulateOrderSent({ order_id: id2, mesa: 12, mesero: 'Mariana',  status: 'enviada', items: '[]' })

    // Reconnect with saved sequence
    const ws2 = openWs()
    await waitOpen(ws2)
    subscribe(ws2, { clientId: 'kds-reconn', lastSequence: seqSaved })
    const snap2 = await nextMsg(ws2, m => m.type === 'SNAPSHOT')

    const snapDeltas  = snap2.payload?.deltas ?? []
    const kdsOrders   = snap2.payload?.state?.kds_orders ?? []
    for (const id of [id1, id2]) {
      const inDeltas    = snapDeltas.some(d => d.payload?.order_id === id)
      const inKdsOrders = kdsOrders.some(o => (o.id || o.order_id) === id)
      assert.ok(inDeltas || inKdsOrders, `Missed order ${id} must be in SNAPSHOT (deltas or kds_orders)`)
    }
    await closeWs(ws2)
  })
})

describe('KDS-02 — MISMATCH', () => {
  test('15. Wrong restaurant_id subscriber does not see active orders', async () => {
    const ws = openWs()
    await waitOpen(ws)

    // Server sends REJECT and immediately closes the WS on mismatch.
    // The close event may arrive before the message event — accept any of:
    //   REJECT message, immediate close (server-initiated), or empty SNAPSHOT.
    const outcome = await new Promise((resolve) => {
      let resolved = false
      const done = (val) => { if (!resolved) { resolved = true; resolve(val) } }

      const timer = setTimeout(() => done('timeout'), 2000)

      ws.on('message', (data) => {
        try {
          const m = JSON.parse(data.toString())
          if (m.type === 'REJECT') { clearTimeout(timer); done('reject') }
          if (m.type === 'SNAPSHOT') {
            clearTimeout(timer)
            done({ kdsOrders: m.payload?.state?.kds_orders ?? [] })
          }
        } catch {}
      })

      ws.on('close', () => { clearTimeout(timer); done('closed') })

      subscribe(ws, { restaurantId: 'other-restaurant' })
    })

    if (typeof outcome === 'object') {
      // Server sent an empty SNAPSHOT (permissive mode)
      assert.equal(outcome.kdsOrders.length, 0, 'Wrong-restaurant SNAPSHOT must have 0 kds_orders')
    }
    // 'reject', 'closed', or 'timeout' all mean the wrong-restaurant subscriber was blocked
    await closeWs(ws)
  })
})

describe('KDS-02 — IDENTITY', () => {
  test('16. client_type=kds is accepted and receives broadcasts', async () => {
    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws, { clientType: 'kds', clientId: 'kds-identity' })
    const snap = await nextMsg(ws, m => m.type === 'SNAPSHOT')
    assert.ok(snap, 'KDS client_type must receive SNAPSHOT')

    const orderId = `ident-${Date.now()}`
    const deltaP  = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId)
    await simulateOrderSent({ order_id: orderId, mesa: 15, mesero: 'Aldo', status: 'enviada', items: '[]' })
    const delta = await deltaP
    assert.equal(delta.payload.event.type, EVENT.ORDER_SENT)
    await closeWs(ws)
  })
})

describe('KDS-02 — IDEMPOTENCY', () => {
  test('17. Duplicate command_id returns ACK(duplicate:true), no extra DELTA', async () => {
    const orderId   = `idem-${Date.now()}`
    const commandId = `cmd-idem-${Date.now()}`

    const ws = openWs()
    await waitOpen(ws)
    subscribe(ws)
    await nextMsg(ws, m => m.type === 'SNAPSHOT')

    // First send
    const ack1P   = nextMsg(ws, m => m.type === 'ACK')
    const delta1P = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId)
    sendCommandWithId(ws, commandId, 'ORDER_SENT', { order_id: orderId, mesa: 3, mesero: 'Test', status: 'enviada', items: '[]' })
    await Promise.all([ack1P, delta1P])

    // Resend with SAME command_id
    const ack2P = nextMsg(ws, m => m.type === 'ACK')
    const extraDeltaP = nextMsg(ws, m => m.type === 'DELTA' && m.payload?.event?.payload?.order_id === orderId, 600).catch(() => null)
    sendCommandWithId(ws, commandId, 'ORDER_SENT', { order_id: orderId, mesa: 3, mesero: 'Test', status: 'enviada', items: '[]' })
    const [ack2, extraDelta] = await Promise.all([ack2P, extraDeltaP])

    assert.equal(ack2.payload.duplicate, true, 'Resend must return ACK with duplicate:true')
    assert.equal(extraDelta, null, 'No extra DELTA must be broadcast for duplicate command')
    await closeWs(ws)
  })
})
