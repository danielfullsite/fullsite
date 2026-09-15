'use strict'
/**
 * COEXISTENCIA kds_orders ↔ kds_queue — la matriz completa.
 *
 * El KDS lee de dos fuentes que describen lo mismo desde épocas distintas:
 *
 *   · `kds_queue`  — lo que llena la caja legacy (incluida la 1.3.3 que corre
 *                    hoy en AMALAY). Es la única fuente hasta que cocina toca
 *                    algo.
 *   · `kds_orders` — la proyección nativa, con autoridad, que aparece en cuanto
 *                    cocina marca la primera comanda.
 *
 * El defecto que arregla `793125c8` era un `o esto o aquello`:
 *
 *     if (kds_orders.length) return kds_orders   // ← y kds_queue se perdía
 *
 * Bastaba que cocina tocara UNA comanda para que naciera un solo `kds_order`, y
 * en ese instante **desaparecían de la pantalla todas las demás comandas** que
 * aún vivían sólo en `kds_queue`. Comida pedida, invisible para la cocina.
 *
 * Su prueba cubre la unión y el desempate. Falta lo demás — y sobre todo el
 * caso que AMALAY corre HOY: sólo `kds_queue`, sin un solo `kds_order`. Que la
 * ruta legacy siga intacta es la mitad del arreglo, y no estaba medida.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')

/** Extrae `adaptOrders` del HTML servido. Si deja de ser extraíble, la prueba
 *  lo dice en vez de pasar en vacío. */
function cargarAdaptador() {
  const html = fs.readFileSync(path.join(__dirname, '../kds-ui.html'), 'utf8')
  const source = html.match(/  function adaptOrders\(data\)\{[\s\S]*?\n  \}\n\n  function fetchState/)
  assert.ok(source, 'adaptOrders debe seguir siendo extraíble para esta regresión')
  const fn = source[0].replace(/\n\n  function fetchState$/, '\nreturn adaptOrders')
  return vm.runInNewContext(`(function(){${fn}})()`)
}

const ids = (v) => Array.from(v, o => o.id).sort()

// ── 1 · Sólo la fuente legacy — lo que corre HOY en AMALAY ──────────────────

test('sólo kds_queue: se ven TODAS las comandas (el camino de la caja legacy)', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [],
    kds_queue: [
      { order_id: 'o-1', mesa: 1, items_sent: [{ id: 'guacamole' }], sent_at: 1 },
      { order_id: 'o-2', mesa: 2, items_sent: [{ id: 'panque' }], sent_at: 2 },
    ],
  })
  assert.deepEqual(ids(visible), ['o-1', 'o-2'])
  assert.equal(visible[0].status, 'enviada', 'una comanda legacy se pinta como enviada')
})

test('sólo kds_queue: se conserva el turno — sin él la comanda no se puede atribuir', () => {
  const adaptOrders = cargarAdaptador()
  const [v] = adaptOrders({ kds_queue: [{ order_id: 'o-9', mesa: 9, turno_id: 't-1', items_sent: [], sent_at: 1 }] })
  assert.equal(v.turno_id, 't-1')
  assert.equal(v.order_id, 'o-9', 'order_id se conserva además de id: el KDS marca por order_id')
})

// ── 2 · Sólo la fuente nativa ───────────────────────────────────────────────

test('sólo kds_orders: se ven todas y no se inventa nada', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [{ id: 'o-5', mesa: 5, status: 'preparando' }],
    kds_queue: [],
  })
  assert.deepEqual(ids(visible), ['o-5'])
  assert.equal(visible[0].status, 'preparando')
})

// ── 3 · Las dos a la vez ────────────────────────────────────────────────────

test('disjuntas: la pantalla muestra la UNIÓN, no una de las dos', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [{ id: 'o-7', mesa: 7, status: 'preparando' }],
    kds_queue: [
      { order_id: 'o-1', mesa: 1, items_sent: [], sent_at: 1 },
      { order_id: 'o-43', mesa: 43, items_sent: [], sent_at: 3 },
    ],
  })
  assert.deepEqual(ids(visible), ['o-1', 'o-43', 'o-7'],
    'ésta es la regresión: antes, o-1 y o-43 desaparecían al aparecer o-7')
})

test('la misma orden en las dos: gana la nativa y NO se duplica', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [{ id: 'o-7', order_id: 'o-7', mesa: 7, status: 'lista', kitchen_revision: 2 }],
    kds_queue: [{ order_id: 'o-7', mesa: 7, items_sent: [{ id: 'viejo' }], sent_at: 1 }],
  })
  assert.equal(visible.length, 1, 'una comanda duplicada en pantalla es una comanda que se cocina dos veces')
  assert.equal(visible[0].status, 'lista', 'la versión con autoridad es la que manda')
})

test('la nativa gana aunque se identifique por order_id y no por id', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [{ order_id: 'o-7', mesa: 7, status: 'lista' }],
    kds_queue: [{ order_id: 'o-7', mesa: 7, items_sent: [], sent_at: 1 }],
  })
  assert.equal(visible.length, 1)
})

// ── 4 · Bordes: lo que NO debe tirar la pantalla de cocina ──────────────────

// `adaptOrders` corre dentro de un `vm` con su propio realm, así que sus arreglos
// NO son del mismo `Array` que los de esta prueba y `deepStrictEqual` falla por
// prototipo aunque el contenido sea idéntico. Se compara longitud y contenido,
// que es lo que de verdad importa. (Primera corrida: dos fallos por esto —
// error del instrumento, no del producto.)
test('sin datos, sin campos, o con campos vacíos: lista vacía y nada revienta', () => {
  const adaptOrders = cargarAdaptador()
  for (const entrada of [null, undefined, {}, { kds_orders: [], kds_queue: [] },
                         { kds_orders: null, kds_queue: null }]) {
    const r = adaptOrders(entrada)
    assert.equal(r.length, 0, `falló con ${JSON.stringify(entrada)}`)
  }
})

test('una entrada de la cola sin order_id se ignora en vez de pintar una comanda fantasma', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_queue: [
      { mesa: 3, items_sent: [], sent_at: 1 },            // sin order_id
      null,                                               // basura
      { order_id: 'o-4', mesa: 4, items_sent: [], sent_at: 2 },
    ],
  })
  assert.deepEqual(ids(visible), ['o-4'])
})

test('una comanda legacy sin items no se cae: pinta una lista vacía', () => {
  const adaptOrders = cargarAdaptador()
  const [v] = adaptOrders({ kds_queue: [{ order_id: 'o-8', mesa: 8, sent_at: 1 }] })
  assert.equal(v.items.length, 0)
})

// ── 5 · El orden ────────────────────────────────────────────────────────────

test('las nativas van primero — cocina ve antes lo que ya está en curso', () => {
  const adaptOrders = cargarAdaptador()
  const visible = adaptOrders({
    kds_orders: [{ id: 'nativa', mesa: 1 }],
    kds_queue: [{ order_id: 'legacy', mesa: 2, items_sent: [], sent_at: 1 }],
  })
  assert.equal(visible[0].id, 'nativa')
})
