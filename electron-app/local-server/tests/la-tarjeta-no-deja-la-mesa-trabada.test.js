'use strict'

/**
 * LA TARJETA QUE NO SE PODIA CERRAR NI CANCELAR.
 *
 * El 2026-09-05 se agrego el cobro con terminal bancaria operada a mano, porque asi cobran
 * en AMALAY: el cajero pasa la tarjeta en la terminal del banco y teclea la autorizacion.
 * Lo que nadie noto es que el permiso que ese camino exige no existia para NINGUN rol.
 *
 *   command-handler.js  si method === 'external' -> exige pos.payments.external_result
 *   actor-authority.js  ese permiso no se mapeaba a ningun perfil
 *   actor-authority.test.js:129  lo afirmaba como diseno, para los cinco roles
 *
 * El diseno lo reservaba "al adaptador de proveedor" -- una integracion que confirma sola.
 * Pero ese adaptador no existe (OP-38), y el boton si existia. Resultado, reproducido
 * contra el stack real el 2026-09-08:
 *
 *   1. Cajero aparta $1,240 con 'Terminal bancaria'. Pedro ACEPTA (start solo pide collect).
 *   2. Pasa la tarjeta. El banco APRUEBA. El dinero del cliente ya salio de su cuenta.
 *   3. Teclea la autorizacion -> PERMISSION_DENIED: pos.payments.external_result
 *   4. Con PIN de gerente -> lo mismo. Con el de dueno -> lo mismo.
 *   5. Intenta RECHAZAR para liberar la mesa -> lo mismo, porque el permiso se elegia por
 *      el METODO del pago antes de mirar que estado se queria escribir.
 *   6. Cobrar en efectivo -> OVERPAYMENT (la reserva retiene todo el saldo).
 *   7. Cancelar la orden -> FINANCIAL_ORDER_LOCKED.
 *   8. Cerrar el turno -> UNSETTLED_FINANCIAL_ACCOUNTS. El corte Z no sale.
 *
 * Una mesa ocupada toda la noche y un corte que no cierra, por la primera tarjeta del
 * servicio. Peor que no haber puesto el boton.
 *
 * Run: node --test electron-app/local-server/tests/la-tarjeta-no-deja-la-mesa-trabada.test.js
 */

const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path'); const os = require('os')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { permissionsFor } = require('../core/actor-authority')
const prepareCatalog = require('./fixtures/financial-service-catalog.cjs')

/** Un actor con los permisos REALES de ese rol, no una lista inventada. */
const actorDe = (role, id = role) => ({
  id, name: `${role} de prueba`, expires_at: Date.now() + 3600000,
  permissions: [...permissionsFor(role), 'abrir_cuentas_restaurante', 'actualizar_estatus_orden'],
})

let dir, counter, instancia
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-tarjeta-')); counter = 0; instancia = 0 })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

// Cada montaje vive en su propio directorio. Compartirlo hacia que el segundo
// reprodujera el events.ndjson del primero y ORDER_SAVE chocara con la orden ya
// existente -- fallo del arnes, no del codigo, y se leia como un fallo de permisos.
async function mesaConTarjetaApartada(rolQueCobra = 'cajero') {
  const raiz = path.join(dir, `i${++instancia}`)
  fs.mkdirSync(raiz, { recursive: true })
  const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(raiz, 'events.ndjson') }))
  await store.load()
  const catalog = await prepareCatalog(path.join(raiz, 'catalog'), 'test')
  const state = new RestaurantState({ localAuthorityEnabled: true })
  const handler = new CommandHandler({ eventStore: store, state, wsHub: { async broadcast() {} },
    restaurantId: 'test', localAuthorityEnabled: true, catalogStore: catalog })
  const send = (type, fields = {}, actor = actorDe(rolQueCobra)) =>
    handler.handle({ restaurant_id: 'test', payload: { command_type: type, command_id: `cmd-${++counter}`, ...fields } }, 'POS-A', { actor })

  const admin = actorDe('admin')
  const turno = await send('TURN_OPEN', { turno_id: 't1', opening_cash_cents: 0 }, admin)
  assert.ok(turno.event, 'TURN_OPEN: ' + JSON.stringify(turno))
  const guardada = await send('ORDER_SAVE', { order_id: 'mesa12', turno_id: 't1', expected_revision: 0,
    catalog_revision: catalog.read().revision, mesa: 7,
    items: [{ line_id: 'l1', product_id: 'soup', quantity: 1 }] }, admin)
  assert.ok(guardada.event, 'ORDER_SAVE: ' + JSON.stringify(guardada))
  const enviada = await send('ORDER_SEND', { order_id: 'mesa12', turno_id: 't1', expected_revision: 1 }, admin)
  assert.ok(enviada.event, 'ORDER_SEND: ' + JSON.stringify(enviada))
  // El importe sale de la orden guardada, no de un numero inventado: el dominio compara
  // el cobro contra el total real (ORDER_TOTAL_CONFLICT) y esa guarda tiene que seguir viva.
  const IMPORTE = enviada.result.operational_order.total_cents
    ?? Math.round(Number(enviada.result.operational_order.total) * 100)
  const open = await send('FINANCIAL_OPEN', { order_id: 'mesa12', turno_id: 't1', expected_revision: 0,
    expected_order_revision: 2, currency: 'MXN', total_cents: IMPORTE }, admin)
  assert.ok(open.event, 'la cuenta deberia abrir: ' + JSON.stringify(open))

  // El cajero aparta el importe con la terminal bancaria. Esto SIEMPRE funciono.
  const CUENTA = state.getFinancialOrder('mesa12').accounts[0].account_id
  const start = await send('FINANCIAL_PAYMENT_START', { order_id: 'mesa12',
    expected_revision: state.getFinancialOrder('mesa12').revision, account_id: CUENTA,
    payment_id: 'p1', amount_cents: IMPORTE, method: 'external', provider: 'Clip 1' })
  assert.ok(start.event, 'apartar el importe deberia funcionar: ' + JSON.stringify(start))
  return { send, state, IMPORTE, CUENTA }
}

