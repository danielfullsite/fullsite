'use strict'
const path = require('node:path')

/** Only screen gestures mutate the service. HTTP reads independently verify the
 * durable result; no helper command creates an order or records a payment. */
module.exports = async function ({ caja, pos2, pos3, kds, check, expect, assert, until, request, output, uiOrigin, labPin, restartCaja }) {
  const snapshot = async () => (await request(caja, '/state')).json()
  let orderId
  const addCoffee = async terminal => {
    await terminal.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
    await terminal.page.getByRole('button', { name: /Café de laboratorio.*50/ }).click()
    await terminal.page.locator('label').getByText('Caliente de laboratorio', { exact: true }).click()
    await terminal.page.getByRole('button', { name: /Agregar.*50/ }).click()
  }
  const modal = terminal => terminal.page.getByRole('dialog', { name: 'Cobro de la cuenta' })
  const openPayment = async terminal => {
    await terminal.page.getByRole('button', { name: 'Cobrar', exact: true }).click()
    await expect(modal(terminal)).toBeVisible()
  }
  const collectCash = async (terminal, amount) => {
    const dialog = modal(terminal)
    await dialog.getByLabel('Importe a cobrar', { exact: true }).fill(amount)
    await dialog.getByRole('button', { name: 'Preparar cobro en efectivo', exact: true }).click()
    await dialog.getByRole('textbox', { name: /^Efectivo recibido / }).fill(amount)
    await dialog.getByRole('button', { name: 'Confirmar efectivo recibido', exact: true }).click()
    await expect(dialog.getByText('Efectivo registrado en Caja y compartido con las terminales.')).toBeVisible()
  }
  await check('Sin WAN se abre turno desde el botón de Caja y lo comparten tres terminales', async () => {
    await expect(caja.page.getByText('No hay turno abierto', { exact: true })).toBeVisible({ timeout: 30000 })
    await caja.page.getByPlaceholder('0.00', { exact: true }).fill('500')
    await caja.page.getByRole('button', { name: /Abrir turno/i }).click()
    await until(async () => (await snapshot()).turno?.opening_cash_cents === 50000, 'Turno durable desde UI')
    for (const t of [pos2, pos3]) await t.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded' })
    await expect(pos2.page.getByRole('button', { name: /Bebidas laboratorio/ })).toBeVisible({ timeout: 30000 })
  })
  await check('POS 2 captura y guarda; POS 3 ve la misma cuenta antes de enviarla a cocina', async () => {
    await addCoffee(pos2)
    await pos2.page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await until(async () => (await snapshot()).salon_orders.length === 1, 'Cuenta guardada por UI')
    const state = await snapshot(); const order = state.salon_orders[0]
    orderId = order.id
    assert.equal(order.total_cents, 5800)
    assert.equal(state.kds_orders.length, 0, 'Guardar no envía comida')
    await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*58[.,]00/)
  })
  await check('Cobrar una cuenta aún sin enviar no bloquea sus productos pendientes', async () => {
    await openPayment(pos2)
    await expect(modal(pos2).getByText(/Envía todos los productos guardados a cocina/)).toBeVisible()
    await expect(modal(pos2).getByRole('button', { name: 'Preparar cuenta para cobrar', exact: true })).toBeDisabled()
    assert.equal((await snapshot()).financial_orders.length, 0)
    await modal(pos2).getByRole('button', { name: 'Cerrar', exact: true }).click()
  })
  await check('POS 3 agrega otra ronda y Enviar confirma los dos cafés a cocina', async () => {
    await addCoffee(pos3)
    await pos3.page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await until(async () => (await snapshot()).kds_orders.length === 1, 'Ronda desde botón Enviar')
    const state = await snapshot()
    assert.equal(state.salon_orders[0].id, orderId)
    assert.equal(state.salon_orders[0].total_cents, 11600)
    await expect(kds.page.locator('body')).toContainText('Café de laboratorio')
    await expect(pos2.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*116[.,]00/)
    await pos3.page.screenshot({ path: path.join(output, 'orden-creada-compartida.png'), fullPage: true })
  })
  await check('Transferir mesa con PIN conserva la cuenta y la ronda en todos los puntos', async () => {
    const move = async destination => {
      await pos3.page.getByTitle('Transferir mesa', { exact: true }).click()
      await pos3.page.getByPlaceholder('#', { exact: true }).fill(String(destination))
      await pos3.page.getByRole('button', { name: 'Confirmar', exact: true }).click()
      await pos3.page.locator('#move-caja-pin').fill(labPin)
      await pos3.page.getByRole('button', { name: 'Confirmar transferencia', exact: true }).click()
      await expect(pos3.page).toHaveURL(`${uiOrigin}/pos/mesas`)
      await until(async () => (await snapshot()).salon_orders.some(o => o.id === orderId && o.mesa === destination), 'Mesa transferida por UI')
      await pos3.page.goto(`${uiOrigin}/pos?mesa=${destination}`, { waitUntil: 'domcontentloaded' })
      await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*116[.,]00/)
    }
    await move(2); await move(1)
    assert.equal((await snapshot()).kds_orders.length, 1)
    await pos2.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded' })
  })
  await check('Anular otra cuenta con PIN libera su mesa sin alterar el consumo anterior', async () => {
    await pos3.page.goto(`${uiOrigin}/pos?mesa=3`, { waitUntil: 'domcontentloaded' })
    await addCoffee(pos3)
    await pos3.page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await until(async () => (await snapshot()).salon_orders.some(o => o.mesa === 3), 'Cuenta de anulación guardada')
    await pos3.page.getByTitle('Anular orden', { exact: true }).click()
    await pos3.page.getByPlaceholder('Describe el motivo...').fill('Cliente de prueba se retira')
    await pos3.page.getByPlaceholder('****', { exact: true }).fill(labPin)
    await pos3.page.locator('button').filter({ hasText: /^\s*Anular orden\s*$/ }).click()
    await expect(pos3.page).toHaveURL(`${uiOrigin}/pos/mesas`)
    const state = await snapshot()
    assert.equal(state.salon_orders.length, 1)
    assert.equal(state.salon_orders[0].id, orderId)
    assert.equal(state.salon_orders[0].total_cents, 11600)
    await pos3.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded' })
  })
  await check('Dividir desde la pantalla persiste dos cuentas de 58 pesos', async () => {
    await openPayment(pos2)
    await modal(pos2).getByRole('button', { name: 'Preparar cuenta para cobrar' }).click()
    await modal(pos2).getByRole('button', { name: 'Dividir cuenta', exact: true }).click()
    await until(async () => (await snapshot()).financial_orders[0]?.accounts.length === 2, 'Split UI durable')
    assert.deepEqual((await snapshot()).financial_orders[0].accounts.map(a => a.total_cents), [5800, 5800])
  })
  await check('Cobrar 29 pesos desde el botón actualiza el saldo de POS 3', async () => {
    await collectCash(pos2, '29')
    await until(async () => (await snapshot()).financial_orders[0].paid_cents === 2900, 'Pago UI comprometido')
    await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*87[.,]00/)
    await pos2.page.screenshot({ path: path.join(output, 'cobro-parcial-desde-botones.png'), fullPage: true })
  })
  await check('Reiniciar Caja recupera el cobro y se continúa desde otra terminal', async () => {
    const previous = caja
    previous.process.kill('SIGKILL')
    await until(() => previous.process.exitCode !== null || previous.process.signalCode !== null, 'Termina Caja')
    caja = await restartCaja()
    const finance = (await snapshot()).financial_orders[0]
    assert.equal(finance.paid_cents, 2900); assert.equal(finance.balance_cents, 8700)
    await openPayment(pos3)
    await collectCash(pos3, '29')
    await collectCash(pos3, '58')
    await expect(modal(pos3).getByText('Cuenta liquidada. Cocina conserva la preparación pendiente.')).toBeVisible()
    const state = await snapshot()
    assert.equal(state.financial_orders[0].paid_cents, 11600)
    assert.equal(state.salon_orders.length, 0)
    assert.equal(state.kds_orders.length, 1)
  })
  await check('Sin Caja se bloquea la confirmación de cobros y se conserva la última cuenta', async () => {
    caja.process.kill('SIGKILL')
    await expect(modal(pos3)).toContainText('Sin confirmar conexión con Caja', { timeout: 15000 })
    await expect(modal(pos3)).toContainText('Cuenta liquidada')
    caja = await restartCaja()
    await expect(modal(pos3)).toContainText('Conectado con Caja', { timeout: 15000 })
  })
  await check('Cocina prepara y entrega la ronda desde sus botones sin alterar los cobros', async () => {
    const card = kds.page.locator('.card').filter({ hasText: 'Café de laboratorio' })
    await card.getByRole('button', { name: /Todo listo/ }).click()
    await card.getByRole('button', { name: 'Entregar ronda', exact: true }).click()
    await until(async () => (await snapshot()).kds_orders.length === 0, 'Ronda entregada por KDS real')
    assert.equal((await snapshot()).financial_orders[0].paid_cents, 11600)
  })
  await check('El cierre de turno desde la pantalla concilia 500 de fondo y 116 de ventas', async () => {
    await caja.page.goto(`${uiOrigin}/pos/turno`, { waitUntil: 'domcontentloaded' })
    await caja.page.getByLabel('Efectivo contado al cierre', { exact: true }).fill('616')
    await caja.page.getByRole('button', { name: 'Confirmar cierre de turno', exact: true }).click()
    await expect(caja.page.getByRole('region', { name: 'Último cierre confirmado' })).toBeVisible()
    const state = await snapshot()
    assert.equal(state.turno, null)
    assert.equal(state.turn_summaries[0].cash_sales_cents, 11600)
    assert.equal(state.turn_summaries[0].expected_cash_cents, 61600)
    assert.equal(state.turn_summaries[0].difference_cents, 0)
    await caja.page.screenshot({ path: path.join(output, 'cierre-turno-desde-pantalla.png'), fullPage: true })
    await caja.page.reload({ waitUntil: 'domcontentloaded' })
    await expect(caja.page.getByRole('region', { name: 'Último cierre confirmado' })).toContainText(/616[.,]00/)
  })
  await check('Ninguna pantalla registra errores JavaScript durante el recorrido de botones', async () => {
    assert.deepEqual([pos2, pos3, kds].flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))), [])
  })
}
