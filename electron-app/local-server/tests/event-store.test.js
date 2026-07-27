'use strict'
// Tests for NdjsonEventStore + CoreEventStore
// Run: node --test electron-app/local-server/tests/event-store.test.js

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')

const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')

let tmpDir
let _counter = 0

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'))
})

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
})

// Each call with no key gets unique files — full test isolation.
// Pass an explicit numeric key to share files across two store instances (restart tests).
function makeStore(key) {
  const id = key !== undefined ? key : ++_counter
  return new NdjsonEventStore({
    eventLogPath:          path.join(tmpDir, `events-${id}.ndjson`),
    processedCommandsPath: path.join(tmpDir, `cmds-${id}.ndjson`),
  })
}

function makeCoreStore(store) {
  return new CoreEventStore(store)
}

describe('NdjsonEventStore', () => {
  test('starts empty with sequence 0', async () => {
    const store = makeStore()
    await store.load()
    assert.equal(await store.getLastSequence(), 0)
    assert.equal(await store.unsyncedCount(), 0)
  })

  test('append assigns monotonic sequences', async () => {
    const store = makeStore()
    await store.load()

    const { sequences: s1 } = await store.append([
      { id: 'ev-1', type: 'TEST', ts: Date.now(), client_id: 'c1', restaurant_id: 'r1', payload: {} },
      { id: 'ev-2', type: 'TEST', ts: Date.now(), client_id: 'c1', restaurant_id: 'r1', payload: {} },
    ])

    assert.deepEqual(s1, [1, 2])
    assert.equal(await store.getLastSequence(), 2)
  })

  test('readAfter returns only events with sequence > N', async () => {
    const store = makeStore()
    await store.load()

    await store.append([{ id: 'a', type: 'T', ts: 1, client_id: 'c', restaurant_id: 'r', payload: {} }])
    await store.append([{ id: 'b', type: 'T', ts: 2, client_id: 'c', restaurant_id: 'r', payload: {} }])
    await store.append([{ id: 'c', type: 'T', ts: 3, client_id: 'c', restaurant_id: 'r', payload: {} }])

    const after1 = await store.readAfter(1)
    assert.equal(after1.length, 2)
    assert.equal(after1[0].sequence, 2)
    assert.equal(after1[1].sequence, 3)

    const after0 = await store.readAfter(0)
    assert.equal(after0.length, 3)
  })

  test('state is rebuilt correctly after restart', async () => {
    const sharedKey = ++_counter
    // Write 3 events
    const store1 = makeStore(sharedKey)
    await store1.load()
    await store1.append([
      { id: 'x1', type: 'T', ts: 1, client_id: 'c', restaurant_id: 'r', payload: { n: 1 } },
      { id: 'x2', type: 'T', ts: 2, client_id: 'c', restaurant_id: 'r', payload: { n: 2 } },
      { id: 'x3', type: 'T', ts: 3, client_id: 'c', restaurant_id: 'r', payload: { n: 3 } },
    ])

    // New store instance pointing at same files — simulates restart
    const store2 = makeStore(sharedKey)
    await store2.load()
    assert.equal(await store2.getLastSequence(), 3)
    const events = await store2.readAfter(0)
    assert.equal(events.length, 3)
    assert.deepEqual(events.map(e => e.payload.n), [1, 2, 3])
  })

  test('markSynced updates synced flag', async () => {
    const store = makeStore()
    await store.load()
    const { sequences } = await store.append([
      { id: 'sync-test', type: 'T', ts: 1, client_id: 'c', restaurant_id: 'r', payload: {} }
    ])
    assert.equal(await store.unsyncedCount(), 1)
    await store.markSynced(sequences)
    assert.equal(await store.unsyncedCount(), 0)
  })
})

describe('CoreEventStore — idempotency', () => {
  test('same command_id does not create duplicate events', async () => {
    const store = makeStore()
    const core  = makeCoreStore(store)
    await core.load()

    const cmd = {
      command_id:    'cmd-123',
      type:          'ORDER_SENT',
      client_id:     'terminal-1',
      restaurant_id: 'rest-1',
      payload:       { mesa: '5', items_sent: [] },
    }

    const r1 = await core.processCommand(cmd, { eventType: 'ORDER_SENT' })
    const r2 = await core.processCommand(cmd, { eventType: 'ORDER_SENT' })

    assert.equal(r1.duplicate, false)
    assert.equal(r2.duplicate, true)
    assert.equal(await store.getLastSequence(), 1) // only one event stored
  })

  test('duplicate detection survives restart', async () => {
    const sharedKey = ++_counter
    const store1 = makeStore(sharedKey)
    const core1  = makeCoreStore(store1)
    await core1.load()

    await core1.processCommand(
      { command_id: 'persist-cmd', type: 'T', client_id: 'c', restaurant_id: 'r', payload: {} },
      { eventType: 'TEST' }
    )

    // Simulate restart — same files, new instance
    const store2 = makeStore(sharedKey)
    const core2  = makeCoreStore(store2)
    await core2.load()

    const r2 = await core2.processCommand(
      { command_id: 'persist-cmd', type: 'T', client_id: 'c', restaurant_id: 'r', payload: {} },
      { eventType: 'TEST' }
    )
    assert.equal(r2.duplicate, true)
  })
})

describe('Fault tolerance', () => {
  test('corrupt lines in log are skipped gracefully', async () => {
    const id = ++_counter
    const corruptLogPath = path.join(tmpDir, `events-${id}.ndjson`)
    // Inject a valid line then a corrupt line
    fs.appendFileSync(corruptLogPath, JSON.stringify({ id: 'ok', sequence: 1, type: 'T', ts: 1, client_id: 'c', restaurant_id: 'r', payload: {}, synced: false }) + '\n', 'utf8')
    fs.appendFileSync(corruptLogPath, '{ this is not valid JSON\n', 'utf8')

    const store = makeStore(id)
    await store.load() // should not throw
    // Valid line is readable; corrupt line is skipped
    assert.equal(await store.getLastSequence(), 1)
  })
})
