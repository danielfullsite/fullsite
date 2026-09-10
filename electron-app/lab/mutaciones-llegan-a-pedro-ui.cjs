'use strict'

/**
 * Toda mutación de la cuenta tiene que llegar a Pedro — con los botones reales.
 *
 * Barrido del 2026-09-10, antes del instalador. En modo legacy (como se instala
 * AMALAY) anular la orden, cancelar un platillo, transferir un platillo,
 * transferir la mesa y fusionar mesas iban SOLO a la nube, y Pedro —de quien leen
 * el mapa y el editor bajo Electron— nunca se enteraba: la mesa anulada seguía
 * ocupada en las tres pantallas, la transferida se veía en la vieja. Ver
 * lib/aviso-lan.ts, `avisarCuentaActualizada`.
 *
 * Aquí se aprietan dos de esos botones —Transferir mesa y Anular orden— y se mira
 * el mapa de las tres pantallas y el /state de Caja. Cancelar platillo, transferir
 * platillo y fusionar quedan anclados por prueba de fuente
 * (toda-mutacion-avisa-a-pedro.test.ts); no los aprieta este laboratorio.
 *
 * Se llama desde laboratorio-ui-multiterminal.cjs después de los videos de
 * Eduardo (mesas 1 y 3 ya cobradas) y antes de que Caja se apague.
 */
