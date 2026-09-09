'use strict'

/**
 * LA RONDA ENVIADA SIN INTERNET CONGELA LA MESA.
 *
 * Es el defecto que quedaba abierto del plan de cierre, y hasta hoy vivía en prosa. Esta
 * prueba lo fija: describe la cadena exacta y ancla el comportamiento de HOY, para que
 * quien lo arregle sepa qué tiene que cambiar y se entere si lo cambia sin querer.
 *
 * LA CADENA, verificada el 2026-09-08 sobre la rama candidata:
 *
 *   1. dashboard-app/src/app/pos/page.tsx:3505
 *      Al enviar la ronda, el comando lleva
 *          ...(saveResult.revision != null ? { order_revision: saveResult.revision } : {})
 *      Sin internet la nube nunca contestó, así que `saveResult.revision` es null y el
 *      campo se OMITE. El envío a cocina sí sale — la comanda se imprime y el KDS la ve.
 *
 *   2. electron-app/local-server/core/state.js:23
 *      `orderFields` copia sólo los campos presentes (`payload[k] !== undefined`), así que
 *      la orden queda guardada SIN `order_revision`.
 *
 *   3. Y ahí se cierran las dos puertas:
 *
 *      financial-domain.js:165    ORDER_REVISION_REQUIRED
 *                                 no se puede abrir la cuenta → no se puede COBRAR
 *      operational-domain.js:154  LEGACY_ORDER_REQUIRES_CUTOVER
 *                                 la orden no tiene authority:'caja' → no se puede EDITAR
 *
 * La mesa queda con comida servida, comanda en cocina, y sin forma de cobrarla ni
 * modificarla desde ninguna terminal. Eso es "congelada".
 *
 * POR QUÉ NO SE ARREGLA AQUÍ MISMO
 *
 * No es una línea. Es la costura entre dos modelos de autoridad: la orden nació por el
 * camino viejo (la nube manda) mientras no había nube, y el camino nuevo (Caja manda) se
 * niega a adoptarla. El propio mensaje de error nombra la solución — "requiere migración
 * de autoridad" — y el inventario de huecos la tiene anotada como H14: "No existe adopción
 * automática de órdenes legacy".
 *
 * Arreglarlo es un comando de adopción con sus reglas (qué orden es segura de adoptar, en
 * qué turno, con qué revisión inicial), y es código de dinero: pide revisión adversarial
 * independiente antes de tocarlo. Media noche con el restaurante enfrente no es el momento.
 *
 * QUÉ HACE ESTA PRUEBA
 *
 * Ancla el comportamiento actual. Hoy pasa en verde porque describe lo que ocurre. El día
 * que alguien implemente la adopción, ESTA PRUEBA SE VA A PONER EN ROJO — y eso es lo que
 * se busca: que el arreglo sea deliberado y que quien lo haga lea esta explicación antes
 * de borrarla.
 *
 * Run: node --test electron-app/local-server/tests/ronda-offline-congela-la-mesa.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { FinancialDomain, FinancialError } = require('../core/financial-domain')

/** Una orden como la que deja el envío SIN internet: sin `order_revision`. */
const ordenEnviadaSinInternet = () => ({
  order_id: 'mesa-7', turno_id: 'turno-1', status: 'enviada', total_cents: 45000,
  items: [{ id: 'linea-1', cantidad: 2, sent_quantity: 2 }],
  // order_revision: AUSENTE — la nube nunca confirmó, así que pos/page.tsx lo omitió.
})

/** La misma orden, con la revisión que sí llega cuando hay internet. */
const ordenEnviadaConInternet = () => ({ ...ordenEnviadaSinInternet(), order_revision: 3 })

function abrirCuenta(order, expectedOrderRevision) {
  const domain = new FinancialDomain()
  return domain.prepare({
    command_type: 'FINANCIAL_OPEN', order_id: order.order_id, expected_revision: 0,
    turno_id: 'turno-1', expected_order_revision: expectedOrderRevision,
    total_cents: order.total_cents, currency: 'MXN',
  }, { order, turno: { id: 'turno-1' } })
}

describe('el envío sin internet deja la orden sin revisión', () => {
  test('con internet la cuenta se abre y se puede cobrar', () => {
    // El control. Si esto fallara, el problema sería otro y esta prueba estaría mintiendo.
    const resultado = abrirCuenta(ordenEnviadaConInternet(), 3)
    assert.equal(resultado.financial_order.order_revision, 3)
    assert.equal(resultado.financial_order.total_cents, 45000)
  })

  test('SIN internet la cuenta NO se puede abrir — la mesa queda sin forma de cobrarse', () => {
    assert.throws(() => abrirCuenta(ordenEnviadaSinInternet(), 0), (e) => {
      assert.ok(e instanceof FinancialError)
      assert.equal(e.code, 'ORDER_REVISION_REQUIRED')
      return true
    })
  })

  test('y tampoco se salva mandando cero como revisión esperada', () => {
    // La salida obvia —"si no hay revisión, manda 0"— tampoco funciona: la guarda mira la
    // revisión de la ORDEN GUARDADA, no la que manda el cliente.
    for (const esperada of [0, 1, 3]) {
      assert.throws(() => abrirCuenta(ordenEnviadaSinInternet(), esperada),
        { code: 'ORDER_REVISION_REQUIRED' },
        `con expected_order_revision=${esperada} debería seguir fallando por la misma razón`)
    }
  })

  test('una revisión inválida se rechaza igual que una ausente', () => {
    // Cierra la puerta de atrás: nadie debe poder colar una orden cobrable inventando el
    // campo con basura.
    for (const revision of [null, -1, 1.5, '3', NaN]) {
      assert.throws(() => abrirCuenta({ ...ordenEnviadaSinInternet(), order_revision: revision }, 0),
        { code: 'ORDER_REVISION_REQUIRED' },
        `order_revision=${String(revision)} no debería abrir una cuenta`)
    }
  })
})

describe('lo que tendría que cambiar para descongelarla', () => {
  test('CUANDO EXISTA LA ADOPCIÓN, esta prueba se pone en rojo — a propósito', () => {
    // Hoy verde. El día que Caja sepa adoptar una orden legacy —darle authority:'caja' y
    // una revisión inicial— este assert va a fallar, y quien lo vea tiene arriba la
    // explicación completa de por qué existía.
    //
    // Lo que el arreglo debe resolver, y que NO es sólo dejar pasar el campo:
    //   · qué orden es segura de adoptar (abierta, del turno actual, sin pagos)
    //   · con qué revisión inicial, sin que choque con la que la nube asigne al sincronizar
    //   · idempotencia: adoptar dos veces no puede duplicar ni reabrir nada
    //   · que la orden adoptada siga siendo la MISMA para cocina, que ya tiene su comanda
    assert.throws(() => abrirCuenta(ordenEnviadaSinInternet(), 0), { code: 'ORDER_REVISION_REQUIRED' },
      'Si esto ya no lanza, la adopción de órdenes legacy existe: actualiza esta prueba en vez de borrarla.')
  })
})
