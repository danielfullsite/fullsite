'use strict'
const { SECRET, wsOptions, localFetch: fetch } = require('./fixtures/lan-credential.cjs')
// El reenvío de LECTURA, probado con dos servidores HTTP de verdad.
//
// ── POR QUÉ ESTA PRUEBA EXISTE, Y POR QUÉ LA ANTERIOR NO SERVÍA ──────────────
//
// La primera versión de esta cobertura (`reenvio-lectura-a-caja.test.js`) leía
// index.js y comprobaba que contuviera la cadena `u.pathname + u.search`. Pasaba
// en verde. Y el reenvío estaba ROTO en tiempo de ejecución:
//
//   index.js:328   const url = req.url?.split('?')[0]
//
// El router descarta la query ANTES de enrutar, así que `forwardGet` recibía un
// `url` sin query y `u.search` siempre valía ''. La prueba textual no podía verlo
// porque el string sí estaba en el archivo: verificaba la INTENCIÓN, no el efecto.
//
// Ésta levanta un Pedro principal y un Pedro secundario reales, en puertos
// reales, con almacenamiento en disco real, y comprueba lo único que importa:
// QUÉ LLEGÓ AL OTRO LADO.
//
// Regla que deja instalada: el reenvío se prueba por su efecto observable en el
// servidor de destino, nunca por el texto del reenviador.

const { test, describe } = require('node:test')
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

/** Un Pedro real: router real, event store real en disco, puerto real. */
async function levantarPedro(dir, port, config = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const store = new NdjsonEventStore({
    eventLogPath: path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()
  const state = new RestaurantState()
  // `clientCount` lo llama GET /health (index.js:455). Sin el, /health truena con
  // TypeError y la prueba culpa al producto por un hueco del andamio — paso una vez.
  const hub = { broadcast: async () => {}, clientCount: () => 0, getClientList: () => [] }
  const printer = {
    printToStation: async () => {},
    getPrintJobsQueued: () => 0, getPrintJobsFailed: () => 0, getStations: () => ({}),
  }
  const cmdHandler = new CommandHandler({ eventStore, state, wsHub: hub, printer, restaurantId: R })
  const router = buildHttpRouter({
    state, eventStore, wsHub: hub, cmdHandler, printer,
    version: 'test', serverId: `srv-${port}`, restaurantId: R, config: { lanSecret: SECRET, ...config }, port,
  })
  const server = http.createServer(router)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, state, eventStore, port }
}

/**
 * Un espía que se hace pasar por el Pedro principal y APUNTA la ruta cruda que
 * recibió. Es la única forma de comprobar que la query sobrevivió el salto: el
 * estado del principal no dice nada sobre qué query se pidió.
 */
async function levantarEspia(port) {
  const recibido = []
  const server = http.createServer((req, res) => {
    recibido.push({ metodo: req.method, urlCruda: req.url })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ events: [], espia: true }))
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, recibido, port }
}

// `close()` espera a que mueran los sockets keep-alive que abre `fetch`, y eso
// colgaba el archivo ~60 s por corrida. Se cierran a la fuerza: son servidores
// de prueba, no hay nada que drenar.
const cerrar = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r) })

