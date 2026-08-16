'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TERMINAL SIMULADO — valida que varias terminales COMPARTEN estado offline
// a través del hub del Local Server (el temor: "2 terminales no comparten mesas").
//
// Modelo: UN Local Server autoritativo (eventStore + state real + CommandHandler)
// con un hub que reenvía cada broadcast a N terminales; cada terminal mantiene su
// propio RestaurantState alimentado por los broadcasts (como el browser en LAN).
// Terminal A toma orden → el broadcast llega a B y C → todos ven lo mismo.
//
// Cubre: propagación de estado entre terminales, KDS compartido, coordinación de
// locks de mesa, y que el cierre se propaga. NO cubre (necesita hardware): el
// transporte WS real, descubrimiento mDNS, ni la confiabilidad de la LAN física.
//
// Run: node --test electron-app/local-server/tests/offline-multiterminal.test.js
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')
const { RestaurantState }  = require('../core/state')
const { CommandHandler }   = require('../core/command-handler')

const R = 'amalay'

// Levanta un Local Server autoritativo + un hub que reparte broadcasts a terminales.
async function buildServer(dir) {
  const store = new NdjsonEventStore({
    eventLogPath:          path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()

  const serverState = new RestaurantState()   // autoridad del LAN
  const terminals = []                          // cada uno = { id, state }

  // Hub: reenvía cada evento a todas las terminales conectadas (como WS broadcast).
  const hub = { broadcast: async (ev) => { for (const t of terminals) t.state.apply(ev) } }
  const printer = { printToStation: async () => {} }
  const cmd = new CommandHandler({ eventStore, state: serverState, wsHub: hub, printer, restaurantId: R })

  const connect = (id) => { const t = { id, state: new RestaurantState() }; terminals.push(t); return t }
  return { cmd, serverState, connect }
}

const send = (cmd, term, payload) =>
  cmd.handle({ payload: { command_id: payload.command_id, ...payload }, restaurant_id: R }, term)

describe('Multi-terminal simulado — estado compartido en LAN', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-multi-')) })
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

  test('una orden en la terminal A aparece en la terminal B (mesa compartida)', async () => {
    const srv = await buildServer(dir)
    const A = srv.connect('term-A')
    const B = srv.connect('term-B')

    await send(srv.cmd, 'term-A', { command_type: 'ORDER_UPSERTED', command_id: 'c1', order_id: 'o1', mesa: '5', items: [{ n: 'taco' }] })

    // B ve la mesa ocupada SIN haber hecho nada (llegó por broadcast del hub)
    assert.equal(B.state.getMesa('5').status, 'ocupada', 'la terminal B debe ver la orden de A')
    assert.equal(B.state.getMesa('5').order_id, 'o1')
    assert.equal(A.state.getMesa('5').status, 'ocupada')
    assert.equal(srv.serverState.getMesa('5').status, 'ocupada')
  })

  test('el KDS se comparte: la comanda enviada en A la ven todas las terminales', async () => {
    const srv = await buildServer(dir)
    const A = srv.connect('term-A')
    const B = srv.connect('term-B')
    const C = srv.connect('term-C')

    await send(srv.cmd, 'term-A', { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '3', items: [{ n: 'sopa' }] })
    await send(srv.cmd, 'term-A', { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '3', items: [{ n: 'sopa' }] })

    for (const t of [A, B, C]) {
      assert.ok(t.state.getKdsQueue().some(k => k.order_id === 'o1'), `${t.id} debe ver la comanda en el KDS`)
    }
  })

  test('lock de mesa cross-terminal: si A la bloquea, B no puede', async () => {
    const srv = await buildServer(dir)
    srv.connect('term-A')
    srv.connect('term-B')

    const rA = await send(srv.cmd, 'term-A', { command_type: 'MESA_LOCK', command_id: 'l1', mesa: '7', client_id: 'term-A', expires_ms: Date.now() + 30000 })
    assert.ok(!rA.error, 'A debe poder bloquear la mesa 7')

    const rB = await send(srv.cmd, 'term-B', { command_type: 'MESA_LOCK', command_id: 'l2', mesa: '7', client_id: 'term-B', expires_ms: Date.now() + 30000 })
    assert.ok(rB.error && /locked/i.test(rB.error), 'B NO debe poder bloquear la mesa que A tiene')
  })

  test('el cierre en A libera la mesa en B', async () => {
    const srv = await buildServer(dir)
    const B = srv.connect('term-B')
    srv.connect('term-A')

    await send(srv.cmd, 'term-A', { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '9', items: [] })
    assert.equal(B.state.getMesa('9').status, 'ocupada')

    await send(srv.cmd, 'term-A', { command_type: 'ORDER_CLOSED', command_id: 'c1', order_id: 'o1', mesa: '9' })
    assert.equal(B.state.getMesa('9').status, 'libre', 'B debe ver la mesa liberada tras el cierre en A')
  })

  test('dos terminales toman órdenes en mesas distintas → ambas visibles para ambas', async () => {
    const srv = await buildServer(dir)
    const A = srv.connect('term-A')
    const B = srv.connect('term-B')

    await send(srv.cmd, 'term-A', { command_type: 'ORDER_UPSERTED', command_id: 'a1', order_id: 'oA', mesa: '1', items: [] })
    await send(srv.cmd, 'term-B', { command_type: 'ORDER_UPSERTED', command_id: 'b1', order_id: 'oB', mesa: '2', items: [] })

    // Cada terminal ve AMBAS mesas ocupadas (estado convergente)
    for (const t of [A, B]) {
      assert.equal(t.state.getMesa('1').status, 'ocupada', `${t.id} ve mesa 1`)
      assert.equal(t.state.getMesa('2').status, 'ocupada', `${t.id} ve mesa 2`)
    }
  })
})
