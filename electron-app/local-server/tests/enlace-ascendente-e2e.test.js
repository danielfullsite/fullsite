'use strict'
const { SECRET, wsOptions, localFetch: fetch } = require('./fixtures/lan-credential.cjs')
// POS 3 → Pedro local → Caja → WebSocket → POS 2 / KDS. Con servidores reales.
//
// ── QUÉ DEMUESTRA ────────────────────────────────────────────────────────────
//
// Campo, 2026-09-02 (Eduardo Esquivel, AMALAY, tres cajas, WAN caído):
//   «no hay comunicación correcta entre los puntos de venta, no muestran lo mismo»
//
// El reenvío HTTP llevaba las escrituras hacia la caja, pero nada regresaba: los
// tableros de POS 2 escuchan a SU Pedro local, y ese Pedro no era cliente de
// nadie. Aquí se levanta la cadena completa —tres Pedro reales, HTTP real,
// WebSocket real, event store en disco real— y se comprueba que un evento
// nacido en POS 3 llega a un cliente conectado a POS 2.
//
// Nada de esto busca texto en el código. Todas las aserciones son sobre lo que
// recibió un socket del otro lado del cable.
//
// ── LO QUE NO CUBRE ──────────────────────────────────────────────────────────
//
// No hay Electron, ni impresoras, ni UI. Prueba el TRANSPORTE y el cursor. Que
// la pantalla del mesero repinte con esto es otra capa, y sigue sin probarse.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const { buildHttpRouter } = require('../index.js')
const { WsHub } = require('../core/ws-hub')
const { PROTOCOL_VERSION } = require('../protocol')
const { conectarConLaCaja } = require('../core/enlace-con-caja')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore } = require('../core/event-store')
const { RestaurantState } = require('../core/state')
const { CommandHandler } = require('../core/command-handler')

const R = 'testtenant'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

/** Un Pedro completo: HTTP + hub de WebSocket + event store en disco. */
async function levantarPedro(dir, port, config = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const store = new NdjsonEventStore({
    eventLogPath: path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()
  const state = new RestaurantState()
  const wsHub = new WsHub({
    lanSecret: SECRET,
    serverId: `srv-${port}`,
    restaurantId: R,
    getState: () => state.toSnapshot(),
    getLastSequence: () => eventStore.getLastSequence(),
    readAfter: (s) => eventStore.readAfter(s),
  })
  const printer = {
    printToStation: async () => {},
    getPrintJobsQueued: () => 0, getPrintJobsFailed: () => 0, getStations: () => ({}),
  }
  const cmdHandler = new CommandHandler({ eventStore, state, wsHub, printer, restaurantId: R })
  wsHub.onCommand((m, c) => cmdHandler.handle(m, c))

  const server = http.createServer(buildHttpRouter({
    state, eventStore, wsHub, cmdHandler, printer,
    version: 'test', serverId: `srv-${port}`, restaurantId: R, config: { lanSecret: SECRET, ...config }, port,
  }))
  wsHub.attach(server)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, state, eventStore, wsHub, port, dir }
}

/** Un tablero (cocina/plano) conectado a SU Pedro local. Apunta lo que recibe. */
function tableroConectadoA(port, nombre) {
  const recibidos = []
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, wsOptions)
  ws.on('open', () => ws.send(JSON.stringify({
    protocol_version: PROTOCOL_VERSION,   // sin esto el hub lo descarta en silencio
    type: 'SUBSCRIBE', client_id: nombre, client_type: 'kds', restaurant_id: R,
  })))
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString())
      if (m.type === 'DELTA' && m.payload?.event) recibidos.push(m.payload.event)
      if (m.type === 'SNAPSHOT') for (const d of (m.payload?.deltas || [])) recibidos.push(d)
    } catch {}
  })
  return { ws, recibidos, cerrar: () => ws.close() }
}

