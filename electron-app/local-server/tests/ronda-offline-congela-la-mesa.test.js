'use strict'

/**
 * LA RONDA ENVIADA SIN INTERNET YA NO CONGELA LA MESA.
 *
 * Este archivo nació como prueba de caracterización: anclaba el defecto para que el
 * arreglo fuera deliberado, y decía "el día que exista la adopción, esta prueba se va a
 * poner en rojo — a propósito". Ese día fue el mismo: 2026-09-08.
 *
 * EL DEFECTO ERA UNA DIFERENCIA ENTRE CERO Y AUSENTE
 *
 *   1. pos/page.tsx, al enviar la ronda, llevaba
 *          ...(saveResult.revision != null ? { order_revision: ... } : {})
 *      Sin internet la nube nunca contesta, así que el campo se OMITÍA. El envío a cocina
 *      sí salía: la comanda se imprimía y el KDS la veía. Todo parecía bien.
 *
 *   2. state.js:23 — `orderFields` copia sólo los campos presentes, así que la orden
 *      quedaba guardada SIN `order_revision`.
 *
 *   3. Y se cerraban las dos puertas:
 *        financial-domain.js:165    ORDER_REVISION_REQUIRED     → no se podía COBRAR
 *        operational-domain.js:154  LEGACY_ORDER_REQUIRES_CUTOVER → no se podía EDITAR
 *
 *      Mesa con comida servida, comanda en cocina, y sin forma de cobrarla ni modificarla
 *      desde ninguna terminal.
 *
 * EL ARREGLO, Y POR QUÉ NO HIZO FALTA EL COMANDO DE ADOPCIÓN
 *
 * Al rastrearlo pensé que hacía falta un comando de adopción de órdenes legacy — un
 * trabajo de código de dinero con revisión adversarial. Al mirar el eslabón que faltaba
 * resultó más simple y más honesto: la orden nunca ha sido confirmada por la nube, y eso
 * se dice con un CERO, no omitiendo el campo. Es exactamente lo que
 * `operational-domain.js:156` ya asume para una orden nueva, y lo que la pantalla manda
 * al cobrar, porque `orderRevision` arranca en 0.
 *
 * QUÉ PROTECCIÓN SE PIERDE. La guarda de revisión era la tercera de tres, y las otras dos
 * son las que cuidan el dinero de verdad. Esta prueba las ancla abajo, porque son las que
 * ahora sostienen el caso:
 *
 *   FINANCIAL_ORDER_EXISTS   no se puede abrir dos veces la cuenta de la misma orden
 *   ORDER_TOTAL_CONFLICT     no se cobra un total distinto del guardado — que es el caso
 *                            real de "otra terminal agregó una ronda que yo no vi"
 *
 * Pedirle una revisión de nube a una orden que nunca tocó la nube no protegía nada: sólo
 * la volvía incobrable para siempre.
 *
 * Run: node --test electron-app/local-server/tests/ronda-offline-congela-la-mesa.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { FinancialDomain, FinancialError } = require('../core/financial-domain')

/** Una orden como la que deja el envío SIN internet, ya con el arreglo: revisión 0. */
const ordenEnviadaSinInternet = () => ({
  order_id: 'mesa-7', turno_id: 'turno-1', status: 'enviada', total_cents: 45000,
  order_revision: 0,
  items: [{ id: 'linea-1', cantidad: 2, sent_quantity: 2 }],
})

/** La misma orden cuando sí hubo internet: la nube le dio su revisión. */
const ordenEnviadaConInternet = () => ({ ...ordenEnviadaSinInternet(), order_revision: 3 })

function abrir(domain, order, expectedOrderRevision, totalCents) {
  return domain.prepare({
    command_type: 'FINANCIAL_OPEN', order_id: order.order_id, expected_revision: 0,
    turno_id: 'turno-1', expected_order_revision: expectedOrderRevision,
    total_cents: totalCents ?? order.total_cents, currency: 'MXN',
  }, { order, turno: { id: 'turno-1' } })
}

describe('la mesa se puede cobrar aunque se haya enviado sin internet', () => {
  test('la cuenta abre con revisión cero', () => {
    const r = abrir(new FinancialDomain(), ordenEnviadaSinInternet(), 0)
    assert.equal(r.financial_order.order_revision, 0)
    assert.equal(r.financial_order.total_cents, 45000)
  })

  test('y con internet sigue funcionando igual', () => {
    // El control. Si esto fallara, el arreglo habría roto el camino normal.
    const r = abrir(new FinancialDomain(), ordenEnviadaConInternet(), 3)
    assert.equal(r.financial_order.order_revision, 3)
  })

  test('una orden SIN el campo sigue rechazándose', () => {
    // El arreglo es que el POS mande 0, no que el dominio acepte cualquier cosa. Si algún
    // día llega una orden sin revisión —un cliente viejo, un camino que nadie migró—, la
    // guarda tiene que seguir ahí.
    const sinCampo = { ...ordenEnviadaSinInternet() }
    delete sinCampo.order_revision
    assert.throws(() => abrir(new FinancialDomain(), sinCampo, 0), { code: 'ORDER_REVISION_REQUIRED' })
  })

  test('y una revisión inventada también', () => {
    for (const revision of [null, -1, 1.5, '0', NaN]) {
      assert.throws(() => abrir(new FinancialDomain(), { ...ordenEnviadaSinInternet(), order_revision: revision }, 0),
        { code: 'ORDER_REVISION_REQUIRED' },
        `order_revision=${String(revision)} no debería abrir una cuenta`)
    }
  })
})

describe('las dos guardas que ahora sostienen el caso', () => {
  test('no se puede abrir dos veces la cuenta de la misma orden', () => {
    // Dos cajeros cobrando la misma mesa a la vez. El segundo se topa con esto.
    const domain = new FinancialDomain()
    const orden = ordenEnviadaSinInternet()
    domain.apply(abrir(domain, orden, 0).financial_order)
    assert.throws(() => abrir(domain, orden, 0), { code: 'FINANCIAL_ORDER_EXISTS' })
  })

  test('no se cobra un total distinto del que quedó guardado', () => {
    // Es el caso real que la revisión pretendía cubrir: otra terminal agregó una ronda que
    // yo no vi, así que mi total está viejo. Lo atrapa la comparación de importes, que es
    // más directa que una revisión — compara el dinero contra el dinero.
    assert.throws(() => abrir(new FinancialDomain(), ordenEnviadaSinInternet(), 0, 30000),
      { code: 'ORDER_TOTAL_CONFLICT' })
  })

  test('y la revisión esperada sigue teniendo que coincidir', () => {
    assert.throws(() => abrir(new FinancialDomain(), ordenEnviadaConInternet(), 2),
      { code: 'ORDER_REVISION_CONFLICT' })
  })
})

describe('el origen: el POS manda cero, no omite el campo', () => {
  const pos = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'dashboard-app', 'src', 'app', 'pos', 'page.tsx'), 'utf8')

  test('ya no hay ningún envío que omita la revisión', () => {
    // El patrón exacto que congelaba la mesa. Estaba en DOS sitios: el envío offline y el
    // online. Arreglar uno solo habría dejado la mitad del defecto vivo.
    assert.equal(
      (pos.match(/saveResult\.revision != null \? \{ order_revision/g) || []).length, 0,
      'volvió el patrón que omite order_revision cuando no hay revisión de nube')
  })

  test('y los dos sitios mandan cero por omisión', () => {
    assert.equal((pos.match(/order_revision: saveResult\.revision \?\? 0/g) || []).length, 2)
  })
})
