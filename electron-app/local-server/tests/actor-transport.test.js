'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { buildHttpRouter } = require('../index')
const { ActorAuthority } = require('../core/actor-authority')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore } = require('../core/event-store')
const { RestaurantState } = require('../core/state')
const { CommandHandler } = require('../core/command-handler')
const cred = require('../core/credencial-lan')
const restaurantId = 'auth-lab', branchId = 'branch-A'

test('PIN and payments forwarded through a secondary retain verified employee/device and never log tokens', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-auth-lan-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const secret = cred.generarSecreto()
  let online = true
  const actorAuthority = new ActorAuthority({ directory: path.join(directory, 'actors'), restaurantId, branchId,
    fetchImpl: async (_url, init) => {
      if (!online) throw new TypeError('offline')
      const { pin, device_id, client_id } = JSON.parse(init.body)
      assert.equal(device_id, 'POS-2')
      assert.equal(client_id, restaurantId)
      return Response.json({ staff: { id: pin === '1234567890' ? 'cashier' : 'waiter', name: 'Empleado de prueba', role: pin === '1234567890' ? 'cajero' : 'mesero' } })
    } })
  async function server(name, config = {}, authority = null) {
    const eventStore = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(directory, name + '.ndjson') }))
    await eventStore.load()
    const state = new RestaurantState()
    const wsHub = { broadcast: async () => {} }
    const cmdHandler = new CommandHandler({ eventStore, state, wsHub, restaurantId })
    const app = http.createServer(buildHttpRouter({ state, eventStore, wsHub, cmdHandler, actorAuthority: authority,
      restaurantId, branchId, config: { lanSecret: secret, terminalId: name, ...config }, printer: {} }))
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve) }))
    return { port: app.address().port, state, eventStore, cmdHandler }
  }
  const caja = await server('Caja', {}, actorAuthority)
  const secondary = await server('Secondary', { posServerIp: '127.0.0.1', posServerPort: caja.port })
  const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId, branchId, terminalId: 'POS-2' })
  const request = (route, payload, extra = {}) => fetch(`http://127.0.0.1:${secondary.port}${route}`, {
    method: payload ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json', ...extra },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(3000),
  })
  assert.equal((await fetch(`http://127.0.0.1:${secondary.port}/auth/pin`, { method: 'POST', body: '{}' })).status, 401)
  const first = await request('/auth/pin', { pin: '1234567890', role: 'admin', deviceId: 'forged' })
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  const cashier = await first.json()
  assert.equal(actorAuthority.verify(cashier.actor_token, 'POS-2').id, 'cashier')
  const waiter = await (await request('/auth/pin', { pin: '0987654321' })).json()
  online = false
  const local = await (await request('/auth/pin', { pin: '1234567890' })).json()
  assert.equal(local.offline, true)
  assert.equal((await (await request('/auth/status')).json()).prepared_users, 2)
  await caja.cmdHandler.handle({ payload: { command_id: 'shift', command_type: 'TURNO_OPENED', turno_id: 't1' } }, 'fixture')
  await caja.cmdHandler.handle({ payload: { command_id: 'order', command_type: 'ORDER_SENT', order_id: 'mother', turno_id: 't1', order_revision: 4, mesa: 1, total: 100, items: [{ id: 'coffee', nombre: 'Café' }] } }, 'fixture')
  const money = async (payload, token = local.actor_token, extra = {}) => {
    const response = await request('/events', payload, { ...(token ? { 'x-fullsite-actor': token } : {}), ...extra })
    return (await response.json()).results[0]
  }
  const open = { command_id: 'open', command_type: 'FINANCIAL_OPEN', order_id: 'mother', turno_id: 't1', expected_revision: 0, expected_order_revision: 4, total_cents: 10000, currency: 'MXN' }
  assert.equal((await money(open, null)).code, 'ACTOR_REQUIRED')
  assert.equal((await money(open, local.actor_token, { 'x-fullsite-terminal': 'Other' })).code, 'ACTOR_REQUIRED')
  assert.equal((await money(open)).result.financial_order.total_cents, 10000)
  const pay = { command_id: 'start', command_type: 'FINANCIAL_PAYMENT_START', order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'pay', amount_cents: 10000, method: 'cash' }
  assert.equal((await money(pay, waiter.actor_token)).code, 'PERMISSION_DENIED')
  assert.equal((await money(pay)).result.financial_order.reserved_cents, 10000)
  const receipt = { command_id: 'result', command_type: 'FINANCIAL_PAYMENT_RESULT', order_id: 'mother', expected_revision: 2, payment_id: 'pay', status: 'accepted', evidence: { kind: 'cash_received', received_by: 'cashier', received_cents: 10000 } }
  assert.equal((await money(receipt)).result.financial_order.paid_cents, 10000)
  const retry = await money(receipt)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.result.financial_order.paid_cents, 10000)
  assert.equal(await secondary.eventStore.getLastSequence(), 0, 'secondary never commits the payment as its own')
  const log = fs.readFileSync(path.join(directory, 'Caja.ndjson'), 'utf8')
  for (const sensitive of [local.actor_token, cashier.actor_token, waiter.actor_token, '1234567890']) assert(!log.includes(sensitive))
  assert.equal(caja.state.toSnapshot().kds_orders.length, 1)
})
