'use strict'
// Tests for WsHub — WebSocket connection manager
// Run: node --test electron-app/local-server/tests/ws-hub.test.js
//
// Tests covered:
//  • Two clients receive the same broadcast event in order
//  • Reconnect with sequence correctly receives missed events (not timestamp-based)
//  • Port already in use → error on server.listen

const { test, describe, before, after } = require('node:test')
const assert  = require('node:assert/strict')
const http    = require('http')
const WebSocket = require('ws')

const { WsHub } = require('../core/ws-hub')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')
const { RestaurantState }  = require('../core/state')
const { EVENT, PROTOCOL_VERSION } = require('../protocol')
const fs = require('fs')
const os = require('fs')
const path = require('path')
const osMod = require('os')

const TEST_PORT = 17717

let server, hub, eventStore, state, tmpDir

before(async () => {
  tmpDir     = require('fs').mkdtempSync(path.join(osMod.tmpdir(), 'fs-ws-test-'))
  const raw  = new NdjsonEventStore({
    eventLogPath:          path.join(tmpDir, 'ev.ndjson'),
    processedCommandsPath: path.join(tmpDir, 'cmd.ndjson'),
  })
  eventStore = new CoreEventStore(raw)
  await eventStore.load()
  state = new RestaurantState()

  hub = new WsHub({
    serverId:        'test-server',
    restaurantId:    'test-rest',
    getState:        () => state.toSnapshot(),
    getLastSequence: () => eventStore.getLastSequence(),
    readAfter:       (seq) => eventStore.readAfter(seq),
  })

  server = http.createServer(() => {})
  hub.attach(server)
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r))
})

after(() => {
  hub.close()
  server.close()
  try { require('fs').rmSync(tmpDir, { recursive: true }) } catch {}
})

function connect(clientId, clientType = 'pos', lastSeq = -1) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type:             'SUBSCRIBE',
        client_id:        clientId,
        client_type:      clientType,
        restaurant_id:    'test-rest',
        last_sequence:    lastSeq,
      }))
    })
    ws.on('error', reject)
    resolve(ws)
  })
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Message timeout')), 2000)
    ws.once('message', (raw) => {
      clearTimeout(timeout)
      resolve(JSON.parse(raw.toString()))
    })
  })
}

describe('WsHub — two clients receive same event', () => {
  test('broadcast reaches all connected clients in order', async () => {
    const ws1 = await connect('client-1')
    const ws2 = await connect('client-2')

    // Wait for SNAPSHOT on both
    const snap1 = await nextMessage(ws1)
    const snap2 = await nextMessage(ws2)
    assert.equal(snap1.type, 'SNAPSHOT')
    assert.equal(snap2.type, 'SNAPSHOT')

    // Broadcast a test event
    const event = { id: 'bcast-1', sequence: 1, type: EVENT.ORDER_SENT, ts: Date.now(), client_id: 'server', restaurant_id: 'test-rest', payload: { mesa: '5' } }
    const m1 = nextMessage(ws1)
    const m2 = nextMessage(ws2)
    await hub.broadcast(event)

    const [d1, d2] = await Promise.all([m1, m2])
    assert.equal(d1.type, 'DELTA')
    assert.equal(d2.type, 'DELTA')
    assert.equal(d1.payload.event.id, 'bcast-1')
    assert.equal(d2.payload.event.id, 'bcast-1')

    ws1.close()
    ws2.close()
  })
})

describe('WsHub — reconnect by sequence, not timestamp', () => {
  test('client reconnecting with last_sequence gets missed events', async () => {
    // Append 3 events to the store
    await eventStore.appendInternal(EVENT.ORDER_SENT, { mesa: '1' }, { restaurantId: 'test-rest' })
    await eventStore.appendInternal(EVENT.ORDER_SENT, { mesa: '2' }, { restaurantId: 'test-rest' })
    await eventStore.appendInternal(EVENT.ORDER_SENT, { mesa: '3' }, { restaurantId: 'test-rest' })

    // Client connects claiming it last saw sequence 1
    const ws = await connect('reconnect-client', 'kds', 1)
    const snap = await nextMessage(ws)

    assert.equal(snap.type, 'SNAPSHOT')
    // Must have deltas for sequences 2 and 3
    assert.ok(Array.isArray(snap.payload.deltas))
    assert.ok(snap.payload.deltas.length >= 2, `Expected ≥2 deltas, got ${snap.payload.deltas.length}`)
    for (const delta of snap.payload.deltas) {
      assert.ok(delta.sequence > 1)
    }

    ws.close()
  })
})

describe('WsHub — port already in use', () => {
  test('server.listen fails clearly on EADDRINUSE', async () => {
    const dup = http.createServer(() => {})
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        dup.listen(TEST_PORT, '127.0.0.1', resolve)
        dup.on('error', reject)
      }),
      { code: 'EADDRINUSE' }
    )
    dup.close()
  })
})

describe('WsHub — PING/PONG keepalive', () => {
  test('server responds to PING with PONG', async () => {
    const ws   = await connect('ping-client')
    await nextMessage(ws) // consume SNAPSHOT
    ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'PING', client_id: 'ping-client', ts: Date.now() }))
    const pong = await nextMessage(ws)
    assert.equal(pong.type, 'PONG')
    ws.close()
  })
})

// ─── CFG-02: restaurant_id mismatch protection ────────────────────────────────

describe('WsHub — restaurant_id mismatch rejection (CFG-02)', () => {
  test('SUBSCRIBE with wrong restaurant_id is rejected with close code 1008', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(resolve => ws.on('open', resolve))
    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_id:        'intruder-terminal',
      client_type:      'pos',
      restaurant_id:    'wrong-restaurant',   // does NOT match 'test-rest'
      last_sequence:    -1,
    }))
    const { code, reason } = await new Promise(resolve => ws.on('close', (c, r) => resolve({ code: c, reason: r.toString() })))
    assert.equal(code, 1008, 'server should close with policy violation (1008)')
    assert.ok(reason.includes('mismatch'), `close reason should mention mismatch (got: "${reason}")`)
  })

  test('SUBSCRIBE without restaurant_id is accepted (legacy terminals)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(resolve => ws.on('open', resolve))
    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_id:        'legacy-terminal',
      client_type:      'pos',
      // no restaurant_id — legacy terminals that haven't been reprovisioned
      last_sequence:    -1,
    }))
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000)
      ws.on('message', raw => { clearTimeout(t); resolve(JSON.parse(raw.toString())) })
      ws.on('close', () => { clearTimeout(t); reject(new Error('closed without message')) })
    })
    assert.equal(msg.type, 'SNAPSHOT', 'legacy terminal (no restaurant_id) should receive SNAPSHOT')
    ws.close()
  })

  test('SUBSCRIBE with matching restaurant_id is accepted', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(resolve => ws.on('open', resolve))
    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_id:        'matching-terminal',
      client_type:      'pos',
      restaurant_id:    'test-rest',   // matches hub restaurantId
      last_sequence:    -1,
    }))
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000)
      ws.on('message', raw => { clearTimeout(t); resolve(JSON.parse(raw.toString())) })
      ws.on('close', () => { clearTimeout(t); reject(new Error('closed without message')) })
    })
    assert.equal(msg.type, 'SNAPSHOT')
    ws.close()
  })
})