describe('El cursor sobrevive el salto al Pedro principal', () => {
  test('REGRESION: GET /events?since=57 llega al principal CON since=57', async () => {
    // El defecto real: sin el cursor, el principal devuelve TODO el historial. En
    // un restaurante con un turno largo eso son miles de eventos por reconexión,
    // y la terminal no tiene forma de saber qué ya había visto — que es justo el
    // problema que `since` existe para resolver.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-get-'))
    const PRINCIPAL = 7751, SECUNDARIO = 7752
    const espia = await levantarEspia(PRINCIPAL)
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: PRINCIPAL,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${SECUNDARIO}/events?since=57`)
      assert.equal(res.status, 200, 'el secundario debe contestar')

      assert.equal(espia.recibido.length, 1, 'el principal debió recibir exactamente una petición')
      const llegada = espia.recibido[0]
      assert.equal(llegada.metodo, 'GET')
      assert.equal(
        llegada.urlCruda, '/events?since=57',
        `el principal recibió "${llegada.urlCruda}" — el cursor se perdió en el reenvío`,
      )
    } finally {
      await cerrar(sec.server); await cerrar(espia.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: sin la query, el principal devolvería historial de más', async () => {
    // Demuestra la CONSECUENCIA, no sólo la forma. Se siembran 3 eventos en el
    // principal real y se pide desde el 2: deben volver menos que todos.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-hist-'))
    const PRINCIPAL = 7753, SECUNDARIO = 7754
    const caja = await levantarPedro(path.join(tmp, 'caja'), PRINCIPAL)
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: PRINCIPAL,
    })
    try {
      for (let i = 1; i <= 3; i++) {
        const r = await fetch(`http://127.0.0.1:${PRINCIPAL}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command_id: `sem-${i}`, command_type: 'ORDER_SENT', order_id: `o-${i}`,
            mesa: i, mesero: 'test', status: 'enviada',
            items: [{ nombre: 'Prueba', station: 'cocina' }],
          }),
        })
        assert.equal(r.status, 200)
      }

      const todos = await (await fetch(`http://127.0.0.1:${SECUNDARIO}/events?since=0`)).json()
      assert.ok(Array.isArray(todos.events), 'el reenvío debe devolver la forma del principal')
      assert.ok(todos.events.length >= 3, `se sembraron 3, llegaron ${todos.events.length}`)

      const desdeElDos = await (await fetch(`http://127.0.0.1:${SECUNDARIO}/events?since=2`)).json()
      assert.ok(
        desdeElDos.events.length < todos.events.length,
        `since=2 devolvió ${desdeElDos.events.length} y since=0 devolvió ${todos.events.length}: ` +
        'el cursor no llegó al principal',
      )
    } finally {
      await cerrar(sec.server); await cerrar(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('El reenvío de lectura hace lo que dice', () => {
  test('/state del secundario devuelve el salón de la CAJA, no el suyo', async () => {
    // El corazón del muro 2. Sin esto, cada terminal ve sólo lo que ella hizo:
    // tres cajas, tres verdades. Reportado en campo el 2026-09-02 (AMALAY).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-state-'))
    const PRINCIPAL = 7755, SECUNDARIO = 7756
    const caja = await levantarPedro(path.join(tmp, 'caja'), PRINCIPAL)
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: PRINCIPAL,
    })
    try {
      // Una comanda que SÓLO conoce la caja.
      await fetch(`http://127.0.0.1:${PRINCIPAL}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command_id: 'solo-caja', command_type: 'ORDER_SENT', order_id: 'o-caja',
          mesa: 12, mesero: 'test', status: 'enviada',
          items: [{ nombre: 'Prueba', station: 'cocina' }],
        }),
      })

      const local = sec.state.toSnapshot()
      assert.ok(
        !local.kds_orders.some((o) => o.id === 'o-caja'),
        'premisa: el estado propio del secundario NO conoce esa orden',
      )

      const via = await (await fetch(`http://127.0.0.1:${SECUNDARIO}/state`)).json()
      assert.ok(
        (via.kds_orders || []).some((o) => o.id === 'o-caja'),
        'preguntando por /state, el secundario debe ver la orden de la caja',
      )
    } finally {
      await cerrar(sec.server); await cerrar(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: /identity NO se reenvía — un secundario no debe decir que es la caja', async () => {
    // /identity pregunta por ESTA máquina. Si se reenviara, un secundario se
    // presentaría con el server_id de la caja y el descubrimiento de terminales
    // dejaría de distinguirlas — dos máquinas afirmando ser la misma.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-ident-'))
    const PRINCIPAL = 7761, SECUNDARIO = 7762
    const caja = await levantarPedro(path.join(tmp, 'caja'), PRINCIPAL)
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: PRINCIPAL,
    })
    try {
      const idSec = await (await fetch(`http://127.0.0.1:${SECUNDARIO}/identity`)).json()
      const idCaja = await (await fetch(`http://127.0.0.1:${PRINCIPAL}/identity`)).json()
      assert.notEqual(
        idSec.server_id, idCaja.server_id,
        'el secundario debe reportar SU identidad, no la de la caja',
      )
      assert.equal(idSec.server_id, `srv-${SECUNDARIO}`)
    } finally {
      await cerrar(sec.server); await cerrar(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: /health NO se reenvía — mediría a la máquina equivocada', async () => {
    // Si /health se reenviara, un secundario con Pedro caído reportaría "sano"
    // porque la caja lo está. El diagnóstico apuntaría al lugar equivocado.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-health-'))
    const SECUNDARIO = 7763
    // Puerto 7799: nadie escucha. Si /health se reenviara, esto fallaría o colgaría.
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: 7799,
    })
    try {
      const r = await fetch(`http://127.0.0.1:${SECUNDARIO}/health`)
      assert.equal(r.status, 200, '/health debe contestar localmente aunque la caja no exista')
    } finally {
      await cerrar(sec.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: la CAJA no se reenvía a sí misma', async () => {
    // Sin la condición `posServerIp`, la caja se llamaría a sí misma en bucle y
    // tumbaría el servidor local del restaurante entero.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-caja-'))
    const caja = await levantarPedro(path.join(tmp, 'caja'), 7757)  // sin posServerIp
    try {
      const r = await fetch('http://127.0.0.1:7757/state')
      assert.equal(r.status, 200)
      const j = await r.json()
      assert.ok('sequence' in j, 'la caja contesta con su propio estado')
      assert.ok(!j.espia, 'y no reenvía a nadie')
    } finally {
      await cerrar(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('Cuando la caja no contesta', () => {
  test('/state cae al estado local Y LO DICE en el cuerpo, no sólo en una cabecera', async () => {
    // Una cabecera no basta: `fetch` del navegador no puede leer una cabecera
    // cross-origin salvo que el servidor la exponga. El consumidor tiene que
    // poder distinguir "el salón" de "lo que yo vi" leyendo el JSON.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-degra-'))
    const SECUNDARIO = 7758
    // Puerto 7759: nadie escucha ahí. La conexión se rechaza de inmediato.
    const sec = await levantarPedro(path.join(tmp, 'sec'), SECUNDARIO, {
      posServerIp: '127.0.0.1', posServerPort: 7759,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${SECUNDARIO}/state`)
      assert.equal(res.status, 200, 'no debe dar 502: dejaría el mapa de mesas en blanco')
      const j = await res.json()
      assert.equal(j.authoritative, false, 'el cuerpo debe declarar que NO es autoritativo')
      assert.equal(j.source, 'local-degradado', 'y de dónde salió el dato')
    } finally {
      await cerrar(sec.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('un /state autoritativo se declara como tal', async () => {
    // La simétrica. Si sólo se marcara el degradado, un consumidor no podría
    // distinguir "autoritativo" de "una versión vieja del servidor".
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reenvio-auth-'))
    const caja = await levantarPedro(path.join(tmp, 'caja'), 7760)
    try {
      const j = await (await fetch('http://127.0.0.1:7760/state')).json()
      assert.equal(j.authoritative, true)
      assert.equal(j.source, 'caja')
    } finally {
      await cerrar(caja.server)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
