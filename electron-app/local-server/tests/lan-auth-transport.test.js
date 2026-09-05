'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { once } = require('node:events')
const WebSocket = require('ws')
const { buildHttpRouter } = require('../index')
const { WsHub } = require('../core/ws-hub')
const { prepararCredencial } = require('../core/credencial-lan')
const { rendererIdentity } = require('../core/renderer-identity')
const { SECRET } = require('./fixtures/lan-credential.cjs')

const R = 'auth-test', BRANCH = 'principal'
const auth = { 'x-fullsite-lan': SECRET, 'x-fullsite-restaurante': R, 'x-fullsite-sucursal': BRANCH }
const envelope = (type, extra = {}) => JSON.stringify({ protocol_version: '1.0', type, ...extra })

async function fixture(t, config = {}) {
  let commands = 0, printCalls = 0
  const state = { toSnapshot: () => ({ mesas: [], kds_orders: [], marker: 'operacion-privada' }) }
  const store = { getLastSequence: async () => commands, readAfter: async () => [], unsyncedCount: async () => 0 }
  const hub = new WsHub({ serverId: 'caja', restaurantId: R, branchId: BRANCH, lanSecret: Object.hasOwn(config, 'lanSecret') ? config.lanSecret : SECRET,
    getState: state.toSnapshot, getLastSequence: store.getLastSequence, readAfter: store.readAfter })
  const handler = { handle: async () => { commands++; return { event: { id: 'accepted' } } } }
  hub.onCommand(handler.handle)
  const printer = { printToStation: async () => printCalls++, kickDrawer: async () => printCalls++,
    getPrintJobsFailed: () => 0, getStations: () => ({}) }
  const server = http.createServer(buildHttpRouter({ state, eventStore: store, wsHub: hub,
    cmdHandler: handler, printer, serverId: 'caja', restaurantId: R, branchId: BRANCH,
    config: { lanSecret: SECRET, branchId: BRANCH, ...config }, port: 0 }))
  hub.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { hub.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, hub, commands: () => commands, printCalls: () => printCalls,
    ws: async (headers) => { const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', headers ? { headers } : {}); await once(ws, 'open'); return ws } }
}

test('HTTP niega operación y página KDS sin credencial; diagnóstico sigue disponible', async t => {
  const f = await fixture(t)
  for (const [route, method] of [['/state', 'GET'], ['/events', 'POST'], ['/drawer', 'POST'], ['/config', 'POST'], ['/test', 'POST'], ['/fp/list', 'GET'], ['/kds', 'GET']]) {
    const res = await fetch(f.base + route, { method })
    assert.equal(res.status, 401, route)
    assert.equal((await res.text()).includes(SECRET), false)
  }
  assert.equal(f.commands(), 0)
  assert.equal(f.printCalls(), 0)
  assert.equal((await fetch(f.base + '/identity')).status, 200)
  assert.equal((await fetch(f.base + '/health')).status, 200)
  const preflight = await fetch(f.base + '/events', { method: 'OPTIONS' })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-fullsite-sucursal/)
})

test('HTTP valida credencial, restaurante, sucursal y todo el batch antes de escribir', async t => {
  const f = await fixture(t)
  for (const headers of [{ ...auth, 'x-fullsite-lan': 'wrong' }, { ...auth, 'x-fullsite-restaurante': 'other' }, { ...auth, 'x-fullsite-sucursal': 'other' }]) {
    assert.equal((await fetch(f.base + '/state', { headers })).status, 401)
  }
  assert.equal((await fetch(f.base + '/state', { headers: auth })).status, 200)
  const command = { command_id: 'one', command_type: 'ORDER_SENT', scope: { clientId: R, locationId: BRANCH } }
  const bad = await fetch(f.base + '/events', { method: 'POST', headers: auth,
    body: JSON.stringify([command, { ...command, command_id: 'two', scope: { clientId: R, locationId: 'other' } }]) })
  assert.equal(bad.status, 403)
  assert.equal(f.commands(), 0)
  assert.equal((await fetch(f.base + '/events', { method: 'POST', headers: auth, body: JSON.stringify(command) })).status, 200)
  assert.equal(f.commands(), 1)
})

test('una secundaria sin emparejar falla cerrada, no inventa secreto ni permite operación', async t => {
  const f = await fixture(t, { lanSecret: null, terminalRole: 'pos' })
  assert.equal((await fetch(f.base + '/state', { headers: auth })).status, 401)
  const config = { terminalRole: 'pos', posServerIp: '127.0.0.1' }
  assert.equal(prepararCredencial({ dataDir: '/unused', config }), null)
  assert.equal(prepararCredencial({ dataDir: '/unused', config: { terminalRole: 'pos' } }), null)
})

test('WS COMMAND antes de SUBSCRIBE no ejecuta ni entrega datos', async t => {
  const f = await fixture(t)
  const ws = await f.ws()
  const messages = []
  ws.on('message', data => messages.push(data.toString()))
  const closed = once(ws, 'close')
  ws.send(envelope('COMMAND', { restaurant_id: R, payload: { command_id: 'attack', command_type: 'ORDER_SENT' } }))
  assert.equal((await closed)[0], 1008)
  assert.equal(f.commands(), 0)
  assert.equal(f.hub.clientCount(), 0)
  assert.deepEqual(messages, [])
})

test('WS SUBSCRIBE sin credencial no recibe snapshot/broadcast; browser enrolado sí recibe y opera', async t => {
  const f = await fixture(t)
  const unauth = await f.ws()
  const messages = []
  unauth.on('message', data => messages.push(data.toString()))
  const rejected = once(unauth, 'close')
  unauth.send(envelope('SUBSCRIBE', { client_id: 'guest', restaurant_id: R }))
  assert.equal((await rejected)[0], 1008)
  await f.hub.broadcast({ type: 'ORDER_SENT', payload: {} })
  assert.deepEqual(messages, [])

  const ws = await f.ws()
  const snapshot = once(ws, 'message')
  ws.send(envelope('SUBSCRIBE', { lan_secret: SECRET, client_id: 'pos-2', restaurant_id: R, location_id: BRANCH }))
  assert.equal(JSON.parse((await snapshot)[0]).type, 'SNAPSHOT')
  const ack = once(ws, 'message')
  ws.send(envelope('COMMAND', { restaurant_id: R, payload: { command_id: 'sale', command_type: 'ORDER_SENT' } }))
  assert.equal(JSON.parse((await ack)[0]).type, 'ACK')
  assert.equal(f.commands(), 1)
  const close = once(ws, 'close')
  ws.send(envelope('COMMAND', { restaurant_id: R, payload: { scope: { locationId: 'other' } } }))
  assert.equal((await close)[0], 1008)
  assert.equal(f.commands(), 1)
})

test('WS Node puede autenticar upgrade y un secreto falso falla antes del handshake', async t => {
  const f = await fixture(t)
  const ws = await f.ws(auth)
  const snapshot = once(ws, 'message')
  ws.send(envelope('SUBSCRIBE', { client_id: 'uplink', restaurant_id: R }))
  assert.equal(JSON.parse((await snapshot)[0]).type, 'SNAPSHOT')
  ws.close()
  const bad = new WebSocket(f.base.replace('http:', 'ws:') + '/ws', { headers: { ...auth, 'x-fullsite-lan': 'wrong' } })
  const response = once(bad, 'unexpected-response')
  const [, res] = await response
  assert.equal(res.statusCode, 401)
  res.resume()
  bad.on('error', () => {})
  bad.terminate()
})

test('credencial generada está persistida antes de crear router y sobrevive reinicio', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-secret-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const config = { terminalRole: 'server_pos' }
  const generated = prepararCredencial({ dataDir: dir, config })
  assert.equal(generated.length, 64)
  assert.equal(prepararCredencial({ dataDir: dir, config: { terminalRole: 'server_pos' } }), generated)
  const f = await fixture(t, config)
  assert.equal((await fetch(f.base + '/state', { headers: { 'x-fullsite-lan': generated } })).status, 200)
})

