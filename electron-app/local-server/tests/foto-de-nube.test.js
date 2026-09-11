'use strict'
// La foto de la nube no engorda el log.
//
// Barrido 2026-09-10: el poll escribia un STATE_SYNC con TODAS las filas del
// turno cada 5 s en events.ndjson (~220 MB/hora); el log entero se carga en
// memoria al arrancar y Pedro no volvia a levantar tras un dia. Ver
// core/foto-de-nube.js. Estas pruebas anclan las cuatro propiedades:
// (1) el log durable no se toca, (2) la red solo se usa cuando cambia el estado,
// (3) el disco solo cuando cambia la foto, (4) un reinicio sin internet arranca
// con la ultima foto y las secundarias aplican la foto sin mover su cursor.
// Run: node --test electron-app/local-server/tests/foto-de-nube.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { RestaurantState } = require('../core/state')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { EVENT } = require('../protocol')
const foto = require('../core/foto-de-nube')

const dirTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'foto-de-nube-'))
const fila = (id, mesa, status = 'enviada') => ({ id, mesa, status, items: '[]', turno_id: 't1', total: 10, updated_at: '2026-09-10T12:00:00Z' })
const payloadCon = (filas) => ({
  orders: filas, order_snapshot_complete: true,
  mesas: filas.filter(o => !['cerrada', 'cancelada'].includes(o.status)).map(o => ({ mesa: String(o.mesa), status: 'ocupada', order_id: o.id })),
  kds_queue: filas.filter(o => o.status === 'enviada').map(o => ({ order_id: o.id, mesa: o.mesa, items_sent: o.items, turno_id: o.turno_id })),
  turno: { id: 't1', opened_by: 'x', opened_at: '2026-09-10T11:00:00Z', conflict_count: 1 },
  synced_at: new Date().toISOString(),
})
const hubEspia = () => { const enviados = []; return { enviados, async broadcast(ev) { enviados.push(ev); return 1 } } }

describe('el log durable no se toca', () => {
  test('REGRESION: 20 fotos con las mismas 150 filas no agregan ni un byte al log ni una secuencia', async () => {
    const dir = dirTemporal()
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
    await store.load()
    const local = await store.appendInternal(EVENT.ORDER_SENT, { order_id: 'local-1', mesa: 9, items: [] }, { restaurantId: 'r1' })
    const seqAntes = await store.getLastSequence()
    const bytesAntes = fs.statSync(path.join(dir, 'events.ndjson')).size

    const state = new RestaurantState()
    state.apply(local)
    const hub = hubEspia()
    const filas = Array.from({ length: 150 }, (_, i) => fila(`o${i}`, i + 1))
    let huella = null
    for (let i = 0; i < 20; i++) {
      const r = await foto.aplicarFotoDeNube({ state, wsHub: hub, dataDir: dir, restaurantId: 'r1', payload: payloadCon(filas), huellaAnterior: huella,
        huellaDe: JSON.stringify(filas) })
      huella = r.huella
    }
    assert.equal(await store.getLastSequence(), seqAntes, 'la foto no consume secuencias')
    assert.equal(fs.statSync(path.join(dir, 'events.ndjson')).size, bytesAntes, 'el log no crece')
    assert.equal(state.toSnapshot().salon_orders.length, 151, 'las 150 filas de nube + la local estan en memoria')
    assert.equal(hub.enviados.length, 1, 'la red se usa UNA vez: cuando el estado cambio')
    assert.equal(hub.enviados[0].transient, true)
    assert.equal(hub.enviados[0].type, EVENT.STATE_SYNC)
    assert.equal(hub.enviados[0].sequence, undefined, 'sin secuencia: no esta en el log')
  })
})

