'use strict'
// La fila de nube corrige ordenes LOCALES; la secundaria conserva el origen.
// Barrido 2026-09-10: pedro-core LENTE-2 (cancelada / mesa movida / empalme de
// ayer), LENTE-3 (from_cloud sobrevive la hidratacion) y kds LENTE-2 (comanda
// cobrada y lista sale del tablero legacy).
// Run: node --test electron-app/local-server/tests/foto-de-nube-corrige-locales.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { RestaurantState } = require('../core/state')
const { EVENT } = require('../protocol')

const ev = (type, payload) => ({ id: `${type}-${Math.random()}`, type, ts: Date.now(), client_id: 'pos', restaurant_id: 'r1', payload })
const fila = (id, mesa, status, extra = {}) => ({ id, mesa, status, items: '[]', turno_id: 't1', total: 10, updated_at: new Date().toISOString(), ...extra })
const foto = (filas, turno = { id: 't1' }) => ev(EVENT.STATE_SYNC, {
  orders: filas, order_snapshot_complete: true, turno, synced_at: new Date().toISOString(),
  mesas: filas.filter(o => !['cerrada', 'cancelada'].includes(o.status)).map(o => ({ mesa: String(o.mesa), status: 'ocupada', order_id: o.id })),
  kds_queue: filas.filter(o => o.status === 'enviada').map(o => ({ order_id: o.id, mesa: o.mesa, items_sent: '[]', turno_id: 't1' })),
})
function conOrdenLocal(id = 'X', mesa = 5) {
  const s = new RestaurantState()
  s.apply(ev(EVENT.ORDER_SENT, { order_id: id, mesa, items: [{ id: 'i1', nombre: 'Tacos', cantidad: 1 }], turno_id: 't1', total: 10 }))
  return s
}

describe('la fila de nube corrige una orden local', () => {
  test('REGRESION: cancelada en nube -> mesa libre, fuera del KDS, no cobrable', () => {
    const s = conOrdenLocal()
    s.apply(foto([fila('X', 5, 'cancelada')]))
    assert.equal(s.getMesa('5').status, 'libre')
    assert.equal(s.toSnapshot().kds_orders.length, 0)
    assert.equal(s.toSnapshot().salon_orders.length, 0)
    assert.equal(s.toSnapshot().cancelled_orders[0].order_id, 'X')
  })
  test('REGRESION: mesa movida en nube (5 -> 9) -> la 5 queda libre y la 9 ocupada por X', () => {
    const s = conOrdenLocal()
    s.apply(foto([fila('X', 9, 'enviada')]))
    assert.equal(s.getMesa('5').status, 'libre')
    assert.equal(s.getMesa('9').order_id, 'X')
    assert.equal(s.toSnapshot().kds_orders[0].mesa, 9)
    assert.equal(s.toSnapshot().salon_orders.filter(o => o.order_id === 'X').length, 1)
  })
  test('REGRESION: orden local YA COBRADA de un turno que la nube cerro se retira (empalme de ayer)', () => {
    const s = conOrdenLocal()
    s.apply(ev(EVENT.ORDER_UPSERTED, { order_id: 'X', status: 'lista' }))
    s.apply(ev(EVENT.ORDER_CLOSED, { order_id: 'X', mesa: 5 }))
    s.apply(foto([], { id: 't2' }))
    assert.equal(s.toSnapshot().kds_orders.length, 0)
    assert.equal(s.toSnapshot().salon_orders.length, 0)
  })
  test('una orden local SIN cobrar de otro turno se conserva: es deuda real', () => {
    const s = conOrdenLocal()
    s.apply(foto([], { id: 't2' }))
    assert.equal(s.toSnapshot().salon_orders.length, 1)
  })
})

describe('la secundaria conserva el origen de cada orden', () => {
  test('REGRESION: tras hidratarse, una cancelacion en nube tambien le quita la orden a la secundaria', () => {
    const caja = new RestaurantState()
    caja.apply(foto([fila('Y', 7, 'enviada')]))
    const sec = new RestaurantState()
    sec.hidratarDesdeSnapshot(caja.toSnapshot())
    const f = foto([fila('Y', 7, 'cancelada')])
    caja.apply(f); sec.apply(f)
    assert.equal(caja.getMesa('7').status, 'libre')
    assert.equal(sec.getMesa('7').status, 'libre', 'la secundaria debe coincidir con la caja')
    assert.equal(sec.toSnapshot().kds_orders.length, 0)
  })
  test('lo local sigue siendo local despues de hidratar', () => {
    const caja = conOrdenLocal()
    const sec = new RestaurantState()
    sec.hidratarDesdeSnapshot(caja.toSnapshot())
    sec.apply(foto([]))
    assert.equal(sec.toSnapshot().salon_orders.length, 1, 'una ausencia en nube no borra una orden local')
  })
})

describe('legacy: la comanda cobrada y lista sale del tablero', () => {
  test('REGRESION: cobrada antes de cocinar se queda; cobrada y lista se va', () => {
    const s = conOrdenLocal()
    s.apply(ev(EVENT.ORDER_CLOSED, { order_id: 'X', mesa: 5 }))
    assert.equal(s.toSnapshot().kds_orders.length, 1, 'cobrada antes de cocinar: la cocina la sigue viendo')
    s.apply(ev(EVENT.ORDER_UPSERTED, { order_id: 'X', status: 'lista' }))
    assert.equal(s.toSnapshot().kds_orders.length, 0, 'lista y cobrada: fuera del tablero')
  })
})

describe('kds-ui: la segunda ronda tambien llega a lista', () => {
  test('REGRESION (fuente): la llave de postedStatus lleva el numero de rondas', () => {
    const html = fs.readFileSync(path.join(__dirname, '../kds-ui.html'), 'utf8')
    assert.match(html, /var key=order\.id\+":"\+status\+":"\+rounds/)
  })
})
