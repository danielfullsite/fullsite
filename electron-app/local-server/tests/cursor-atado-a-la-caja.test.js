'use strict'
// Reinstalar la Caja no debe dejar ciega a una terminal secundaria.
//
// El cursor es un número dentro de la historia de UNA Caja. Cuando no estaba
// atado a cuál, borrarle la carpeta a la Caja (o cambiarla de máquina, o
// reinstalarla) hacía que su historia arrancara otra vez desde cero: la
// secundaria pedía "dame desde 500", la Caja nueva iba en 3, y todo lo vivo se
// descartaba por `seq <= cursor` hasta que la Caja rebasara los 500. El mapa de
// mesas sobrevivía porque va por HTTP; los tableros de esa terminal, no.
//
// Correr: node --test electron-app/local-server/tests/cursor-atado-a-la-caja.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { conectarConLaCaja } = require('../core/enlace-con-caja')

// Un WebSocket de mentira: deja empujar mensajes como si vinieran de la Caja.
class SocketFalso extends EventEmitter {
  constructor() { super(); this.enviados = []; this.readyState = 1 }
  send(texto) { this.enviados.push(JSON.parse(texto)) }
  close() { this.emit('close') }
  terminate() { this.emit('close') }
}

function enlazar({ cursorGuardado, cajaGuardada }) {
  const socket = new SocketFalso()
  const eventos = []
  const estados = []
  const guardados = []
  const enlace = conectarConLaCaja({
    cajaUrl: 'ws://127.0.0.1:1/ws', serverId: 'secundaria', restaurantId: 'lab', lanSecret: 'x',
    alRecibirEvento: ev => eventos.push(ev),
    alRecibirEstado: st => estados.push(st),
    leerCursor: () => ({ cursor: cursorGuardado, cajaId: cajaGuardada }),
    guardarCursor: (n, cajaId) => guardados.push({ n, cajaId }),
    wsInyectado: function () { return socket },
  })
  socket.emit('open')
  const snapshot = (secuencia, cajaId) => socket.emit('message', Buffer.from(JSON.stringify({
    type: 'SNAPSHOT', server_id: cajaId, sequence: secuencia, payload: { state: { marca: cajaId }, deltas: [] } })))
  const delta = (secuencia, id, cajaId) => socket.emit('message', Buffer.from(JSON.stringify({
    type: 'DELTA', server_id: cajaId, sequence: secuencia, payload: { event: { sequence: secuencia, id } } })))
  return { enlace, eventos, estados, guardados, snapshot, delta, socket }
}

