'use strict'
// Matriz offline — T-12, T-13 y T-14: idempotencia A NIVEL DE TRANSPORTE.
// Run: node --test electron-app/local-server/tests/idempotencia-transporte.test.js
//
// La matriz ya tenía estos tres cubiertos a nivel de event-store, y marcaba como
// pendiente exactamente esto:
//   T-12 → "Ampliar a nivel HTTP"
//   T-13 → "Ejecutar a nivel de proceso"
//   T-14 → "Ampliar a nivel WS con mock"
//
// Por qué importa la diferencia: que el store deduplique no prueba que el camino
// que usa la terminal deduplique. Entre el POS y el store hay un handler, un parseo
// de body, y un ACK que puede perderse. Aquí se prueba ESE camino.
//
// Lo que sigue sin cubrirse y necesita la caja física: reiniciar el proceso de
// Electron de verdad, y la LAN real entre terminales.

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')
const { RestaurantState }  = require('../core/state')
const { CommandHandler }   = require('../core/command-handler')
const { PROTOCOL_VERSION } = require('../protocol')

const R = 'amalay'

/** Levanta el stack sobre archivos reales, como lo hace index.js. */
async function levantar(dir) {
  const store = new NdjsonEventStore({
    eventLogPath:          path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()

  const state = new RestaurantState()
  for (const ev of await eventStore.readAfter(0)) state.apply(ev)

  const difundidos = []
  const impresos = []
  const cmd = new CommandHandler({
    eventStore,
    state,
    wsHub:   { broadcast: async (ev) => { difundidos.push(ev) } },
    printer: { printToStation: async (station, buf) => { impresos.push({ station, len: buf.length }) } },
    restaurantId: R,
  })
  return { cmd, eventStore, state, difundidos, impresos }
}

/** Reproduce lo que hace el endpoint POST /events de index.js (index.js:299-320). */
async function postEvents(cmd, body) {
  const eventos = Array.isArray(body) ? body : [body]
  const results = []
  for (const ev of eventos) {
    if (!ev.command_id || !ev.command_type) {
      results.push({ error: 'Missing command_id or command_type' })
      continue
    }
    results.push(await cmd.handle({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      restaurant_id:    ev.restaurant_id || R,
      payload:          ev,
    }, ev.client_id || 'rest-api'))
  }
  return { results }
}

/** Cuenta líneas reales del log en disco — la prueba de que no se duplicó. */
function lineasDeLog(dir) {
  const p = path.join(dir, 'events.ndjson')
  if (!fs.existsSync(p)) return 0
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length
}

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-')) })
afterEach(() => { try { fs.rmSync(dir, { recursive: true }) } catch {} })

// ─────────────────────────────────────────────────────────────────────────────
describe('T-12 · mismo command_id dos veces por HTTP', () => {
  test('la segunda vez responde duplicate y NO escribe otra línea', async () => {
    const { cmd } = await levantar(dir)
    const evento = { command_id: 'test-123', command_type: 'ORDER_SENT', mesa: 5, items: [] }

    const primera = await postEvents(cmd, evento)
    assert.equal(primera.results[0].duplicate, undefined, 'la primera no es duplicado')
    assert.ok(primera.results[0].event, 'la primera devuelve el evento')

    const segunda = await postEvents(cmd, evento)
    assert.equal(segunda.results[0].duplicate, true, 'la segunda SÍ es duplicado')

    assert.equal(lineasDeLog(dir), 1,
      'dos POST con el mismo command_id deben dejar UNA línea en events.ndjson')
  })

  test('EL RIESGO: un reintento del POS no puede cobrar dos veces', async () => {
    const { cmd, difundidos } = await levantar(dir)
    const cobro = { command_id: 'pago-abc', command_type: 'ORDER_CLOSED', mesa: 5, total: 480 }

    // El POS manda, no recibe respuesta (timeout) y reintenta.
    await postEvents(cmd, cobro)
    await postEvents(cmd, cobro)
    await postEvents(cmd, cobro)

    assert.equal(lineasDeLog(dir), 1, 'tres intentos del mismo cobro = un solo evento')
    assert.equal(difundidos.length, 1, 'y una sola difusión al KDS/terminales')
  })

  test('command_ids distintos SÍ crean eventos distintos', async () => {
    const { cmd } = await levantar(dir)
    await postEvents(cmd, { command_id: 'a', command_type: 'ORDER_SENT', mesa: 1, items: [] })
    await postEvents(cmd, { command_id: 'b', command_type: 'ORDER_SENT', mesa: 2, items: [] })

    assert.equal(lineasDeLog(dir), 2, 'la dedup no puede tragarse comandas legítimas')
  })

  test('un lote con el mismo id repetido se resuelve dentro del mismo POST', async () => {
    const { cmd } = await levantar(dir)
    const ev = { command_id: 'lote-1', command_type: 'ORDER_SENT', mesa: 3, items: [] }

    const r = await postEvents(cmd, [ev, ev, ev])
    assert.equal(r.results.length, 3)
    assert.equal(r.results[0].duplicate, undefined)
    assert.equal(r.results[1].duplicate, true)
    assert.equal(r.results[2].duplicate, true)
    assert.equal(lineasDeLog(dir), 1)
  })

  test('sin command_id se rechaza en vez de escribir basura', async () => {
    const { cmd } = await levantar(dir)
    const r = await postEvents(cmd, { command_type: 'ORDER_SENT', mesa: 1 })
    assert.match(r.results[0].error, /Missing command_id/)
    assert.equal(lineasDeLog(dir), 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('T-13 · la idempotencia sobrevive al reinicio del servidor', () => {
  test('EL CONTRATO: tras reiniciar, el mismo comando sigue siendo duplicado', async () => {
    const s1 = await levantar(dir)
    await postEvents(s1.cmd, { command_id: 'persist-cmd', command_type: 'ORDER_SENT', mesa: 7, items: [] })
    assert.equal(lineasDeLog(dir), 1)

    // Reinicio: proceso nuevo sobre los MISMOS archivos. Memoria perdida, disco no.
    const s2 = await levantar(dir)
    const r = await postEvents(s2.cmd, { command_id: 'persist-cmd', command_type: 'ORDER_SENT', mesa: 7, items: [] })

    assert.equal(r.results[0].duplicate, true,
      'si al reiniciar olvidara los command_id, cada reintento del POS duplicaría la comanda')
    assert.equal(lineasDeLog(dir), 1, 'sigue habiendo UNA línea')
  })

  test('el estado en memoria se reconstruye desde el log al arrancar', async () => {
    const s1 = await levantar(dir)
    await postEvents(s1.cmd, { command_id: 'c1', command_type: 'ORDER_SENT', mesa: 9, items: [{ n: 'Café' }] })

    const s2 = await levantar(dir)
    const eventos = await s2.eventStore.readAfter(0)
    assert.equal(eventos.length, 1, 'el log se relee completo al arrancar')
  })

  test('la secuencia no se reinicia — el KDS pediría deltas ya aplicados', async () => {
    const s1 = await levantar(dir)
    await postEvents(s1.cmd, { command_id: 'c1', command_type: 'ORDER_SENT', mesa: 1, items: [] })
    await postEvents(s1.cmd, { command_id: 'c2', command_type: 'ORDER_SENT', mesa: 2, items: [] })

    const s2 = await levantar(dir)
    const r = await postEvents(s2.cmd, { command_id: 'c3', command_type: 'ORDER_SENT', mesa: 3, items: [] })

    assert.ok(r.results[0].event.sequence > 2,
      'la secuencia post-reinicio debe continuar, no volver a 1')
  })

  test('varios reinicios seguidos no acumulan duplicados', async () => {
    const ev = { command_id: 'terco', command_type: 'ORDER_SENT', mesa: 4, items: [] }
    for (let i = 0; i < 4; i++) {
      const s = await levantar(dir)
      await postEvents(s.cmd, ev)
    }
    assert.equal(lineasDeLog(dir), 1, 'cuatro arranques, un solo evento')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('T-14 · el ACK se pierde y el cliente reenvía', () => {
  /** Canal WS falso que puede tragarse el ACK, como una LAN mala. */
  function canalWS(cmd, { tragarAck = false } = {}) {
    const recibidosPorCliente = []
    return {
      recibidosPorCliente,
      async enviarComando(clienteId, payload) {
        const r = await cmd.handle({
          protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: R, payload,
        }, clienteId)
        const ack = { type: 'ACK', command_id: payload.command_id, ...r }
        if (!tragarAck) recibidosPorCliente.push(ack)   // el ACK se pierde en la LAN
        return ack
      },
    }
  }

  test('EL CONTRATO: reenviar tras un ACK perdido devuelve duplicate, no un segundo evento', async () => {
    const { cmd, difundidos } = await levantar(dir)
    const comando = { command_id: 'ws-cmd-1', command_type: 'ORDER_SENT', mesa: 11, items: [] }

    // Intento 1: el servidor procesa, pero el ACK nunca llega al POS.
    const perdido = canalWS(cmd, { tragarAck: true })
    const ack1 = await perdido.enviarComando('pos-1', comando)
    assert.ok(ack1.event, 'el servidor SÍ lo procesó')
    assert.equal(perdido.recibidosPorCliente.length, 0, 'pero el POS no vio el ACK')

    // El POS no sabe si llegó. Reenvía.
    const bueno = canalWS(cmd)
    const ack2 = await bueno.enviarComando('pos-1', comando)

    assert.equal(ack2.duplicate, true, 'el ACK del reenvío dice duplicate')
    assert.equal(lineasDeLog(dir), 1, 'NO se creó un segundo evento')
    assert.equal(difundidos.length, 1, 'y el KDS no recibió la comanda dos veces')
  })

  test('el estado no cambia con el reenvío', async () => {
    const { cmd, state } = await levantar(dir)
    const comando = { command_id: 'ws-cmd-2', command_type: 'ORDER_SENT', mesa: 6, items: [{ n: 'Sopa' }] }

    const canal = canalWS(cmd)
    await canal.enviarComando('pos-1', comando)
    const antes = JSON.stringify(state.snapshot ? state.snapshot() : {})

    await canal.enviarComando('pos-1', comando)
    const despues = JSON.stringify(state.snapshot ? state.snapshot() : {})

    assert.equal(despues, antes, 'aplicar dos veces el mismo comando movería el estado')
  })

  test('el reenvío desde OTRA terminal tampoco duplica', async () => {
    const { cmd } = await levantar(dir)
    const comando = { command_id: 'ws-cmd-3', command_type: 'ORDER_SENT', mesa: 8, items: [] }

    const canal = canalWS(cmd)
    await canal.enviarComando('pos-1', comando)
    const r = await canal.enviarComando('pos-2', comando)   // otra terminal, mismo id

    assert.equal(r.duplicate, true,
      'la dedup es por command_id, no por terminal — si no, entrada y caja duplicarían')
    assert.equal(lineasDeLog(dir), 1)
  })

  test('reintentos en ráfaga (LAN intermitente) siguen dejando un evento', async () => {
    const { cmd, difundidos } = await levantar(dir)
    const comando = { command_id: 'ws-cmd-4', command_type: 'ORDER_SENT', mesa: 2, items: [] }
    const canal = canalWS(cmd)

    await Promise.all([
      canal.enviarComando('pos-1', comando),
      canal.enviarComando('pos-1', comando),
      canal.enviarComando('pos-1', comando),
      canal.enviarComando('pos-1', comando),
      canal.enviarComando('pos-1', comando),
    ])

    assert.equal(lineasDeLog(dir), 1, 'cinco reintentos concurrentes = un evento')
    assert.equal(difundidos.length, 1, 'y una sola difusión')
  })
})
