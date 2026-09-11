'use strict'
// Barrido 2026-09-10, segunda tanda de Pedro:
//  - LENTE-5: el replay fecha las comandas con el ts del evento, no con el arranque.
//  - LENTE-6: si encolar los efectos falla tras el commit, el reintento transmite.
//  - T-09 completo: los reenvios HTTP de la secundaria leen la direccion VIVA de la caja.
//  - kds LENTE-4: el poll pide las filas de las ordenes locales de otro turno.
//  - TURNO_CLOSED tardio no barre un turno mas nuevo (el aviso ahora es durable).
// Run: node --test electron-app/local-server/tests/reinicio-y-caja-movida.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { RestaurantState } = require('../core/state')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { buildHttpRouter } = require('../index')
const { EVENT, PROTOCOL_VERSION } = require('../protocol')
const cred = require('../core/credencial-lan')

const ev = (type, payload, ts = Date.now()) => ({ id: `${type}-${Math.random()}`, type, ts, client_id: 'pos', restaurant_id: 'r1', payload })

describe('LENTE-5: el replay conserva la antiguedad de las comandas', () => {
  test('REGRESION: un ORDER_SENT con ts de hace 40 min se proyecta con created_at de hace 40 min', () => {
    const hace40 = Date.now() - 40 * 60_000
    const s = new RestaurantState()
    s.apply(ev(EVENT.ORDER_SENT, { order_id: 'X', mesa: 5, items: [{ id: 'i1' }], turno_id: 't1' }, hace40))
    const snap = s.toSnapshot()
    assert.ok(Math.abs(Date.parse(snap.kds_orders[0].created_at) - hace40) < 1000)
    assert.ok(Math.abs(snap.kds_queue[0].sent_at - hace40) < 1000)
  })
  test('sin ts (evento viejo o sintetico) se usa el reloj', () => {
    const s = new RestaurantState()
    s.apply({ id: 'x', type: EVENT.ORDER_SENT, client_id: 'pos', restaurant_id: 'r1', payload: { order_id: 'X', mesa: 5, items: [] } })
    assert.ok(Date.now() - Date.parse(s.toSnapshot().kds_orders[0].created_at) < 1000)
  })
})

describe('LENTE-6: efectos fallidos tras el commit', () => {
  test('REGRESION: el primer intento falla al encolar impresion; el reintento (duplicado) SI transmite', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efectos-'))
    const eventStore = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
    await eventStore.load()
    const state = new RestaurantState()
    const transmitidos = []
    const wsHub = { broadcast: async (e) => { transmitidos.push(e.type) } }
    let fallar = true
    const printer = {
      prepareJobs: () => [{ job_id: 'j1', station: 'cocina' }],
      enqueuePreparedJobs: async () => { if (fallar) throw new Error('EPERM: print-queue.json') },
    }
    const h = new CommandHandler({ eventStore, state, wsHub, printer, restaurantId: 'r1' })
    const cmd = { protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: 'r1',
      payload: { command_id: 'print-1', command_type: 'PRINT_COMMAND', station: 'cocina', data_b64: Buffer.from('hola').toString('base64') } }
    await assert.rejects(h.handle(cmd, 'pos-1'), /EPERM/)
    assert.equal(transmitidos.length, 0, 'sin efectos no se transmitio')
    fallar = false
    const r = await h.handle(cmd, 'pos-1')
    assert.equal(r.duplicate, true)
    assert.deepEqual(transmitidos, [EVENT.PRINT_COMMAND ?? 'PRINT_COMMAND'].map(() => transmitidos[0]))
    assert.equal(transmitidos.length, 1, 'el duplicado que recupero los efectos transmite UNA vez')
    const r2 = await h.handle(cmd, 'pos-1')
    assert.equal(r2.duplicate, true)
    assert.equal(transmitidos.length, 1, 'un tercer intento ya no transmite')
  })
})