module.exports = async function mutacionesLleganAPedro({ caja, pos2, pos3, check, expect, assert, until, request,
  command, esperarHidratacion, tenant, output, uiOrigin, turno, staff, path, randomUUID, setWan }) {
  const tile = (page, n) => page.locator('button')
    .filter({ has: page.locator('span.font-extrabold').filter({ hasText: new RegExp(`^${n}$`) }) }).first()
  const hidratado = locator => locator.evaluate(el => {
    const clave = Object.keys(el).find(k => k.startsWith('__reactProps'))
    return !!clave && typeof el[clave]?.onClick === 'function'
  }).catch(() => false)
  const irAlMapa = async terminal => {
    await terminal.page.goto(`${uiOrigin}/pos/mesas`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await esperarHidratacion(terminal.page)
    await expect(tile(terminal.page, 1)).toBeVisible({ timeout: 20000 })
  }
  const abrirMesa = async (terminal, n) => {
    await irAlMapa(terminal)
    const mesa = tile(terminal.page, n)
    await until(() => hidratado(mesa), `${terminal.name}: la mesa ${n} tiene su onClick colgado`, 20000)
    for (let intento = 1; ; intento++) {
      await mesa.click()
      try { await expect(terminal.page).toHaveURL(new RegExp(`/pos\\?mesa=${n}`), { timeout: 5000 }); break }
      catch (e) { if (intento >= 3) throw e }
    }
    await expect(terminal.page.locator('body')).not.toContainText('Confirmando cuenta con la caja', { timeout: 15000 })
  }
  const salon = async () => (await (await request(caja(), '/state')).json())
  const ordenesDeMesa = (snap, n) => snap.salon_orders.filter(o => Number(o.mesa) === n)
  const foto = (terminal, nombre) => terminal.page.screenshot({ path: path.join(output, `pedro-${nombre}-${terminal.name.replace(/\s+/g, '')}.png`), fullPage: true })
  const comanda = (id, mesa, items, total) => ({ order_id: id, mesa, mesero: staff.name, personas: 2, status: 'enviada',
    subtotal: total / 1.16, iva: total - total / 1.16, total, saldo: total, turno_id: turno.id, order_revision: 1,
    items: items.map((nombre, i) => ({ id: `${id}-r${i}`, nombre, cantidad: 1, precio: 50, subtotal: 50, precioExtra: 0,
      modificadores: [], notas: '', station: 'barra', menuItemId: 'lab-cafe' })) })

  // Material fresco: las mesas 1 y 3 ya se cobraron en los videos de Eduardo.
  const idMesa4 = randomUUID()
  const idMesa5 = randomUUID()
  await command(pos2, 'ORDER_SENT', comanda(idMesa4, 4, ['Café de laboratorio'], 58))
  await command(pos3, 'ORDER_SENT', comanda(idMesa5, 5, ['Café de laboratorio', 'Café de laboratorio'], 116))
  await until(async () => { const s = await salon(); return ordenesDeMesa(s, 4).length === 1 && ordenesDeMesa(s, 5).length === 1 },
    'Caja tiene las mesas 4 y 5')

  // ── Transferir mesa (con internet: la ruta legacy escribe en nube) ──────────
  setWan(true)
  try {
    await check('Mutaciones — «Transferir mesa» 4 → 7 desde POS 2 llega a Pedro: la 4 se libera y la 7 se ocupa en las tres pantallas', async () => {
      await abrirMesa(pos2, 4)
      await expect(pos2.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
      await pos2.page.getByTitle('Transferir mesa').click()
      await expect(pos2.page.locator('body')).toContainText('Transferir a mesa #:')
      await pos2.page.locator('input[type="number"][placeholder="#"]').fill('7')
      await pos2.page.getByRole('button', { name: 'Confirmar', exact: true }).click()
      await until(async () => {
        const s = await salon()
        return s.mesas?.['4']?.status === 'libre' && s.mesas?.['7']?.order_id === idMesa4 && ordenesDeMesa(s, 7).length === 1
      }, 'Caja movió la cuenta de la mesa 4 a la 7 al recibir el ORDER_UPSERTED')
      const movida = ordenesDeMesa(await salon(), 7)[0]
      assert.equal(Number(movida.total), 58, 'mover de mesa no toca el total')
      assert.equal(JSON.parse(movida.items).length, 1, 'mover de mesa no toca los platillos')
      for (const terminal of [caja(), pos2, pos3]) {
        await irAlMapa(terminal)
        await expect(tile(terminal.page, 4)).not.toContainText('$', { timeout: 15000 })
        await expect(tile(terminal.page, 7)).toContainText('$58.00', { timeout: 15000 })
        await foto(terminal, 'mapa-tras-transferir')
      }
    })

    // ── Anular orden ──────────────────────────────────────────────────────────
    // Dos fases a propósito. Con internet, el modal valida el PIN del gerente en
    // la nube y lo deja en caché 30 min; la escritura a la nube la rechaza el
    // laboratorio (503) y la anulación NO ocurre. Sin internet, el PIN sale del
    // caché, la anulación se encola offline y ES la que tiene que llegar a Pedro:
    // el caso de Eduardo, «anular con permiso» sin internet.
    await check('Mutaciones — «Anular orden» de la mesa 5 desde POS 3, sin internet, llega a Pedro: la mesa se libera en las tres pantallas', async () => {
      await abrirMesa(pos3, 5)
      await expect(pos3.page.locator('body')).toContainText(/116[.,]00/, { timeout: 20000 })
      await pos3.page.getByTitle('Anular orden').click()
      const modal = pos3.page.locator('div.fixed.inset-0').filter({ hasText: 'Anular orden completa' })
      await expect(modal).toBeVisible()
      await modal.locator('textarea').fill('Cliente se fue sin consumir (laboratorio)')
      await modal.locator('input[type="password"]').fill('2468')
      // Fase 1: con internet. El PIN se valida y se cachea; la nube del laboratorio
      // rechaza la escritura y la pantalla lo dice.
      await modal.getByRole('button', { name: 'Anular orden', exact: true }).click()
      await expect(pos3.page.locator('body')).toContainText('la orden NO se anuló', { timeout: 15000 })
      assert.equal(ordenesDeMesa(await salon(), 5).length, 1, 'premisa: con la escritura rechazada, nada cambia en Caja')
      // Fase 2: sin internet. PIN del caché, anulación encolada, aviso a Pedro.
      setWan(false)
      await modal.locator('input[type="password"]').fill('2468')
      await modal.getByRole('button', { name: 'Anular orden', exact: true }).click()
      await until(async () => {
        const s = await salon()
        return s.mesas?.['5']?.status === 'libre' && ordenesDeMesa(s, 5).length === 0
      }, 'Caja liberó la mesa 5 al recibir el ORDER_CANCELLED')
      await expect(pos3.page.locator('body')).not.toContainText('Café de laboratorio', { timeout: 15000 })
      for (const terminal of [caja(), pos2, pos3]) {
        await irAlMapa(terminal)
        await expect(tile(terminal.page, 5)).not.toContainText('$', { timeout: 15000 })
        await expect(tile(terminal.page, 5)).toContainText(/lug\./)
      }
      await foto(pos3, 'mapa-tras-anular')
    })
  } finally {
    setWan(false)
  }
}
