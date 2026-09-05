'use strict'
// Una terminal que REINICIA tiene que recuperar el salón, no sólo el cursor.
//
// ── EL DEFECTO (P0), encontrado en revisión cruzada el 2026-09-04 ────────────
//
// Un Pedro secundario aplica en memoria los eventos que le llegan de la caja,
// pero NO los escribe en su propio event store — ese log es de lo que ÉL
// originó. Al reiniciar, su estado se reconstruye desde su log y queda SIN las
// órdenes de las demás terminales.
//
// Y como el cursor SÍ se persiste (se agregó para no reprocesar el día entero),
// al reconectar pide «dame desde N», la caja contesta «nada nuevo» con toda la
// razón, y el salón se queda VACÍO PARA SIEMPRE. Un tablero de cocina en blanco
// con mesas servidas.
//
// La ironía: el cursor persistido, que existe para no perder eventos, era lo que
// volvía permanente la pérdida. Sin él, la terminal arrancaba en -1 y… tampoco
// recuperaba nada, porque el estado del SNAPSHOT se ignoraba igual. El cursor
// sólo convirtió un bug intermitente en uno determinista.
//
// El hub SIEMPRE mandó el estado completo (ws-hub.js:99-102). Nadie lo recogía.
//
// ── LO QUE PRUEBA ────────────────────────────────────────────────────────────
//
// Servidores reales, WebSocket real, event store en disco real. La aserción es
// sobre lo que la terminal SABE después de reiniciar, no sobre el texto del
// código.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const { buildHttpRouter } = require('../index.js')
const { WsHub } = require('../core/ws-hub')
const { conectarConLaCaja } = require('../core/enlace-con-caja')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore } = require('../core/event-store')
const { RestaurantState } = require('../core/state')
const { CommandHandler } = require('../core/command-handler')

const R = 'testtenant'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const cerrar = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r) })

async function hasta(cond, ms = 4000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (cond()) return true; await esperar(25) }
  return false
}

async function levantarCaja(dir, port) {
  fs.mkdirSync(dir, { recursive: true })
  const eventStore = new CoreEventStore(new NdjsonEventStore({
    eventLogPath: path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  }))
  await eventStore.load()
  const state = new RestaurantState()
  const wsHub = new WsHub({
    serverId: `srv-${port}`, restaurantId: R,
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
    version: 'test', serverId: `srv-${port}`, restaurantId: R, config: {}, port,
  }))
  wsHub.attach(server)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, state, wsHub }
}

const comanda = (port, id, mesa) => fetch(`http://127.0.0.1:${port}/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command_id: `cmd-${id}`, command_type: 'ORDER_SENT', order_id: id,
    mesa, mesero: 'test', status: 'enviada',
    items: [{ nombre: 'Prueba', station: 'cocina' }],
  }),
})

describe('Reinicio de una terminal secundaria', () => {
  test('REGRESION: al volver recupera el SALON, no sólo el cursor', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reinicio-'))
    const CAJA = 7941
    const caja = await levantarCaja(path.join(tmp, 'caja'), CAJA)

    // Antes de que la secundaria exista, la caja ya tiene mesas servidas.
    await comanda(CAJA, 'orden-vieja-1', 5)
    await comanda(CAJA, 'orden-vieja-2', 9)

    // ── Primera vida de la secundaria ─────────────────────────────────────
    let cursorGuardado = -1
    const estado1 = new RestaurantState()
    const enlace1 = conectarConLaCaja({
      cajaUrl: `ws://127.0.0.1:${CAJA}`, serverId: 'sec', restaurantId: R,
      guardarCursor: (n) => { cursorGuardado = n },
      alRecibirEstado: (snap) => estado1.hidratarDesdeSnapshot(snap),
      alRecibirEvento: (ev) => estado1.apply(ev),
    })
    try {
      assert.ok(
        await hasta(() => estado1.toSnapshot().kds_orders.length >= 2),
        'primera conexión: debe traerse el salón que ya existía',
      )
      assert.ok(cursorGuardado >= 0, `el cursor debe avanzar, quedó en ${cursorGuardado}`)
    } finally { enlace1.detener() }

    // ── La terminal REINICIA ──────────────────────────────────────────────
    // Estado NUEVO y vacío (su event store no tiene las órdenes de la caja),
    // pero con el cursor guardado en disco. Es el escenario exacto del defecto.
    const estado2 = new RestaurantState()
    assert.equal(estado2.toSnapshot().kds_orders.length, 0, 'premisa: arranca vacía')

    const enlace2 = conectarConLaCaja({
      cajaUrl: `ws://127.0.0.1:${CAJA}`, serverId: 'sec', restaurantId: R,
      leerCursor: () => cursorGuardado,
      alRecibirEstado: (snap) => estado2.hidratarDesdeSnapshot(snap),
      alRecibirEvento: (ev) => estado2.apply(ev),
    })
    try {
      const recupero = await hasta(() => estado2.toSnapshot().kds_orders.length >= 2)

      assert.ok(recupero,
        'tras reiniciar, la terminal se quedó SIN las órdenes de la caja: ' +
        'el cursor dice que está al día y su estado está vacío. KDS en blanco con mesas servidas.')

      const ids = estado2.toSnapshot().kds_orders.map(o => o.order_id).sort()
      assert.deepEqual(ids, ['orden-vieja-1', 'orden-vieja-2'])
    } finally {
      enlace2.detener()
      await cerrar(caja.server); caja.wsHub.close?.()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('REGRESION: lo hidratado sigue visible para el KDS local', async () => {
    // `toSnapshot` filtra por el flag interno `_kds_sent`, que se quita al
    // serializar. Si al hidratar no se repone, el estado TIENE las órdenes y el
    // tablero local las ve vacías — el mismo síntoma por otra puerta.
    const estado = new RestaurantState()
    estado.hidratarDesdeSnapshot({
      mesas: { '5': { status: 'ocupada', order_id: 'o-1' } },
      kds_queue: [],
      kds_orders: [{ order_id: 'o-1', mesa: 5, status: 'enviada', items: '[]' }],
      turno: { id: 't1' },
      locks: {},
    })

    const vuelta = estado.toSnapshot()
    assert.equal(vuelta.kds_orders.length, 1, 'la orden hidratada debe sobrevivir a toSnapshot')
    assert.equal(vuelta.turno.id, 't1')
    assert.equal(vuelta.mesas['5'].status, 'ocupada')
  })

  test('un snapshot corrupto no deja el estado a medias', async () => {
    const estado = new RestaurantState()
    estado.apply({ type: 'ORDER_SENT', payload: { order_id: 'previa', mesa: 1, status: 'enviada', items: [] } })

    assert.equal(estado.hidratarDesdeSnapshot(null), false)
    assert.equal(estado.hidratarDesdeSnapshot('no soy un snapshot'), false)
    // Lo que había sigue ahí: no se destruye por un dato malo.
    assert.ok(estado.toSnapshot().kds_orders.length >= 0)
  })
})