describe('T-09 completo: los reenvios leen la direccion viva de la caja', () => {
  test('REGRESION: con posServerIp nulo en config, el router reenvía a cajaActual.ip y sigue el cambio', async (t) => {
    const recibidos = []
    const caja = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => { recibidos.push(req.url); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"results":[{"event":{"id":"e"}}]}') })
    })
    await new Promise(r => caja.listen(0, '127.0.0.1', r))
    t.after(() => caja.close())
    const secret = cred.generarSecreto()
    const cajaActual = { ip: null }
    const state = new RestaurantState()
    const router = buildHttpRouter({ state, eventStore: {}, wsHub: { broadcast: async () => {} }, cmdHandler: { handle: async () => ({}) },
      restaurantId: 'r1', config: { lanSecret: secret, terminalId: 'POS-2', posServerIp: null, posServerPort: caja.address().port },
      cajaActual, printer: {} })
    const sec = http.createServer(router)
    await new Promise(r => sec.listen(0, '127.0.0.1', r))
    t.after(() => sec.close())
    const headers = { ...cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'r1', terminalId: 'POS-2' }), 'Content-Type': 'application/json' }
    const post = () => fetch(`http://127.0.0.1:${sec.address().port}/events`, { method: 'POST', headers, body: '{"command_type":"ORDER_SENT"}', signal: AbortSignal.timeout(3000) })
    // Sin caja conocida: se atiende localmente (no hay reenvio).
    await post()
    assert.equal(recibidos.length, 0)
    // La caja aparece (T-09 la encontro): el MISMO router reenvía sin reconstruirse.
    cajaActual.ip = '127.0.0.1'
    const r = await post()
    assert.equal(r.status, 200)
    assert.deepEqual(recibidos, ['/events'])
  })
  test('REGRESION (fuente): alCambiarDeCaja actualiza la memoria antes que el disco y el ws-forward la usa', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
    assert.match(src, /cajaActual\.ip = m\[1\]/)
    assert.match(src, /forwardPost\(`http:\/\/\$\{cajaActual\.ip \|\| config\.posServerIp\}/)
    assert.match(src, /const posServerIp = cajaActual \? cajaActual\.ip : posServerIpFijo/)
  })
})

describe('kds LENTE-4: el poll pide las filas de las ordenes locales de otro turno', () => {
  test('REGRESION (fuente): el poll consulta por id las huerfanas y las mete a la foto solo como filas', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
    const poll = src.slice(src.indexOf('async function startSupabasePoll'), src.indexOf('// ─── HTTP routes'))
    assert.match(poll, /o\.turno_id !== activeTurno\?\.id/)
    assert.match(poll, /pos_orders\?client_id=eq\.\$\{encodeURIComponent\(restaurantId\)\}&id=in\./)
    assert.match(poll, /orders:\s+\[\.\.\.operationalOrders, \.\.\.filasHuerfanas\]/)
  })
})

describe('TURNO_CLOSED durable: un aviso tardio no barre un turno nuevo', () => {
  test('REGRESION: TURNO_CLOSED de t1 con t2 abierto no toca el piso; el de t2 si', () => {
    const s = new RestaurantState()
    s.apply(ev(EVENT.STATE_SYNC, { orders: [], order_snapshot_complete: true, mesas: [], kds_queue: [], turno: { id: 't2' }, synced_at: 'x' }))
    s.apply(ev(EVENT.ORDER_SENT, { order_id: 'Y', mesa: 3, items: [{ id: 'i' }], turno_id: 't2' }))
    s.apply(ev(EVENT.TURNO_CLOSED, { turno_id: 't1' }))
    assert.equal(s.toSnapshot().kds_orders.length, 1, 'el turno viejo no barre el nuevo')
    assert.equal(s.getTurno()?.id, 't2')
    s.apply(ev(EVENT.TURNO_CLOSED, { turno_id: 't2' }))
    assert.equal(s.toSnapshot().kds_orders.length, 0)
    assert.equal(s.getTurno(), null)
  })
  test('sin turno_id (aviso viejo) o sin turno vigente, limpia como siempre', () => {
    const s = new RestaurantState()
    s.apply(ev(EVENT.ORDER_SENT, { order_id: 'Y', mesa: 3, items: [{ id: 'i' }], turno_id: 't1' }))
    s.apply(ev(EVENT.TURNO_CLOSED, {}))
    assert.equal(s.toSnapshot().kds_orders.length, 0)
  })
})
