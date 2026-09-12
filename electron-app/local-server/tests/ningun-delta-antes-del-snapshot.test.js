'use strict'
// NINGÚN DELTA ANTES DEL SNAPSHOT.
//
// Barrido 3 (2026-09-12), P0 de multi-terminal, reproducido con WsHub y cliente
// ws reales. El cliente entraba a `_clients` ANTES de los dos `await` que arman
// el SNAPSHOT (última secuencia + catch-up). Si otra terminal mandaba una
// comanda en esa ventana —reinicio de la Caja a media operación con tres POS
// reconectando— el `broadcast` salía primero:
//
//     recibido: [DELTA, SNAPSHOT]   seqs: [101, 100]
//
// La secundaria lee ese orden como «la Caja reinició su historia»
// (enlace-con-caja.js: `msg.sequence < cursor` → `cursor = -1`), y como el reset
// pasa ANTES del bucle de deltas, re-entrega todo el catch-up. `alRecibirEvento`
// hace `state.apply(ev)` y `wsHub.broadcast(ev)`: cada comanda se proyecta dos
// veces y se repinta dos veces en cocina, barra y plano.
//
// Run: node --test electron-app/local-server/tests/ningun-delta-antes-del-snapshot.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const WebSocket = require('ws')
const { WsHub } = require('../core/ws-hub')
const { PROTOCOL_VERSION } = require('../protocol')
const credLan = require('../core/credencial-lan')
const SECRETO = credLan.generarSecreto()

const RESTAURANT = 'r-hub'
const clientes = []

async function montarHub({ alArmarSnapshot }) {
  const servidor = http.createServer()
  await new Promise(r => servidor.listen(0, '127.0.0.1', r))
  let ultimaSecuencia = 100
  const hub = new WsHub({
    server: servidor,
    restaurantId: RESTAURANT,
    lanSecret: SECRETO,
    getState: () => ({ salon_orders: [] }),
    getLastSequence: async () => { if (alArmarSnapshot) await alArmarSnapshot(); return ultimaSecuencia },
    readAfter: async () => [],
    serverId: 'caja-1',
  })
  hub.attach(servidor)
  return { hub, servidor, puerto: servidor.address().port, subirSecuencia: (n) => { ultimaSecuencia = n } }
}

function conectar(puerto) {
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}/ws`)
  const recibido = []
  ws.on('message', (raw) => { try { recibido.push(JSON.parse(raw.toString())) } catch {} })
  return { ws, recibido, abierto: new Promise(r => ws.on('open', r)) }
}

describe('el hub nunca entrega un DELTA antes del SNAPSHOT', () => {
  test('REGRESION: una comanda emitida mientras se arma el SNAPSHOT llega DESPUÉS, y en orden', async (t) => {
    let liberar
    const enEspera = new Promise(r => { liberar = r })
    let primeraVez = true
    const { hub, servidor, puerto } = await montarHub({
      alArmarSnapshot: async () => { if (primeraVez) { primeraVez = false; await enEspera } },
    })
    t.after(() => new Promise(r => { clientes.forEach(c => { try { c.ws.terminate() } catch {} }); hub.close(); servidor.close(r) }))

    const cliente = conectar(puerto); clientes.push(cliente)
    await cliente.abierto
    cliente.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE', lan_secret: credLan.cabecerasDeCredencial({ secreto: SECRETO, restaurantId: RESTAURANT })[credLan.CABECERA], client_id: 'POS-2', client_type: 'pos', restaurant_id: RESTAURANT, last_sequence: -1 }))

    // El hub está detenido armando el SNAPSHOT. Aquí entra la comanda de POS-1.
    await new Promise(r => setTimeout(r, 50))
    await hub.broadcast({ id: 'e101', type: 'ORDER_SENT', sequence: 101, payload: { order_id: 'o1' } })
    liberar()

    await new Promise(r => setTimeout(r, 120))
    const tipos = cliente.recibido.map(m => m.type)
    assert.equal(tipos[0], 'SNAPSHOT', `el primer mensaje debe ser el SNAPSHOT, llegó ${tipos.join(', ')}`)
    assert.ok(tipos.includes('DELTA'), 'la comanda de la ventana no se pierde')
    const snapshot = cliente.recibido.find(m => m.type === 'SNAPSHOT')
    const delta = cliente.recibido.find(m => m.type === 'DELTA')
    assert.ok(delta.sequence >= snapshot.sequence, 'la secuencia nunca retrocede entre SNAPSHOT y DELTA')
    assert.equal(delta.payload.event.id, 'e101')
  })

  test('sin ventana (lo normal) el SNAPSHOT y los DELTA siguen llegando como siempre', async (t) => {
    const { hub, servidor, puerto } = await montarHub({})
    t.after(() => new Promise(r => { clientes.forEach(c => { try { c.ws.terminate() } catch {} }); hub.close(); servidor.close(r) }))
    const cliente = conectar(puerto); clientes.push(cliente)
    await cliente.abierto
    cliente.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE', lan_secret: credLan.cabecerasDeCredencial({ secreto: SECRETO, restaurantId: RESTAURANT })[credLan.CABECERA], client_id: 'POS-3', client_type: 'pos', restaurant_id: RESTAURANT, last_sequence: -1 }))
    await new Promise(r => setTimeout(r, 60))
    await hub.broadcast({ id: 'e102', type: 'ORDER_SENT', sequence: 102, payload: {} })
    await new Promise(r => setTimeout(r, 60))
    assert.deepEqual(cliente.recibido.map(m => m.type), ['SNAPSHOT', 'DELTA'])
  })
})

describe('una secuencia menor de la MISMA caja no reinicia el cursor', () => {
  test('REGRESION (fuente): la identidad manda sobre el número', () => {
    const fs = require('node:fs'), path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, '../core/enlace-con-caja.js'), 'utf8')
    assert.match(src, /const mismaCaja = cajaId !== null && cajaDelSobre !== null && cajaDelSobre === cajaId/)
    assert.match(src, /const secuenciaRetrocedio = !mismaCaja &&/)
  })
})
