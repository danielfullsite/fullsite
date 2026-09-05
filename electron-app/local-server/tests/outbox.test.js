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
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.rows ?? [body] }
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

  test('409 no demuestra aplicación: conserva el evento y detiene el FIFO', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT')])
    const fetchImpl = mockFetch(() => ({ status: 409 }))
    const w = makeWorker(store, fetchImpl)
    const r = await w.flush()
    assert.equal(r.conflicts, 1)
    assert.equal(r.sent, 0)
    assert.equal(r.failedAt, 1)
    assert.equal(store.unsynced().length, 1)
  })

  test('store vacío → no-op', async () => {
    const store = new FakeStore([])
    const w = makeWorker(store, mockFetch(() => ({ status: 201 })))
    const r = await w.flush()
    assert.deepEqual(r, { pending: 0, sent: 0, conflicts: 0, failedAt: null })
  })

  test('200 con otra operación nunca confirma este evento ni sobreescribe la fila', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT')])
    const worker = makeWorker(store, async (_url, opts) => {
      assert.match(opts.headers.Prefer, /ignore-duplicates/)
      return { ok: true, status: 201, json: async () => [{ ...JSON.parse(opts.body), payload: { otra: true } }] }
    })
    const result = await worker.flush()
    assert.equal(result.conflicts, 1)
    assert.equal(result.sent, 0)
    assert.equal(store.unsynced().length, 1)
  })

  test('respuesta perdida: al repetir verifica el registro original antes de confirmar', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT')])
    let stored
    let calls = 0
    const worker = makeWorker(store, async (url, opts) => {
      calls++
      if (opts.method === 'POST') {
        if (!stored) { stored = JSON.parse(opts.body); throw new Error('respuesta perdida tras commit cloud') }
        return { ok: true, status: 200, json: async () => [] }
      }
      assert.match(url, /restaurant_id=eq.r1/)
      return { ok: true, status: 200, json: async () => [stored] }
    })
    assert.equal((await worker.flush()).sent, 0)
    assert.equal((await worker.flush()).sent, 1)
    assert.equal(calls, 3)
    assert.equal(store.unsynced().length, 0)
  })

  test('red colgada termina y deja la operación pendiente para reconectar', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT')])
    const worker = new OutboxWorker({ eventStore: store, restaurantId: 'r1',
      supabaseUrl: 'https://sb.test', supabaseKey: 'k', timeoutMs: 20,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
      }), logger: () => {},
    })
    assert.equal((await worker.flush()).failedAt, 1)
    assert.equal(store.unsynced().length, 1)
  })

  test('el worker no envía eventos de otro restaurante', async () => {
    const store = new FakeStore([ev(1, 'ORDER_SENT', { restaurant_id: 'ajeno' })])
    const fetchImpl = mockFetch(() => ({ status: 201 }))
    assert.equal((await makeWorker(store, fetchImpl).flush()).sent, 0)
    assert.equal(fetchImpl.calls.length, 0)
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