test('KDS autenticado conserva HTTP local y añade credenciales a lectura y envío', async t => {
  const f = await fixture(t)
  const res = await fetch(f.base + '/kds', { headers: auth })
  assert.equal(res.status, 200)
  const html = await res.text()
  const json = html.match(/window\.__KDS_CFG__=(.*?);<\/script>/)[1]
  const cfg = JSON.parse(json)
  assert.equal(cfg.bridge_base, '')
  assert.equal(cfg.headers['x-fullsite-lan'], SECRET)
  // Ejecutar los dos calls reales del archivo, sin reemplazar su construcción de headers.
  const calls = []
  const context = { CFG: cfg, Object, Date, JSON, ACTOR_KEY: 'pos_actor_session', sessionStorage: { getItem: () => null } }
  vm.runInNewContext(html.match(/function actorSession\(\)\{[^\n]*\}/)[0], context)
  vm.runInNewContext(html.match(/function authHeaders\(extra\)\{[^\n]*\}/)[0], context)
  for (const extra of [undefined, { 'Content-Type': 'application/json' }]) {
    calls.push(await fetch(f.base + '/state', { headers: context.authHeaders(extra) }))
  }
  assert.ok(calls.every(r => r.status === 200))
  context.sessionStorage.getItem = () => JSON.stringify({ staff: { id: 'synthetic-employee' }, actor_token: 'synthetic-signed-session', expires_at: Date.now() + 60000 })
  assert.equal(context.authHeaders()['x-fullsite-actor'], 'synthetic-signed-session')
  assert.match(html, /fetch\(STATE_BASE\+"\/state",\{[^\n]*headers:authHeaders\(\)/)
  assert.match(html, /fetch\(STATE_BASE\+"\/events",\{[^\n]*headers:authHeaders\(/)
})

test('Caja transport credential alone cannot open drawer, inject print bytes or alter printing configuration', async t => {
  const f = await fixture(t, { localAuthorityEnabled: true })
  for (const route of ['/drawer', '/print', '/test', '/config', '/print/resolve']) {
    const response = await fetch(f.base + route, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: Buffer.from([0x1b, 0x70]).toString('base64'), resolution: 'reprint', job_id: 'old' }) })
    assert.equal(response.status, 409, route)
    assert.equal((await response.json()).code, 'CONTROLLED_PRINT_REQUIRED')
  }
  assert.equal(f.printCalls(), 0)
})

test('preloads disponen identidad antes del primer fetch, nunca desde URL o navegación ajena', async t => {
  const f = await fixture(t)
  const config = { restaurant_id: R, terminal_id: 'pos-2', location_id: BRANCH, lan_secret: SECRET }
  const posUrl = 'http://127.0.0.1:3999/pos'
  assert.equal(rendererIdentity({ url: posUrl, config, posUrl, dev: false }), null)
  assert.equal(rendererIdentity({ url: 'https://evil.invalid/?client=auth-test', config, posUrl, dev: true }), null)
  for (const name of ['preload.js', 'preload-kds.js']) {
    for (const url of [posUrl, 'https://evil.invalid/?client=auth-test&bridge=127.0.0.1']) {
      const values = new Map()
      const identity = rendererIdentity({ url, config, port: Number(new URL(f.base).port), posUrl, dev: true })
      const localStorage = { setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
      const electron = { contextBridge: { exposeInMainWorld: () => {} }, ipcRenderer: { sendSync: () => identity } }
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../', name), 'utf8'), {
        require: () => electron, window: { localStorage, location: new URL(url) },
      })
      const headers = values.has('FULLSITE_LAN_SECRET') ? { 'x-fullsite-lan': values.get('FULLSITE_LAN_SECRET') } : {}
      assert.equal((await fetch(f.base + '/state', { headers })).status, identity ? 200 : 401, name + url)
      if (!identity) assert.equal(values.size, 0)
    }
  }
})