describe('disco solo cuando cambia la foto; red solo cuando cambia el estado', () => {
  test('la misma foto (salvo synced_at) se guarda una vez; una distinta, otra', async () => {
    const dir = dirTemporal()
    const state = new RestaurantState()
    const hub = hubEspia()
    const a = payloadCon([fila('o1', 1)])
    const r1 = await foto.aplicarFotoDeNube({ state, wsHub: hub, dataDir: dir, restaurantId: 'r1', payload: a, huellaAnterior: null, huellaDe: 'A' })
    const escrito1 = fs.statSync(foto.rutaDeLaFoto(dir)).mtimeMs
    const r2 = await foto.aplicarFotoDeNube({ state, wsHub: hub, dataDir: dir, restaurantId: 'r1', payload: { ...a, synced_at: 'otro' }, huellaAnterior: r1.huella, huellaDe: 'A' })
    assert.equal(r1.guardada, true); assert.equal(r2.guardada, false); assert.equal(r2.cambioLaFoto, false)
    assert.equal(fs.statSync(foto.rutaDeLaFoto(dir)).mtimeMs, escrito1, 'no se reescribio')
    const b = payloadCon([fila('o1', 1), fila('o2', 2)])
    const r3 = await foto.aplicarFotoDeNube({ state, wsHub: hub, dataDir: dir, restaurantId: 'r1', payload: b, huellaAnterior: r2.huella, huellaDe: 'B' })
    assert.equal(r3.guardada, true); assert.equal(r3.cambioElEstado, true)
    assert.equal(hub.enviados.length, 2, 'dos cambios de estado, dos transmisiones')
  })

  test('sin dataDir no se intenta escribir y no se lanza', async () => {
    const state = new RestaurantState()
    const r = await foto.aplicarFotoDeNube({ state, wsHub: null, dataDir: null, restaurantId: 'r1', payload: payloadCon([fila('o1', 1)]) })
    assert.equal(r.guardada, false); assert.equal(r.cambioElEstado, true)
  })
})

describe('reinicio sin internet: arranca con la ultima foto', () => {
  test('REGRESION: lo guardado se lee y reconstruye el mismo salon en un estado nuevo', async () => {
    const dir = dirTemporal()
    const state = new RestaurantState()
    await foto.aplicarFotoDeNube({ state, wsHub: null, dataDir: dir, restaurantId: 'r1', payload: payloadCon([fila('o1', 1), fila('o2', 2, 'cerrada')]) })
    const leida = foto.leerFotoDeNube(dir, 'r1')
    assert.equal(leida.motivo, null)
    const otro = new RestaurantState()
    otro.apply(foto.eventoTransitorio('r1', leida.payload))
    assert.equal(otro.getMesa('1').status, 'ocupada')
    assert.equal(otro.toSnapshot().salon_orders.length, 1, 'la cerrada no debe dinero')
    assert.equal(otro.toSnapshot().kds_orders.length, 1)
  })

  test('sin archivo, corrupto o de otro restaurante: null con motivo, nunca lanza', () => {
    const dir = dirTemporal()
    assert.equal(foto.leerFotoDeNube(dir, 'r1').payload, null)
    fs.writeFileSync(foto.rutaDeLaFoto(dir), '{no es json')
    assert.match(foto.leerFotoDeNube(dir, 'r1').motivo, /ilegible/)
    foto.guardarFotoDeNube(dir, 'otro-restaurante', payloadCon([]))
    assert.match(foto.leerFotoDeNube(dir, 'r1').motivo, /otro restaurante/)
    fs.writeFileSync(foto.rutaDeLaFoto(dir), JSON.stringify({ version: 99, restaurant_id: 'r1', payload: {} }))
    assert.match(foto.leerFotoDeNube(dir, 'r1').motivo, /version/)
  })

  test('REGRESION (fuente): el poll ya no llama appendInternal y el arranque aplica la foto', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    const poll = src.slice(src.indexOf('async function startSupabasePoll'), src.indexOf('// ─── HTTP routes'))
    assert.ok(!poll.includes('appendInternal('), 'el poll no debe escribir en el log')
    assert.ok(poll.includes('aplicarFotoDeNube('))
    assert.ok(src.includes('leerFotoDeNube(dataDir, restaurantId)'), 'el arranque lee la foto')
  })
})

describe('las secundarias aplican la foto sin mover el cursor', () => {
  test('un DELTA transitorio se entrega aunque su sobre traiga una secuencia ya vista', () => {
    const src = fs.readFileSync(path.join(__dirname, '../core/enlace-con-caja.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    const aplicar = src.slice(src.indexOf('const aplicar = (ev, seqDelSobre)'), src.indexOf('const avanzarCursor'))
    assert.match(aplicar, /ev\?\.transient === true[\s\S]*entregar\(ev\); return/)
    // Y la regla de siempre sigue: sin marca, la secuencia deduplica.
    assert.match(aplicar, /if \(seq <= cursor\) return/)
  })
})
