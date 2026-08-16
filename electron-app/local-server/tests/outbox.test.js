'use strict'
// Tests del Outbox Worker (Phase 2). Run: node --test electron-app/local-server/tests/outbox.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { OutboxWorker } = require('../core/outbox')

// ── Fake event store (en memoria) ───────────────────────────────────────────
class FakeStore {
  constructor(events) { this.events = events.map((e) => ({ synced: false, ...e })) }
  async readAfter(seq) { return this.events.filter((e) => e.sequence > seq) }
  async markSynced(sequences) {
    const s = new Set(sequences)
    for (const e of this.events) if (s.has(e.sequence)) e.synced = true
  }
  unsynced() { return this.events.filter((e) => !e.synced) }
}

// ── Mock fetch configurable ─────────────────────────────────────────────────
function mockFetch(responder) {
  const calls = []
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body)
    calls.push({ url, body })
    const res = responder(body, calls.length)
    return { ok: res.status >= 200 && res.status < 300, status: res.status }
  }
  fn.calls = calls
  return fn
}

const ev = (sequence, type, over = {}) => ({
  id: `cmd-${sequence}`, sequence, type, ts: sequence * 1000, restaurant_id: 'r1', payload: { x: sequence }, ...over,
})

function makeWorker(store, fetchImpl) {
  return new OutboxWorker({
    eventStore: store, supabaseUrl: 'https://sb.test', supabaseKey: 'k',
    restaurantId: 'r1', fetchImpl, logger: () => {},
  })
}

describe('OutboxWorker.flush', () => {
  test('sube eventos pendientes en orden FIFO y los marca synced', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT'), ev(2, 'ORDER_SENT'), ev(3, 'ORDER_CLOSED')])
    const fetchImpl = mockFetch(() => ({ status: 201 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.sent, 3)
    assert.equal(store.unsynced().length, 0)
    // FIFO: las llamadas salieron en orden de sequence
    assert.deepEqual(fetchImpl.calls.map((c) => c.body.sequence), [1, 2, 3])
    // idempotency key = event.id
    assert.equal(fetchImpl.calls[0].body.id, 'cmd-1')
    // ts se envía (pos_local_events.ts es BIGINT NOT NULL)
    assert.equal(fetchImpl.calls[0].body.ts, 1000)
    assert.equal(typeof fetchImpl.calls[2].body.ts, 'number')
  })

  test('NO sube eventos STATE_SYNC (observaciones internas del poll)', async () => {
    const store = new FakeStore([ev(1, 'STATE_SYNC'), ev(2, 'ORDER_SENT'), ev(3, 'STATE_SYNC')])
    const fetchImpl = mockFetch(() => ({ status: 201 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.sent, 1)
    assert.deepEqual(fetchImpl.calls.map((c) => c.body.type), ['ORDER_SENT'])
    // los STATE_SYNC siguen synced:false pero nunca se envían
    assert.equal(fetchImpl.calls.length, 1)
  })

  test('salta eventos ya synced (idempotencia entre flushes)', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT', { synced: true }), ev(2, 'ORDER_SENT')])
    const fetchImpl = mockFetch(() => ({ status: 201 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.sent, 1)
    assert.deepEqual(fetchImpl.calls.map((c) => c.body.sequence), [2])
    // segundo flush: nada que enviar
    const r2 = await w.flush()
    assert.equal(r2.pending, 0)
    assert.equal(fetchImpl.calls.length, 1)
  })

  test('en fallo duro (500) para el FIFO y deja el resto para reintentar', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT'), ev(2, 'ORDER_SENT'), ev(3, 'ORDER_SENT')])
    // el seq 2 falla → no debe enviarse el 3 (preserva orden)
    const fetchImpl = mockFetch((body) => ({ status: body.sequence === 2 ? 500 : 201 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.sent, 1)          // solo el 1 se confirmó
    assert.equal(r.failedAt, 2)
    assert.deepEqual(fetchImpl.calls.map((c) => c.body.sequence), [1, 2])  // no llegó al 3
    assert.deepEqual(store.unsynced().map((e) => e.sequence), [2, 3])
  })

  test('reintento tras reconexión sincroniza los que fallaron', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT'), ev(2, 'ORDER_SENT')])
    let online = false
    const fetchImpl = mockFetch(() => ({ status: online ? 201 : 503 }))
    const w = makeWorker(store, fetchImpl)
    await w.flush()                  // offline → nada confirmado
    assert.equal(store.unsynced().length, 2)
    online = true
    const r = await w.flush()        // reconecta → sube todo
    assert.equal(r.sent, 2)
    assert.equal(store.unsynced().length, 0)
  })

  test('409 (browser ya sincronizó) → marca synced sin sobreescribir', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT')])
    const fetchImpl = mockFetch(() => ({ status: 409 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.conflicts, 1)
    assert.equal(r.sent, 1)
    assert.equal(store.unsynced().length, 0)  // resuelto (no se reintenta infinito)
  })

  test('store vacío → no-op', async () => {
    const store = new FakeStore([])
    const w = makeWorker(store, mockFetch(() => ({ status: 201 })))
    const r = await w.flush()
    assert.deepEqual(r, { pending: 0, sent: 0, conflicts: 0, failedAt: null })
  })

  test('respeta batchSize', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT'), ev(2, 'ORDER_SENT'), ev(3, 'ORDER_SENT')])
    const fetchImpl = mockFetch(() => ({ status: 201 }))
    const w = new OutboxWorker({
      eventStore: store, supabaseUrl: 'https://sb.test', supabaseKey: 'k',
      restaurantId: 'r1', fetchImpl, batchSize: 2, logger: () => {},
    })
    const r = await w.flush()
    assert.equal(r.sent, 2)          // solo 2 por batch
    assert.equal(store.unsynced().length, 1)
  })
})

describe('OutboxWorker construcción', () => {
  test('exige eventStore y restaurantId', () => {
    assert.throws(() => new OutboxWorker({ restaurantId: 'r1' }), /eventStore/)
    assert.throws(() => new OutboxWorker({ eventStore: {} }), /restaurantId/)
  })
})
