'use strict'
const path = require('node:path')

/** Only screen gestures mutate the service. HTTP reads independently verify the
 * durable result; no helper command creates an order or records a payment. */
module.exports = async function ({ caja, pos2, pos3, kds, check, expect, assert, until, request, output, uiOrigin, labPin, restartCaja, printLab }) {
  // Development route/chunk loading uses the same budget as cold prewarming.
  const navigationTimeout = process.env.CI ? 300000 : 90000
  const snapshot = async () => (await request(caja, '/state')).json()
  let orderId
  const ensureUnlocked = async terminal => {
    const enter = terminal.page.getByRole('button', { name: 'Entrar', exact: true })
    // A navigation can briefly render the PIN shell before React restores the
    // current session. Wait for either the POS or a hydrated keypad.
    await until(async () => terminal.page.evaluate(() => {
      const enter = document.querySelector('button[aria-label="Entrar"]')
      if (!enter) return [...document.querySelectorAll('button')].some(b => /Bebidas laboratorio|Cobrar|Confirmar cierre|Abrir turno|Confirmar movimiento/.test(b.textContent)) || /Corte de Caja|Último cierre confirmado/.test(document.body.innerText)
      const digit = [...enter.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === '1')
      const props = digit && Object.keys(digit).find(k => k.startsWith('__reactProps'))
      return !!props && typeof digit[props]?.onClick === 'function'
    }), 'POS o teclado hidratado', 30000)
    if (!await enter.isVisible()) return
    for (let index = 0; index < labPin.length; index++) {
      if (!await enter.isVisible()) return // Existing session finished restoring.
      await terminal.page.getByRole('button', { name: labPin[index], exact: true }).click()
      await until(async () => !await enter.isVisible() || await terminal.page.evaluate(expected =>
        [...document.querySelectorAll('[style]')].filter(el => /16,\s*185,\s*129/.test(el.style.background || el.style.backgroundColor || '')).length === expected,
      index + 1), 'Dígito reflejado en el teclado', 4000)
    }
    if (!await enter.isVisible()) return
    await enter.click()
    await expect(enter).not.toBeVisible({ timeout: 15000 })
  }
  const addCoffee = async terminal => {
    await ensureUnlocked(terminal)
    await terminal.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
    await terminal.page.getByRole('button', { name: /Café de laboratorio.*50/ }).click()
    await terminal.page.locator('label').getByText('Caliente de laboratorio', { exact: true }).click()
    await terminal.page.getByRole('button', { name: /Agregar.*50/ }).click()
  }
  const modal = terminal => terminal.page.getByRole('dialog', { name: 'Cobro de la cuenta' })
  const openPayment = async terminal => {
    await ensureUnlocked(terminal)
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
    for (const t of [pos2, pos3]) await t.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
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
    await expect(kds.page.locator('body')).toContainText('Café de laboratorio', { timeout: 15000 })
    await expect(pos2.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*116[.,]00/)
    await pos3.page.screenshot({ path: path.join(output, 'orden-creada-compartida.png'), fullPage: true })
  })
  if (printLab) await check('Precuenta y copia salen por TCP local desde documentos canónicos sin cambiar deuda', async () => {
    await ensureUnlocked(pos3)
    const before = await snapshot()
    // Next dev's issue badge overlaps the center of this footer button.
    // Click its lower edge, which remains a real, unobscured product control.
    await pos3.page.getByRole('button', { name: 'Cuenta', exact: true }).click({ position: { x: 10, y: 40 } })
    const document = pos3.page.getByRole('region', { name: 'Impresión de precuenta', exact: true })
    await document.getByRole('button', { name: 'Imprimir precuenta', exact: true }).click()
    await until(() => printLab.packets.length === 1, 'Precuenta recibida en TCP sintético')
    assert.match(printLab.packets[0], /PRECUENTA/)
    assert.match(printLab.packets[0], /Orden #1/)
    assert.match(printLab.packets[0], /Total 116\.00/)
    await document.getByLabel('Motivo de la copia', { exact: true }).fill('Cliente pide copia laboratorio')
    await document.getByRole('button', { name: 'Imprimir copia de precuenta', exact: true }).click()
    await until(() => printLab.packets.length === 2, 'Copia recibida en TCP sintético')
    assert.match(printLab.packets[1], /COPIA/)
    assert.match(printLab.packets[1], /Cliente pide copia laboratorio/)
    assert.deepEqual((await snapshot()).financial_orders, before.financial_orders)
    await pos3.page.getByRole('button', { name: 'Cerrar precuenta', exact: true }).click()
  })
  await check('Transferir mesa con PIN conserva la cuenta y la ronda en todos los puntos', async () => {
    const move = async destination => {
      const source = (await snapshot()).salon_orders.find(order => order.id === orderId).mesa
      await pos3.page.getByTitle('Transferir mesa', { exact: true }).click()
      await pos3.page.getByPlaceholder('#', { exact: true }).fill(String(destination))
      await pos3.page.getByRole('button', { name: 'Confirmar', exact: true }).click()
      await pos3.page.locator('#move-caja-pin').fill(labPin)
      await pos3.page.getByRole('button', { name: 'Confirmar transferencia', exact: true }).click()
      await expect(pos3.page).toHaveURL(`${uiOrigin}/pos/mesas`, { timeout: 30000 })
      assert.deepEqual(await pos3.page.evaluate(mesa => ({
        account: localStorage.getItem(`pos_cuenta_closure-lab_mesa:${mesa}`),
        order: localStorage.getItem(`pos_order_${mesa}`), draft: localStorage.getItem(`pos_draft_${mesa}`),
      }), source), { account: null, order: null, draft: null }, 'Mover no recrea caché vacía al desmontar el editor')
      await until(async () => (await snapshot()).salon_orders.some(o => o.id === orderId && o.mesa === destination), 'Mesa transferida por UI')
      await pos3.page.goto(`${uiOrigin}/pos?mesa=${destination}`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
      await ensureUnlocked(pos3)
      await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*116[.,]00/)
    }
    await move(2); await move(1)
    assert.equal((await snapshot()).kds_orders.length, 1)
    await pos2.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos2)
  })
  if (printLab?.drawer) await check('La apertura manual requiere PIN y motivo y envía un único pulso al cajón configurado', async () => {
    const before = await snapshot()
    const count = printLab.hex.length
    await ensureUnlocked(pos3)
    await pos3.page.getByTitle('Abrir cajón', { exact: true }).click()
    const panel = pos3.page.getByRole('region', { name: 'Apertura manual del cajón', exact: true })
    await panel.getByLabel('Motivo de apertura', { exact: true }).fill('Cambio laboratorio')
    await panel.getByLabel('PIN para abrir el cajón', { exact: true }).fill(labPin)
    await panel.getByRole('button', { name: 'Solicitar apertura manual', exact: true }).click()
    await until(() => printLab.hex.length === count + 1, 'Pulso manual recibido en TCP sintético')
    assert.equal(printLab.hex.at(-1), '1b700019fa')
    const after = await snapshot()
    assert.deepEqual(after.financial_orders, before.financial_orders)
    assert.equal(after.drawer_operations.filter(operation => operation.kind === 'manual').length, 1)
    await pos3.page.getByRole('button', { name: 'Cerrar apertura manual', exact: true }).click()
  })
  await check('Anular otra cuenta con PIN libera su mesa sin alterar el consumo anterior', async () => {
    await pos3.page.goto(`${uiOrigin}/pos?mesa=3`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos3)
    await addCoffee(pos3)
    await pos3.page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await until(async () => (await snapshot()).salon_orders.some(o => o.mesa === 3), 'Cuenta de anulación guardada')
    await pos3.page.getByTitle('Anular orden', { exact: true }).click()
    await pos3.page.getByPlaceholder('Describe el motivo...').fill('Cliente de prueba se retira')
    await pos3.page.getByPlaceholder('****', { exact: true }).fill(labPin)
    await pos3.page.locator('button').filter({ hasText: /^\s*Anular orden\s*$/ }).click()
    await expect(pos3.page).toHaveURL(`${uiOrigin}/pos/mesas`, { timeout: 30000 })
    const state = await snapshot()
    assert.equal(state.salon_orders.length, 1)
    assert.equal(state.salon_orders[0].id, orderId)
    assert.equal(state.salon_orders[0].total_cents, 11600)
    await pos3.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos3)
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
    await ensureUnlocked(pos3)
    await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*87[.,]00/)
    await pos2.page.screenshot({ path: path.join(output, 'cobro-parcial-desde-botones.png'), fullPage: true })
  })
  if (printLab) await check('El recibo del abono se imprime sin registrar otro pago', async () => {
    const before = (await snapshot()).financial_orders[0]
    const count = printLab.packets.length
    await modal(pos2).getByRole('button', { name: 'Imprimir recibo del abono', exact: true }).click()
    await until(() => printLab.packets.length === count + 1, 'Recibo parcial en TCP sintético')
    assert.match(printLab.packets.at(-1), /Importe recibido 29\.00/)
    assert.match(printLab.packets.at(-1), /Saldo 87\.00/)
    assert.deepEqual((await snapshot()).financial_orders[0], before)
  })
  if (printLab?.drawer) await check('El efectivo confirmado sólo abre el cajón por acción explícita y una vez por abono', async () => {
    const before = (await snapshot()).financial_orders[0]
    assert.equal(printLab.hex.filter(bytes => bytes === '1b700019fa').length, 1, 'Confirmar dinero no emite pulso automático')
    const count = printLab.hex.length
    const button = modal(pos2).getByRole('button', { name: 'Solicitar apertura para este abono', exact: true })
    await button.click()
    await until(() => printLab.hex.length === count + 1, 'Pulso por abono recibido en TCP sintético')
    assert.equal(printLab.hex.at(-1), '1b700019fa')
    await expect(button).toBeDisabled()
    assert.deepEqual((await snapshot()).financial_orders[0], before)
    await modal(pos2).getByRole('button', { name: 'Cerrar', exact: true }).click()
    await openPayment(pos2)
    await expect(modal(pos2).getByRole('button', { name: 'Solicitar apertura para este abono', exact: true })).toBeDisabled()
    assert.equal(printLab.hex.length, count + 1)
  })
  await check('Después del abono se agrega consumo a la segunda cuenta sin cambiar pagos ni imprimir al guardar', async () => {
    const before = await snapshot()
    const previousKitchen = before.kds_orders
    const previousPayments = before.financial_orders[0].payments
    await expect(pos3.page.locator('body')).toContainText(/Sub \$100[.,]00/)
    await addCoffee(pos3)
    const destination = pos3.page.getByLabel('Cuenta para el consumo nuevo', { exact: true })
    await expect(destination).toBeVisible()
    await destination.selectOption(before.financial_orders[0].accounts[1].account_id)
    await pos3.page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await until(async () => (await snapshot()).financial_orders[0].total_cents === 17400, 'Consumo aditivo compartido')
    const saved = await snapshot()
    assert.deepEqual(saved.financial_orders[0].payments, previousPayments)
    assert.deepEqual(saved.financial_orders[0].accounts.map(a => a.total_cents), [5800, 11600])
    assert.equal(saved.financial_orders[0].paid_cents, 2900)
    assert.equal(saved.financial_orders[0].balance_cents, 14500)
    assert.deepEqual(saved.kds_orders.map(o => o.items), previousKitchen.map(o => o.items))
    const { events } = await (await request(caja, '/events?since=0')).json()
    const savedEvent = events.filter(event => event.type === 'ORDER_SAVE').at(-1)
    assert.equal(savedEvent.effects?.print_jobs?.length || 0, 0, 'Guardar no genera impresión')
    await openPayment(pos3)
    await expect(modal(pos3).getByRole('button', { name: 'Preparar cobro en efectivo', exact: true })).toBeDisabled()
    await expect(modal(pos3).getByText(/Envía todos los productos guardados/)).toBeVisible()
    await modal(pos3).getByRole('button', { name: 'Cerrar', exact: true }).click()
    await pos3.page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await until(async () => {
      const current = (await snapshot()).salon_orders[0]
      const items = typeof current.items === 'string' ? JSON.parse(current.items) : current.items
      return items.every(item => item.sent_quantity === item.cantidad)
    }, 'Nueva ronda incremental enviada')
    const sent = (await snapshot()).salon_orders[0]
    assert.equal(sent.kitchen_items.reduce((sum, item) => sum + item.cantidad, 0), 3)
    const batches = Object.values(JSON.parse(sent.comanda_batches))
    assert.equal(batches.length, 2)
    const last = sent.kitchen_items.filter(item => item.comanda_batch_seq === 1)
    assert.equal(last.reduce((sum, item) => sum + item.cantidad, 0), 1, 'Sólo un café nuevo llega a cocina')
    await expect(pos2.page.locator('body')).toContainText(/145[.,]00/)
    await pos3.page.screenshot({ path: path.join(output, 'consumo-aditivo-tras-abono.png'), fullPage: true })
  })
  await check('Corte X sin WAN incluye el pago parcial antes de entregar cocina', async () => {
    await pos3.page.goto(`${uiOrigin}/pos/corte`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos3)
    await expect(pos3.page.getByRole('heading', { name: 'Corte de Caja' })).toBeVisible()
    await expect(pos3.page.locator('dl').locator('div').filter({ hasText: 'Cobrado confirmado' })).toContainText(/29[.,]00/)
    await expect(pos3.page.locator('dl').locator('div').filter({ hasText: 'Efectivo esperado' })).toContainText(/529[.,]00/)
    await expect(pos3.page.locator('dl').locator('div').filter({ hasText: 'Saldo por cobrar' })).toContainText(/145[.,]00/)
    assert.equal((await snapshot()).kds_orders.length,1)
    await pos3.page.screenshot({ path: path.join(output, 'corte-x-parcial-sin-wan.png'), fullPage: true })
    await pos3.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos3)
  })
  await check('Reiniciar Caja recupera el cobro y se continúa desde otra terminal', async () => {
    const previous = caja
    previous.process.kill('SIGKILL')
    await until(() => previous.process.exitCode !== null || previous.process.signalCode !== null, 'Termina Caja')
    caja = await restartCaja()
    const finance = (await snapshot()).financial_orders[0]
    assert.equal(finance.paid_cents, 2900); assert.equal(finance.balance_cents, 14500)
    await openPayment(pos3)
    await collectCash(pos3, '29')
    await collectCash(pos3, '116')
    await expect(modal(pos3).getByText('Cuenta liquidada. Cocina conserva la preparación pendiente.')).toBeVisible()
    const state = await snapshot()
    assert.equal(state.financial_orders[0].paid_cents, 17400)
    assert.equal(state.salon_orders.length, 0)
    assert.equal(state.kds_orders.length, 1)
  })
  if (printLab) await check('La cuenta liquidada conserva acceso al recibo del último abono', async () => {
    const before = (await snapshot()).financial_orders[0]
    const count = printLab.packets.length
    await modal(pos3).getByRole('button', { name: 'Imprimir recibo del abono', exact: true }).last().click()
    await until(() => printLab.packets.length === count + 1, 'Recibo liquidado en TCP sintético')
    assert.match(printLab.packets.at(-1), /Importe recibido 116\.00/)
    assert.match(printLab.packets.at(-1), /Saldo 0\.00/)
    assert.deepEqual((await snapshot()).financial_orders[0], before)
  })
  await check('Corte X conserva el total liquidado mientras cocina sigue preparando', async () => {
    await pos2.page.goto(`${uiOrigin}/pos/corte`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos2)
    await expect(pos2.page.locator('dl').locator('div').filter({ hasText: 'Cobrado confirmado' })).toContainText(/174[.,]00/)
    await expect(pos2.page.locator('dl').locator('div').filter({ hasText: 'Efectivo esperado' })).toContainText(/674[.,]00/)
    assert.equal((await snapshot()).kds_orders.length,1)
    assert.ok((await snapshot()).turno, 'Consultar X no cierra el turno')
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
    for (let round = 0; round < 2; round++) {
      await card.first().getByRole('button', { name: /Todo listo/ }).click()
      await card.first().getByRole('button', { name: 'Entregar ronda', exact: true }).click()
    }
    await until(async () => (await snapshot()).kds_orders.length === 0, 'Ronda entregada por KDS real')
    assert.equal((await snapshot()).financial_orders[0].paid_cents, 17400)
  })
  await check('Retiros y depósitos autorizados desde POS 2 se incluyen en el cierre compartido', async () => {
    await pos2.page.goto(`${uiOrigin}/pos/turno`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos2)
    const movement = pos2.page.getByRole('region', { name: 'Movimientos de efectivo' })
    await expect(movement).toBeVisible()
    await movement.getByLabel('Importe del movimiento', { exact: true }).fill('20')
    await movement.getByLabel('Motivo del movimiento', { exact: true }).fill('Resguardo laboratorio')
    await movement.getByLabel('PIN de autorización', { exact: true }).fill(labPin)
    await movement.getByRole('button', { name: 'Confirmar movimiento' }).click()
    await expect(movement.getByRole('status')).toContainText('Movimiento confirmado')
    await movement.getByLabel('Tipo de movimiento', { exact: true }).selectOption('deposito')
    await movement.getByLabel('Importe del movimiento', { exact: true }).fill('5')
    await movement.getByLabel('Motivo del movimiento', { exact: true }).fill('Cambio laboratorio')
    await movement.getByLabel('PIN de autorización', { exact: true }).fill(labPin)
    await movement.getByRole('button', { name: 'Confirmar movimiento' }).click()
    await until(async () => (await snapshot()).cash_movements.length === 2, 'Dos movimientos durables')
    await pos2.page.goto(`${uiOrigin}/pos/corte`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(pos2)
    await expect(pos2.page.locator('dl').locator('div').filter({ hasText: 'Efectivo esperado' })).toContainText(/659[.,]00/)
  })
  await check('El cierre de turno concilia fondo, ventas, retiros y depósitos', async () => {
    await caja.page.goto(`${uiOrigin}/pos/turno`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(caja)
    await caja.page.getByLabel('Efectivo contado al cierre', { exact: true }).fill('659')
    await caja.page.getByRole('button', { name: 'Confirmar cierre de turno', exact: true }).click()
    await expect(caja.page.getByRole('region', { name: 'Último cierre confirmado' })).toBeVisible()
    const state = await snapshot()
    assert.equal(state.turno, null)
    assert.equal(state.turn_summaries[0].cash_sales_cents, 17400)
    assert.equal(state.turn_summaries[0].expected_cash_cents, 65900)
    assert.equal(state.turn_summaries[0].difference_cents, 0)
    await caja.page.screenshot({ path: path.join(output, 'cierre-turno-desde-pantalla.png'), fullPage: true })
    await caja.page.reload({ waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await ensureUnlocked(caja)
    await expect(caja.page.getByRole('region', { name: 'Último cierre confirmado' })).toContainText(/659[.,]00/)
  })
  await check('Eduardo: corte Z vacía los tres POS y el nuevo turno comienza en orden 1 conservando el cierre', async () => {
    for (const terminal of [caja, pos2, pos3]) {
      const state = await (await request(terminal, '/state')).json()
      assert.equal(state.salon_orders.length, 0)
      assert.equal(state.kds_orders.length, 0)
      await terminal.page.goto(`${uiOrigin}/pos/turno`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
      await ensureUnlocked(terminal)
      await expect(terminal.page.getByText('No hay turno abierto.', { exact: true })).toBeVisible()
    }
    await caja.page.getByLabel('Fondo inicial en efectivo', { exact: true }).fill('0')
    await caja.page.getByLabel('¿A dónde se fue (o de dónde salió) la diferencia?', { exact: true }).fill('Resguardo del efectivo después del corte de laboratorio')
    await caja.page.getByRole('button', { name: /Abrir turno/i }).click()
    await until(async () => (await snapshot()).turno !== null, 'Nuevo turno confirmado')
    await pos2.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await addCoffee(pos2)
    await pos2.page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await until(async () => (await snapshot()).salon_orders.length === 1, 'Primera cuenta del turno nuevo')
    const state = await snapshot()
    assert.equal(state.salon_orders[0].order_number, 1)
    assert.notEqual(state.salon_orders[0].id, orderId)
    assert.equal(state.turn_summaries[0].expected_cash_cents, 65900)
    for (const terminal of [pos2, pos3]) await until(async () => {
      const other = await (await request(terminal, '/state')).json()
      return other.salon_orders.length === 1 && other.salon_orders[0].id === state.salon_orders[0].id && other.salon_orders[0].order_number === 1
    }, 'Nueva cuenta idéntica en las terminales')
  })
  await check('Ninguna pantalla registra errores JavaScript durante el recorrido de botones', async () => {
    assert.deepEqual([pos2, pos3, kds].flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))), [])
  })
}
