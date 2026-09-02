'use strict'
// posServerPort: el POS secundario reenvía a la caja al puerto CONFIGURADO,
// no a su propio puerto. Antes `forwardPost` usaba el puerto del secundario,
// acoplando a todos al 7717 — dos Pedros en una misma máquina (pruebas
// multi-terminal, demos, multi-instancia del esqueleton) rompían el forward.
//
// Se cablean los componentes reales via buildHttpRouter (patrón de
// offline-integration.test.js) en vez de startLocalServer, cuyos timers
// (updater/heartbeat) dejan el event loop vivo y cuelgan node --test.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const { buildHttpRouter } = require('../index.js')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore } = require('../core/event-store')
const { RestaurantState } = require('../core/state')
const { CommandHandler } = require('../core/command-handler')

const R = 'testtenant'

async function buildServer(dir, port, config = {}) {
  const store = new NdjsonEventStore({
    eventLogPath: path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()
  const state = new RestaurantState()
  const fakeHub = { broadcast: async () => {} }
  const fakePrinter = { printToStation: async () => {} }
  const cmdHandler = new CommandHandler({ eventStore, state, wsHub: fakeHub, printer: fakePrinter, restaurantId: R })
  const router = buildHttpRouter({
    state, eventStore, wsHub: fakeHub, cmdHandler, printer: fakePrinter,
    version: 'test', serverId: `srv-${port}`, restaurantId: R, config, port,
  })
  const server = http.createServer(router)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, state }
}

test('el secundario reenvía /events a la caja usando posServerPort', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-port-'))
  fs.mkdirSync(path.join(tmp, 'caja')); fs.mkdirSync(path.join(tmp, 'sec'))
  const CAJA = 7741, SEC = 7742
  const caja = await buildServer(path.join(tmp, 'caja'), CAJA)
  const sec = await buildServer(path.join(tmp, 'sec'), SEC, { posServerIp: '127.0.0.1', posServerPort: CAJA })
  try {
    const res = await fetch(`http://127.0.0.1:${SEC}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: 'fwd-1', command_type: 'ORDER_SENT', order_id: 'o-fwd', mesa: 1,
        mesero: 'test', status: 'enviada', items: [{ nombre: 'Prueba', station: 'cocina' }],
      }),
    })
    assert.equal(res.status, 200)
    const st = caja.state.toSnapshot()
    assert.ok(st.kds_orders.some(o => o.id === 'o-fwd'), 'la orden debe llegar a la caja')
    const stSec = sec.state.toSnapshot()
    assert.ok(!stSec.kds_orders.some(o => o.id === 'o-fwd'), 'el secundario no guarda estado propio')
  } finally {
    await new Promise((r) => sec.server.close(r))
    await new Promise((r) => caja.server.close(r))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
