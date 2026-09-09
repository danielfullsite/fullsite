'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { randomUUID } = require('node:crypto')
const { BusinessOutbox } = require('../core/business-outbox')
const { buildHttpRouter } = require('../index')
const cred = require('../core/credencial-lan')

async function serve(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return server
}
test('HTTP success without the exact business receipt never advances or exposes the cloud credential', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-business-outbox-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let valid = false, calls = 0
  const server = await serve(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    calls++
    assert.equal(req.url, '/rest/v1/rpc/apply_pos_caja_event')
    assert.equal(body.p_event.result.turno.opening_cash_cents, 50000, 'committed result is transported')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(valid ? { stream_id: body.p_stream_id, sequence: body.p_event.sequence,
      event_id: body.p_event.id, history_hash: body.p_history_hash, materialized: true, duplicate: false } : { ok: true }))
  })
  const events = [{ id: randomUUID(), sequence: 1, type: 'TURN_OPEN', ts: Date.now(), client_id: 'Caja', restaurant_id: 'lab',
    payload: { command_type: 'TURN_OPEN' }, result: { turno: { opening_cash_cents: 50000 } }, synced: false }]
  const credential = 'synthetic-secret-' + randomUUID()
  const options = { directory, restaurantId: 'lab', locationId: 'branch-a', streamId: randomUUID(), credential,
    eventStore: { readAfter: async () => events }, supabaseUrl: 'https://synthetic.invalid', anonKey: 'synthetic-anon',
    fetchImpl: (url, init) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, init) }
  const worker = new BusinessOutbox(options)
  await assert.rejects(worker.flush(), /INVALID_BUSINESS_RECEIPT/)
  assert.equal(worker.status().last_sequence, 0)
  assert(!fs.existsSync(path.join(directory, 'business-sync-checkpoint.json')))
  valid = true
  const pending = worker.flush()
  assert.equal(worker.flush(), pending, 'concurrent tick shares one transport transaction')
  assert.equal((await pending).confirmed, 1)
  assert.equal(calls, 2)
  const checkpoint = fs.readFileSync(path.join(directory, 'business-sync-checkpoint.json'), 'utf8')
  assert(!checkpoint.includes(credential))
  assert(!JSON.stringify(worker.status()).includes(credential))
  events[0].synced = true
  assert.equal((await new BusinessOutbox(options).flush()).confirmed, 0, 'shadow bookkeeping is not a different business history')
  assert.throws(() => new BusinessOutbox({ ...options, locationId: 'other' }), /scope invalid/)
})

test('sync diagnostics require LAN identity and secondary returns Caja status', async t => {
  const secret = cred.generarSecreto()
  const status = { configured: true, last_sequence: 7, pending_events: 2, error: null }
  const caja = await serve(t, buildHttpRouter({ restaurantId: 'lab', config: { lanSecret: secret, locationId: 'branch-a' }, getBusinessSyncStatus: () => status }))
  const secondary = await serve(t, buildHttpRouter({ restaurantId: 'lab', config: { lanSecret: secret, locationId: 'branch-a',
    posServerIp: '127.0.0.1', posServerPort: caja.address().port } }))
  const url = `http://127.0.0.1:${secondary.address().port}/sync/status`
  assert.equal((await fetch(url)).status, 401)
  const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'lab', branchId: 'branch-a' })
  const response = await fetch(url, { headers })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), status)
})
