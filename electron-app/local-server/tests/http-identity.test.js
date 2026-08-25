'use strict'
// GET /identity — el endpoint con el que las terminales descubren y verifican la caja
// por LAN. Run: node --test electron-app/local-server/tests/http-identity.test.js
//
// REGRESIÓN: buildHttpRouter recibía { state, eventStore, wsHub, cmdHandler, printer,
// version, serverId, restaurantId } pero el handler de /identity usaba además `config`
// (para branch_id) e `instanceName`. Ninguno de los dos estaba en ese scope — vivían
// dentro de startLocalServer. Cada GET /identity tiraba ReferenceError en tiempo de
// request, así que el descubrimiento por LAN quedaba roto.
//
// Nadie lo cachó porque los 11 archivos de test del local server no corrían en CI.
// Este PR también agrega el workflow que los ejecuta.
//
// Se prueba el ROUTER directo, no un servidor levantado: startLocalServer arranca mDNS,
// heartbeat y polling que dejan el proceso vivo y cuelgan el test.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { buildHttpRouter } = require('../index')

function mkReq(url, method = 'GET') {
  return { url, method, headers: {}, on() {}, socket: { remoteAddress: '127.0.0.1' } }
}

function mkRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v },
    writeHead(code, hdrs) { this.statusCode = code; Object.assign(this.headers, hdrs || {}) },
    end(chunk) { if (chunk != null) this.body = String(chunk) },
  }
}

// Dependencias mínimas: /identity no toca ninguna de ellas, pero el router las recibe.
const deps = {
  state: { toSnapshot: () => ({}), gcLocks() {} },
  eventStore: { getLastSequence: async () => 0 },
  wsHub: { broadcast() {}, clientCount: () => 0 },
  cmdHandler: {},
  printer: { getStations: () => ({}), getPrintJobsFailed: () => 0 },
  version: '1.3.8',
  serverId: 'srv-test',
  restaurantId: 'r-test',
}

async function identity(extra) {
  const router = buildHttpRouter({ ...deps, ...extra })
  const res = mkRes()
  await router(mkReq('/identity'), res)
  return { res, body: res.body ? JSON.parse(res.body) : null }
}

describe('GET /identity', () => {
  test('responde 200 con la identidad completa, sin ReferenceError', async () => {
    const { res, body } = await identity({
      config: { branchId: 'sucursal-1' },
      instanceName: 'Caja de prueba',
    })

    assert.equal(res.statusCode, 200, 'GET /identity debe responder 200')
    assert.equal(body.ok, true)
    assert.equal(body.restaurant_id, 'r-test')
    assert.equal(body.server_id, 'srv-test')

    // Los dos campos que provocaban el ReferenceError:
    assert.equal(body.branch_id, 'sucursal-1', 'branch_id viene de config — estaba fuera de scope')
    assert.equal(body.instance_name, 'Caja de prueba', 'instance_name estaba fuera de scope')

    // Y el resto del contrato que consumen las terminales al descubrir la caja:
    assert.ok(body.protocol_version != null, 'protocol_version es parte del handshake')
    assert.ok(Array.isArray(body.capabilities) && body.capabilities.includes('orders'))
    assert.ok(Array.isArray(body.lan_ips), 'lan_ips es lo que usa la terminal para fijar el bridge')
    assert.equal(typeof body.ts, 'number')
  })

  test('sin branchId configurado responde null, no rompe', async () => {
    const { res, body } = await identity({ config: {}, instanceName: 'Caja' })
    assert.equal(res.statusCode, 200)
    assert.equal(body.branch_id, null)
  })

  test('el router tolera que no le pasen config ni instanceName', async () => {
    // Defensa en profundidad: aunque un caller viejo omita los parámetros nuevos, el
    // endpoint debe seguir respondiendo — nunca volver al ReferenceError.
    const { res, body } = await identity({})
    assert.equal(res.statusCode, 200, 'sin config/instanceName debe seguir respondiendo 200')
    assert.equal(body.ok, true)
  })
})