const resultado = (state, status, evidence) => ({
  order_id: 'mesa12', payment_id: 'p1', status,
  expected_revision: state.getFinancialOrder('mesa12').revision,
  ...(evidence ? { evidence } : {}),
})

const voucher = importe => ({ kind: 'provider_result', provider: 'Clip 1', status: 'accepted',
  reference: 'AUTH-889231', amount_cents: importe, currency: 'MXN' })

test('el cajero que paso la tarjeta puede registrar que el banco aprobo', async () => {
  const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada('cajero')
  const r = await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'accepted', voucher(IMPORTE)))
  assert.ok(r.event, 'PERMISSION_DENIED aqui es la trampa original: ' + JSON.stringify(r))
})

test('y el gerente y el admin tambien — antes ni el dueno podia', async () => {
  for (const rol of ['capitan', 'gerente', 'admin']) {
    const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada(rol)
    const r = await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'accepted', voucher(IMPORTE)))
    assert.ok(r.event, `${rol} deberia poder cerrar la tarjeta: ` + JSON.stringify(r))
  }
})

test('un mesero NO puede: no cierra cuentas, no cierra tarjetas', async () => {
  const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada('cajero')
  const r = await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'accepted', voucher(IMPORTE)), actorDe('mesero'))
  assert.equal(r.error?.code ?? r.code, 'PERMISSION_DENIED', JSON.stringify(r))
})

test('LA SALIDA: rechazar la tarjeta libera la mesa, y cuesta lo mismo que cobrar', async () => {
  // Esta es la que convertia el defecto en trampa. El banco declina, no entro un peso, y
  // aun asi no se podia soltar el importe: el permiso se elegia por el metodo del pago
  // antes de mirar el estado. Rechazar no crea dinero; bloquearlo solo traba mesas.
  const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada('cajero')
  const r = await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'rejected',
    { kind: 'provider_result', provider: 'Clip 1', status: 'rejected', reference: 'AUTH-DECLINADA', amount_cents: IMPORTE, currency: 'MXN' }))
  assert.ok(r.event, 'rechazar deberia liberar el importe: ' + JSON.stringify(r))
})

test('y despues de rechazar, la misma mesa se puede cobrar en efectivo', async () => {
  // El cierre del guion: sin esto, "se libera" seria solo una afirmacion.
  const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada('cajero')
  await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'rejected',
    { kind: 'provider_result', provider: 'Clip 1', status: 'rejected', reference: 'AUTH-DECLINADA', amount_cents: IMPORTE, currency: 'MXN' }))
  const start = await send('FINANCIAL_PAYMENT_START', { order_id: 'mesa12',
    expected_revision: state.getFinancialOrder('mesa12').revision, account_id: CUENTA,
    payment_id: 'p2', amount_cents: IMPORTE, method: 'cash' })
  assert.ok(start.event, 'la mesa deberia poder cobrarse en efectivo: ' + JSON.stringify(start))
  const cobro = await send('FINANCIAL_PAYMENT_RESULT', { order_id: 'mesa12', payment_id: 'p2',
    status: 'accepted', expected_revision: state.getFinancialOrder('mesa12').revision,
    evidence: { kind: 'cash_received', received_by: 'cajero', received_cents: IMPORTE } })
  assert.ok(cobro.event, 'el cobro en efectivo deberia cerrar: ' + JSON.stringify(cobro))
})

test('"no se que paso" sigue siendo cosa de gerente — aparta dinero sin confirmar', async () => {
  // El unico de los tres estados que NO se abarato: deja el importe reservado a la espera
  // de conciliacion, asi que sigue pidiendo pos.payments.reconcile.
  const { send, state, IMPORTE, CUENTA } = await mesaConTarjetaApartada('cajero')
  const cajero = await send('FINANCIAL_PAYMENT_RESULT', resultado(state, 'unknown',
    { kind: 'provider_result', provider: 'Clip 1', status: 'unknown', reference: 'AUTH-SIN-RESPUESTA', amount_cents: IMPORTE, currency: 'MXN' }))
  assert.equal(cajero.error?.code ?? cajero.code, 'PERMISSION_DENIED', JSON.stringify(cajero))

  const { send: send2, state: state2, IMPORTE: I2 } = await mesaConTarjetaApartada('gerente')
  const g = await send2('FINANCIAL_PAYMENT_RESULT', resultado(state2, 'unknown',
    { kind: 'provider_result', provider: 'Clip 1', status: 'unknown', reference: 'AUTH-SIN-RESPUESTA', amount_cents: I2, currency: 'MXN' }))
  assert.ok(g.event, 'el gerente si deberia poder conciliar: ' + JSON.stringify(g))
})