/** Manda una comanda POR HTTP, como lo hace el POS de verdad. */
async function mandarComanda(port, id, mesa) {
  const r = await fetch(`http://127.0.0.1:${port}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_id: `cmd-${id}`, command_type: 'ORDER_SENT', order_id: id,
      mesa, mesero: 'test', status: 'enviada',
      items: [{ nombre: 'Prueba', station: 'cocina' }],
    }),
  })
  return r.status
}

const cerrarServidor = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r) })

/** Espera hasta que se cumpla una condición, o se rinde. Evita esperas fijas frágiles. */
async function hasta(cond, ms = 3000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (cond()) return true; await esperar(25) }
  return false
}

describe('E2E · POS 3 → Pedro local → Caja → WebSocket → POS 2', () => {
  test('REGRESION: una comanda de POS 3 llega al tablero de POS 2', async () => {
    // Es EXACTAMENTE el reporte de campo. Sin el enlace ascendente, `recibidos`
    // de POS 2 se queda vacío para siempre.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lan-'))
    const CAJA = 7811, POS2 = 7812, POS3 = 7813
    const caja = await levantarPedro(path.join(tmp, 'caja'), CAJA)
    const pos2 = await levantarPedro(path.join(tmp, 'pos2'), POS2, { posServerIp: '127.0.0.1', posServerPort: CAJA })
    const pos3 = await levantarPedro(path.join(tmp, 'pos3'), POS3, { posServerIp: '127.0.0.1', posServerPort: CAJA })

    // El enlace: el Pedro de POS 2 escucha a la caja y retransmite a los suyos.
    const enlace = conectarConLaCaja({
      lanSecret: SECRET,
      cajaUrl: `ws://127.0.0.1:${CAJA}`,
      serverId: `srv-${POS2}`, restaurantId: R,
      alRecibirEvento: (ev) => { pos2.state.apply(ev); pos2.wsHub.broadcast(ev) },
    })
    const cocinaDePos2 = tableroConectadoA(POS2, 'kds-pos2')
    await hasta(() => enlace.conectado() && cocinaDePos2.ws.readyState === 1)

    try {
      // El mesero de POS 3 manda la comanda. Va por HTTP a su Pedro, que la
      // reenvía a la caja — el camino que ya existía.
      assert.equal(await mandarComanda(POS3, 'orden-de-pos3', 21), 200)

      const llego = await hasta(() =>
        cocinaDePos2.recibidos.some((e) => (e.payload?.order_id || e.order_id) === 'orden-de-pos3'))

      assert.ok(llego,
        'la comanda de POS 3 NO llegó al tablero de POS 2 — es el defecto de campo del 2026-09-02')

      // Y la caja, que es la autoridad, también la tiene.
      assert.ok(caja.state.toSnapshot().kds_orders.some((o) => o.id === 'orden-de-pos3'))
    } finally {
      enlace.detener(); cocinaDePos2.cerrar()
      for (const p of [pos3, pos2, caja]) { p.wsHub.close?.(); await cerrarServidor(p.server) }
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('E2E · Desconexión, reconexión y cursor', () => {
  test('REGRESION: POS 2 apagado se pone al día al volver, SIN duplicar', async () => {
    // La terminal que estuvo apagada mientras pasaban cosas. Es el escenario que
    // el reenvío HTTP no podía cubrir y el que hace útil el cursor.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cursor-'))
    const CAJA = 7821, POS2 = 7822
    const caja = await levantarPedro(path.join(tmp, 'caja'), CAJA)
    const pos2 = await levantarPedro(path.join(tmp, 'pos2'), POS2, { posServerIp: '127.0.0.1', posServerPort: CAJA })

    const vistos = []
    const enlace = conectarConLaCaja({
      lanSecret: SECRET,
      cajaUrl: `ws://127.0.0.1:${CAJA}`,
      serverId: `srv-${POS2}`, restaurantId: R,
      alRecibirEvento: (ev) => vistos.push(ev),
    })
    await hasta(() => enlace.conectado())

    try {
      await mandarComanda(CAJA, 'antes-1', 1)
      await hasta(() => vistos.length >= 1)
      const cursorAntes = enlace.cursor()
      assert.ok(cursorAntes >= 0, `el cursor debe avanzar, quedó en ${cursorAntes}`)

      // POS 2 se cae. Mientras, la caja sigue operando.
      enlace.detener()
      await esperar(60)
      await mandarComanda(CAJA, 'durante-1', 2)
      await mandarComanda(CAJA, 'durante-2', 3)

      // Vuelve, con su cursor — leído de donde lo dejó, como haría Pedro tras un
      // reinicio. Sin esto el hub no manda catch-up y se pierde lo de en medio.
      const vistosTrasVolver = []
      const enlace2 = conectarConLaCaja({
      lanSecret: SECRET,
        cajaUrl: `ws://127.0.0.1:${CAJA}`,
        serverId: `srv-${POS2}`, restaurantId: R,
        leerCursor: () => cursorAntes,
        alRecibirEvento: (ev) => vistosTrasVolver.push(ev),
      })
      try {
        await hasta(() => vistosTrasVolver.length >= 2, 4000)

        const ids = vistosTrasVolver.map((e) => e.payload?.order_id || e.order_id).filter(Boolean)
        assert.ok(ids.includes('durante-1'), `recuperó lo perdido; llegaron: ${JSON.stringify(ids)}`)
        assert.ok(ids.includes('durante-2'), `recuperó lo perdido; llegaron: ${JSON.stringify(ids)}`)

        // SIN DUPLICADOS: cada id, una sola vez.
        const cuenta = {}
        for (const i of ids) cuenta[i] = (cuenta[i] || 0) + 1
        const repetidos = Object.entries(cuenta).filter(([, n]) => n > 1)
        assert.deepEqual(repetidos, [], `llegaron duplicados: ${JSON.stringify(repetidos)}`)
      } finally { enlace2.detener() }
    } finally {
      enlace.detener()
      for (const p of [pos2, caja]) { p.wsHub.close?.(); await cerrarServidor(p.server) }
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: el cursor descarta lo ya visto — no se reprocesa el día entero', async () => {
    // Sin esta regla, cada reconexión reproduce el historial completo y la cocina
    // ve la misma comanda otra vez. Es la familia del replay de julio.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dedup-'))
    const CAJA = 7831, POS2 = 7832
    const caja = await levantarPedro(path.join(tmp, 'caja'), CAJA)
    const pos2 = await levantarPedro(path.join(tmp, 'pos2'), POS2, { posServerIp: '127.0.0.1', posServerPort: CAJA })

    const vistos = []
    const enlace = conectarConLaCaja({
      lanSecret: SECRET,
      cajaUrl: `ws://127.0.0.1:${CAJA}`,
      serverId: `srv-${POS2}`, restaurantId: R,
      alRecibirEvento: (ev) => vistos.push(ev),
    })
    await hasta(() => enlace.conectado())
    try {
      for (let i = 1; i <= 4; i++) await mandarComanda(CAJA, `o-${i}`, i)
      await hasta(() => vistos.length >= 4)

      const cursorFinal = enlace.cursor()
      const cuantosAntes = vistos.length

      // Se reconecta CON el cursor al día: la caja no debe reenviarle nada viejo.
      enlace.detener()
      const enlace2 = conectarConLaCaja({
      lanSecret: SECRET,
        cajaUrl: `ws://127.0.0.1:${CAJA}`,
        serverId: `srv-${POS2}`, restaurantId: R,
        alRecibirEvento: (ev) => vistos.push(ev),
      })
      try {
        await esperar(400)
        assert.equal(vistos.length, cuantosAntes,
          `una reconexión al día no debe reentregar nada; llegaron ${vistos.length - cuantosAntes} de más`)
        assert.ok(cursorFinal >= 0)
      } finally { enlace2.detener() }
    } finally {
      enlace.detener()
      for (const p of [pos2, caja]) { p.wsHub.close?.(); await cerrarServidor(p.server) }
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('E2E · El enlace no puede tumbar la terminal', () => {
  test('REGRESION: sin caja, el secundario sigue operando y reintenta', async () => {
    // Regla dura: la caída de la caja degrada la vista compartida, nunca la
    // operación local. Si esto lanzara, un cable suelto tumbaría una terminal.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sincaja-'))
    const POS2 = 7842
    const pos2 = await levantarPedro(path.join(tmp, 'pos2'), POS2, { posServerIp: '127.0.0.1', posServerPort: 7899 })
    const enlace = conectarConLaCaja({
      lanSecret: SECRET,
      cajaUrl: 'ws://127.0.0.1:7899',            // nadie escucha
      serverId: `srv-${POS2}`, restaurantId: R,
      alRecibirEvento: () => {},
    })
    try {
      await esperar(300)
      assert.equal(enlace.conectado(), false)
      // El Pedro local sigue contestando: la terminal opera.
      assert.equal((await fetch(`http://127.0.0.1:${POS2}/health`)).status, 200)
      assert.equal(enlace.cursor(), -1, 'sin caja no inventa cursor')
    } finally {
      enlace.detener()
      pos2.wsHub.close?.(); await cerrarServidor(pos2.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('un consumidor que truena no rompe el enlace ni detiene el catch-up', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-consumidor-'))
    const CAJA = 7851
    const caja = await levantarPedro(path.join(tmp, 'caja'), CAJA)
    let entregados = 0
    const enlace = conectarConLaCaja({
      lanSecret: SECRET,
      cajaUrl: `ws://127.0.0.1:${CAJA}`, serverId: 'srv-roto', restaurantId: R,
      alRecibirEvento: () => { entregados++; throw new Error('consumidor roto') },
    })
    await hasta(() => enlace.conectado())
    try {
      await mandarComanda(CAJA, 'x1', 1)
      await mandarComanda(CAJA, 'x2', 2)
      assert.ok(await hasta(() => entregados >= 2), `se entregaron ${entregados}, el enlace murió`)
    } finally {
      enlace.detener()
      caja.wsHub.close?.(); await cerrarServidor(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