describe('el cursor está atado a la historia de una caja', () => {
  test('una caja reinstalada no deja ciega a la terminal', () => {
    // Ayer: la terminal llegó hasta el evento 500 de la caja "caja-vieja".
    const t = enlazar({ cursorGuardado: 500, cajaGuardada: 'caja-vieja' })
    // Hoy: reinstalaron la Caja. Otra identidad, y su historia va en 3.
    t.snapshot(3, 'caja-nueva')
    t.delta(4, 'comanda-mesa-1', 'caja-nueva')
    t.delta(5, 'comanda-mesa-2', 'caja-nueva')

    assert.deepEqual(t.eventos.map(e => e.id), ['comanda-mesa-1', 'comanda-mesa-2'],
      'los eventos vivos de la caja nueva se descartaron por el cursor viejo')
    assert.equal(t.estados.length, 1, 'el estado de la caja nueva se hidrató')
    t.enlace.detener()
  })

  test('la secuencia que retrocede basta, aunque la identidad no viaje', () => {
    // Una caja vieja que no manda server_id, con su carpeta recreada.
    const t = enlazar({ cursorGuardado: 500, cajaGuardada: null })
    t.snapshot(3, undefined)
    t.delta(4, 'comanda', undefined)

    assert.deepEqual(t.eventos.map(e => e.id), ['comanda'])
    t.enlace.detener()
  })

  test('la misma caja de siempre no reprocesa lo ya visto', () => {
    const t = enlazar({ cursorGuardado: 500, cajaGuardada: 'caja-de-siempre' })
    t.snapshot(500, 'caja-de-siempre')
    t.delta(499, 'viejo-repetido', 'caja-de-siempre')  // reenvío tras reconectar
    t.delta(501, 'nuevo', 'caja-de-siempre')

    assert.deepEqual(t.eventos.map(e => e.id), ['nuevo'],
      'un reenvío de lo ya visto no debe entregarse dos veces')
    t.enlace.detener()
  })

  test('el cursor se guarda junto a la identidad de la caja', () => {
    const t = enlazar({ cursorGuardado: -1, cajaGuardada: null })
    t.snapshot(10, 'caja-abc')
    t.delta(11, 'comanda', 'caja-abc')

    assert.ok(t.guardados.length >= 1, 'algo se guardó')
    assert.equal(t.guardados.at(-1).n, 11)
    assert.equal(t.guardados.at(-1).cajaId, 'caja-abc',
      'sin la identidad, el número guardado no dice de qué historia es')
    t.enlace.detener()
  })

  test('un cursor guardado como número pelón también detecta la caja recreada', () => {
    // El caso que de verdad ocurre al actualizar: el archivo viejo sólo tiene el
    // número, así que la identidad no se puede comparar y la única señal es que
    // la secuencia de la caja retrocedió.
    const socket = new SocketFalso()
    const eventos = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://127.0.0.1:1/ws', serverId: 'secundaria', restaurantId: 'lab', lanSecret: 'x',
      alRecibirEvento: ev => eventos.push(ev),
      leerCursor: () => 500,
      guardarCursor: () => {},
      wsInyectado: function () { return socket },
    })
    socket.emit('open')
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'SNAPSHOT', sequence: 3, payload: { deltas: [] } })))
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'DELTA', sequence: 4, payload: { event: { sequence: 4, id: 'comanda' } } })))

    assert.deepEqual(eventos.map(e => e.id), ['comanda'])
    enlace.detener()
  })

  test('sin cursor guardado se arranca en -1, no en 0', () => {
    // Con 0 el hub SÍ manda catch-up y la terminal reprocesa el historial entero
    // en cada arranque. `Number(null)` es 0, y por ahí se coló este error.
    const socket = new SocketFalso()
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://127.0.0.1:1/ws', serverId: 'secundaria', restaurantId: 'lab', lanSecret: 'x',
      alRecibirEvento: () => {},
      wsInyectado: function () { return socket },
    })
    socket.emit('open')
    assert.equal(enlace.cursor(), -1, 'sin cursor no se inventa una posición en la historia')
    assert.equal(socket.enviados[0]?.last_sequence, -1, 'y se le pide a la caja desde -1')
    enlace.detener()
  })

  test('un cursor de la versión anterior, que era sólo un número, se sigue leyendo', () => {
    const socket = new SocketFalso()
    const eventos = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://127.0.0.1:1/ws', serverId: 'secundaria', restaurantId: 'lab', lanSecret: 'x',
      alRecibirEvento: ev => eventos.push(ev),
      leerCursor: () => 7,               // formato anterior: número pelón
      guardarCursor: () => {},
      wsInyectado: function () { return socket },
    })
    socket.emit('open')
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'SNAPSHOT', server_id: 'caja-abc', sequence: 7, payload: { deltas: [] } })))
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'DELTA', sequence: 7, payload: { event: { sequence: 7, id: 'ya-visto' } } })))
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'DELTA', sequence: 8, payload: { event: { sequence: 8, id: 'nuevo' } } })))

    assert.deepEqual(eventos.map(e => e.id), ['nuevo'],
      'actualizar la versión no debe reprocesar el historial ni perder lo nuevo')
    enlace.detener()
  })
})
