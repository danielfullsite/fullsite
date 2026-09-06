'use strict'
// El keepalive del hub no debe desconectar a un cliente sano.
//
// Un tablero de cocina y el enlace de una terminal secundaria son clientes
// PASIVOS: se suscriben y escuchan. No mandan nada, así que lo único que refresca
// su marca de vida es CONTESTAR un ping del hub. Con el plazo del pong más corto
// que el intervalo del ping, el hub los mataba en el primer barrido —antes de
// haberles mandado un solo ping— y volvían a entrar pidiendo el snapshot completo.
// Eduardo reportó el 2026-09-02 que las terminales "no muestran lo mismo".
//
// Correr: node --test electron-app/local-server/tests/keepalive-no-mata-clientes-sanos.test.js
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const WebSocket = require('ws')
const { SECRET, wsOptions } = require('./fixtures/lan-credential.cjs')
const { WsHub } = require('../core/ws-hub')
const { PROTOCOL_VERSION } = require('../protocol')

// Keepalive acelerado 300 veces: la relación entre intervalo y plazo es la misma
// que en producción, pero el caso se resuelve en menos de un segundo.
const PING_MS = 50
const PONG_MS = 150 + 1 // el constructor exige plazo > 2 intervalos

const espera = ms => new Promise(r => setTimeout(r, ms))

function levantar(opciones = {}) {
  const hub = new WsHub({
    lanSecret: SECRET, serverId: 'srv-keepalive', restaurantId: 'test-rest',
    getState: () => ({ salon_orders: [], kds_orders: [], mesas: {} }),
    getLastSequence: async () => 0,
    readAfter: async () => [],
    ...opciones,
  })
  const server = http.createServer(() => {})
  hub.attach(server)
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ hub, server, puerto: server.address().port })))
}

function suscribir(puerto, clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}/ws`, wsOptions)
    ws.on('error', reject)
    ws.on('open', () => ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE',
      client_id: clientId, client_type: 'pos', restaurant_id: 'test-rest', last_sequence: -1,
    })))
    ws.once('message', () => resolve(ws)) // el SNAPSHOT confirma que quedó registrado
  })
}

describe('keepalive del hub', () => {
  let ctx
  before(async () => { ctx = await levantar({ pingIntervalMs: PING_MS, pongTimeoutMs: PONG_MS }) })
  after(() => { try { ctx.hub.close() } catch {} ; try { ctx.server.close() } catch {} })

  test('un cliente pasivo que sólo escucha sobrevive muchos ciclos de ping', async () => {
    const ws = await suscribir(ctx.puerto, 'tablero-de-cocina')
    assert.equal(ctx.hub.clientCount(), 1, 'quedó registrado tras el SNAPSHOT')

    // Diez ciclos completos sin que el cliente mande un solo mensaje. La librería
    // contesta el pong sola, que es exactamente lo que hace un tablero real.
    await espera(PING_MS * 10)

    assert.equal(ctx.hub.clientCount(), 1,
      'el hub desconectó a un cliente sano que estaba contestando los pings')
    assert.equal(ws.readyState, WebSocket.OPEN, 'el socket del cliente sigue abierto')
    ws.close()
  })

  test('un cliente que deja de contestar sí se limpia', async () => {
    const ws = await suscribir(ctx.puerto, 'terminal-desenchufada')
    assert.equal(ctx.hub.clientCount(), 1)

    // Pausar el socket deja los frames sin procesar: el cliente ya no contesta
    // el pong, igual que una terminal a la que le quitaron el cable.
    ws.pause()
    await espera(PONG_MS + PING_MS * 3)

    assert.equal(ctx.hub.clientCount(), 0,
      'un cliente que no contesta debe liberarse; si no, el hub acumula muertos')
    try { ws.terminate() } catch {}
  })
})

describe('invariante del keepalive', () => {
  test('el hub rechaza un plazo de pong que no cubre dos intervalos de ping', () => {
    // Ésta es la regresión concreta que vivió en el repo: intervalo 15 s y plazo
    // 10 s. Con esa configuración TODO cliente muere en el primer barrido.
    assert.throws(() => new WsHub({
      lanSecret: SECRET, serverId: 's', restaurantId: 'r',
      getState: () => ({}), getLastSequence: async () => 0, readAfter: async () => [],
      pingIntervalMs: 15_000, pongTimeoutMs: 10_000,
    }), /Keepalive inválido/)
  })

  test('la configuración de fábrica cumple la invariante', async () => {
    // Sin esta comprobación, alguien puede volver a cruzar las constantes del
    // módulo y ninguna prueba rápida lo notaría: el defecto sólo se manifiesta
    // después de quince segundos de operación real.
    const ctx = await levantar()
    try {
      assert.ok(ctx.hub._pongTimeoutMs > ctx.hub._pingIntervalMs * 2,
        `plazo ${ctx.hub._pongTimeoutMs} ms no cubre dos intervalos de ${ctx.hub._pingIntervalMs} ms`)
    } finally {
      ctx.hub.close(); ctx.server.close()
    }
  })
})
