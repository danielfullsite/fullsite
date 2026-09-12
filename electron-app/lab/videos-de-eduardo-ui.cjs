'use strict'

/**
 * Los videos de Eduardo (AMALAY, 2026-08-24), reproducidos en la UI real.
 *
 * Eduardo grabó cuatro cosas con tres terminales y el internet caído:
 *
 *   1. «Por fuera» (el mapa) y «por dentro» (la cuenta abierta) no coinciden:
 *      684 afuera / 220 adentro; 393 adentro / 416 afuera; ceros en el mapa de
 *      la caja y platillos al abrir.
 *   2. Cuentas ya cobradas siguen apareciendo en el mapa.
 *   3. «Voy a pagar la cuenta. La cuenta se cobra correctamente. Aparecen ceros.
 *      Pero si vuelves a ingresar, hay un platillo. Y se puede volver a cobrar.»
 *   4. Cuentas con 90 pesos de chilaquiles no muestran nada al abrirlas desde
 *      otra terminal.
 *
 * Desde entonces cambió la arquitectura (365eaf22, a32b484a, 18eff681, e2e8f621):
 * mapa y editor leen del MISMO Pedro. Este archivo no confía en eso: aprieta los
 * botones que apretó Eduardo —Enviar, Cobrar, Efectivo, reabrir— en tres
 * procesos Electron reales sin internet, y mira el mapa de las tres pantallas.
 *
 * Lo que este archivo NO hace: certificar. La matriz pide ejecución física en
 * AMALAY con la huella, la impresora y el router de verdad. Esto mueve la
 * columna «probado», que es lo que una computadora puede mover.
 *
 * Se llama desde laboratorio-ui-multiterminal.cjs, en modo legacy (que es como
 * se instala AMALAY: `localAuthorityEnabled` apagado, ver
 * docs/offline/AMALAY-INSTALACION-CANDIDATO-2026-09-05.md §22), después de que
 * Caja se reinició y cocina marcó la comanda, y antes de que Caja se apague.
 */
module.exports = async function videosDeEduardo({ caja, pos2, pos3, kds, check, expect, assert, until, request,
  esperarHidratacion, tenant, output, uiOrigin, orderId, path }) {
  // El tile de una mesa en el mapa: el <button> cuyo número (span.font-extrabold,
  // mesas/page.tsx) es exactamente N. `.first()` porque la lista y el plano
  // comparten MesaCard y sólo uno está montado a la vez.
  const tile = (page, n) => page.locator('button')
    .filter({ has: page.locator('span.font-extrabold').filter({ hasText: new RegExp(`^${n}$`) }) }).first()
  // Tras cada `goto` se espera la hidratación (ver `esperarHidratacion` en el
  // laboratorio principal): el HTML que sirve Next es el escondite del PIN.
  const irAlMapa = async terminal => {
    await terminal.page.goto(`${uiOrigin}/pos/mesas`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await esperarHidratacion(terminal.page)
    try {
      await expect(tile(terminal.page, 1)).toBeVisible({ timeout: 20000 })
    } catch (e) {
      // Si el mapa no aparece, lo que importa es POR QUÉ: casi siempre es que la
      // terminal cayó al escondite del PIN. Se anota el estado de la sesión (sin
      // tokens ni PIN) para que la corrida siguiente no empiece de cero.
      const estado = await terminal.page.evaluate(() => {
        let actorExpira = null
        try { actorExpira = JSON.parse(sessionStorage.getItem('pos_actor_session') || 'null')?.expires_at ?? null } catch { actorExpira = 'ilegible' }
        return {
          url: location.href, escondite: document.body.innerText.includes('Ingresa tu PIN'),
          sessionKeys: Object.keys(sessionStorage), staff: !!sessionStorage.getItem('pos_staff'),
          lastActivity: sessionStorage.getItem('pos_last_activity'), actorExpira, ahora: Date.now(),
          cuerpo: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240),
        }
      }).catch(err => ({ evaluateError: String(err) }))
      throw new Error(`${terminal.name}: el mapa no mostró la mesa 1 — ${JSON.stringify(estado)}\n${e.message}`)
    }
  }
  // Next sirve el HTML del mapa antes de que React cuelgue los `onClick`: un clic
  // en ese hueco cae al vacío (la corrida 3 lo pagó: 32 lecturas de URL sin
  // cambio). Se espera el handler de verdad, igual que hace el recorrido de PIN.
  const hidratado = locator => locator.evaluate(el => {
    const clave = Object.keys(el).find(k => k.startsWith('__reactProps'))
    return !!clave && typeof el[clave]?.onClick === 'function'
  }).catch(() => false)
  const abrirMesa = async (terminal, n) => {
    await irAlMapa(terminal)
    const mesa = tile(terminal.page, n)
    await until(() => hidratado(mesa), `${terminal.name}: la mesa ${n} tiene su onClick colgado`, 20000)
    for (let intento = 1; ; intento++) {
      await mesa.click()
      try { await expect(terminal.page).toHaveURL(new RegExp(`/pos\\?mesa=${n}`), { timeout: 5000 }); break }
      catch (e) { if (intento >= 3) throw e }
    }
    // El lector de Caja sondea cada segundo; hasta que confirma, la pantalla dice
    // «Confirmando cuenta con la caja…». Se espera ESO, no un sleep.
    await expect(terminal.page.locator('body')).not.toContainText('Confirmando cuenta con la caja', { timeout: 15000 })
  }
  // El cobro en efectivo tal como lo hizo Eduardo: Cobrar → confirmar personas →
  // Efectivo → Exacto → Cobrar. Hay DOS botones «Efectivo» en el modal: el grande
  // (esmeralda) abre el flujo con cambio; el morado, de la lista de formas de
  // pago del catálogo, cobra directo. Eduardo usó el flujo con cambio: ése.
  const cobrarEnEfectivo = async terminal => {
    const cobrar = terminal.page.getByRole('button', { name: 'Cobrar', exact: true })
    await expect(cobrar).toBeEnabled({ timeout: 15000 })
    await cobrar.click()
    await terminal.page.getByRole('button', { name: 'Confirmar y cobrar' }).click()
    await terminal.page.locator('button.bg-emerald-600').filter({ hasText: 'Efectivo' }).click()
    await terminal.page.getByRole('button', { name: 'Exacto', exact: true }).click()
    await terminal.page.getByRole('button', { name: /^Cobrar — Cambio/ }).click()
  }
  const salon = async () => (await (await request(caja(), '/state')).json())
  const ordenDe = (snap, id) => snap.salon_orders.find(o => o.id === id || o.order_id === id)
  const ordenesDeMesa = (snap, n) => snap.salon_orders.filter(o => Number(o.mesa) === n)
  const foto = (terminal, nombre) => terminal.page.screenshot({ path: path.join(output, `eduardo-${nombre}-${terminal.name.replace(/\s+/g, '')}.png`), fullPage: true })

  // ── Video 1: por fuera y por dentro ─────────────────────────────────────────
  // Mesa 1 lleva $116.00 (ORDER_SENT sintético de POS 2), mesa 2 lleva $20.00
  // (por WebSocket), mesa 3 está libre. Las tres pantallas tienen que decir eso,
  // y ninguna puede pintar un «$0.00» —el cero era el síntoma de la caja.
  await check('Video de Eduardo 1 — el mapa dice lo mismo en Caja, POS 2 y POS 3, y nadie pinta ceros', async () => {
    for (const terminal of [caja(), pos2, pos3]) {
      await irAlMapa(terminal)
      await expect(tile(terminal.page, 1)).toContainText('$116.00', { timeout: 15000 })
      await expect(tile(terminal.page, 2)).toContainText('$20.00')
      await expect(tile(terminal.page, 3)).not.toContainText('$')
      for (const n of [1, 2, 3]) await expect(tile(terminal.page, n)).not.toContainText('$0.00')
      await foto(terminal, 'mapa-antes')
    }
  })
  await check('Video de Eduardo 1 — al abrir la mesa 1 en POS 3, «por dentro» es lo mismo que «por fuera»', async () => {
    await abrirMesa(pos3, 1)
    await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
    await expect(pos3.page.locator('body')).toContainText(/116[.,]00/)
    await foto(pos3, 'mesa1-por-dentro')
  })

  // ── Video 4 (y el cero de la caja): «Enviar» de verdad, sin internet ────────
  // El laboratorio original sembraba las comandas con comandos sintéticos que
  // traían total, saldo y revisión. Eduardo apretó el botón. Aquí se aprieta el
  // botón: si el payload real de ORDER_SENT no trae lo que el mapa necesita, el
  // mapa pinta $0.00 y «Cobrar» se apaga — y eso sólo se ve apretándolo.
  let ordenMesa3 = null
  await check('Video de Eduardo 4 — «Enviar» real desde POS 2 sin internet: Caja recibe la cuenta con total, saldo y revisión', async () => {
    await abrirMesa(pos2, 3)
    await pos2.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
    await pos2.page.getByRole('button', { name: /Café de laboratorio.*50/ }).click()
    await pos2.page.getByText('Caliente de laboratorio', { exact: true }).click()
    await pos2.page.getByRole('button', { name: /Agregar.*50/ }).click()
    const enviar = pos2.page.getByRole('button', { name: 'Enviar', exact: true })
    await expect(enviar).toBeEnabled({ timeout: 10000 })
    await enviar.click()
    await until(async () => ordenesDeMesa(await salon(), 3).length === 1, 'Caja registra la comanda real de la mesa 3')
    ordenMesa3 = ordenesDeMesa(await salon(), 3)[0]
    // $50 + 16% = $58. Sin nube, la revisión es CERO y no ausente (e2d4693a).
    assert.equal(Number(ordenMesa3.total), 58, `total en Caja: ${JSON.stringify(ordenMesa3)}`)
    assert.equal(Number(ordenMesa3.saldo), 58, `saldo en Caja: ${JSON.stringify(ordenMesa3)}`)
    assert.equal(ordenMesa3.order_revision, 0, `revisión en Caja: ${JSON.stringify(ordenMesa3)}`)
    const items = typeof ordenMesa3.items === 'string' ? JSON.parse(ordenMesa3.items) : ordenMesa3.items
    assert.equal(items?.length, 1, `platillos en Caja: ${JSON.stringify(ordenMesa3.items)}`)
    assert.equal(items[0].nombre, 'Café de laboratorio')
  })
  await check('Video de Eduardo 4 — esa cuenta se ve con $58.00 en el mapa de las tres terminales y llega a cocina', async () => {
    for (const terminal of [caja(), pos2, pos3]) {
      await irAlMapa(terminal)
      await expect(tile(terminal.page, 3)).toContainText('$58.00', { timeout: 15000 })
      await expect(tile(terminal.page, 3)).not.toContainText('$0.00')
    }
    // Dos comandas de café en cocina: la sintética (mesa 1) y la real (mesa 3).
    await expect(kds.page.locator('.card').filter({ hasText: 'Café de laboratorio' })).toHaveCount(2, { timeout: 15000 })
    await foto(kds, 'cocina-con-mesa3')
  })
  await check('Video de Eduardo 4 — POS 3 abre la mesa 3 que capturó POS 2 y ve el platillo, no una cuenta vacía', async () => {
    await abrirMesa(pos3, 3)
    await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
    await expect(pos3.page.locator('body')).toContainText(/58[.,]00/)
    await expect(pos3.page.getByRole('button', { name: 'Cobrar', exact: true })).toBeEnabled({ timeout: 15000 })
    await foto(pos3, 'mesa3-por-dentro')
  })

  // ── Video 3: cobrar sin internet, y lo que pasa después ─────────────────────
  await check('Video de Eduardo 3 — cobrar la mesa 1 en efectivo sin internet: Caja la libera y el POS no deja platillos', async () => {
    await abrirMesa(pos3, 1)
    await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
    await cobrarEnEfectivo(pos3)
    await until(async () => {
      const snap = await salon()
      return !ordenDe(snap, orderId) && snap.mesas?.['1']?.status === 'libre'
    }, 'Caja libera la mesa 1 al recibir ORDER_CLOSED')
    // Cobro sin nube: la orden se guarda en la cola, y la pantalla se vacía.
    await expect(pos3.page.locator('body')).not.toContainText('Café de laboratorio', { timeout: 15000 })
    await foto(pos3, 'mesa1-recien-cobrada')
  })
  await check('Video de Eduardo 2 — la mesa cobrada desaparece del mapa de las tres terminales (sin ceros)', async () => {
    for (const terminal of [caja(), pos2, pos3]) {
      await irAlMapa(terminal)
      await expect(tile(terminal.page, 1)).not.toContainText('$', { timeout: 15000 })
      await expect(tile(terminal.page, 1)).toContainText(/lug\./)
      // Las otras dos siguen donde estaban: liberar la 1 no toca a nadie más.
      await expect(tile(terminal.page, 2)).toContainText('$20.00')
      await expect(tile(terminal.page, 3)).toContainText('$58.00')
      await foto(terminal, 'mapa-despues-del-cobro')
    }
  })
  await check('Video de Eduardo 3 — reabrir la mesa cobrada desde POS 3 y desde POS 2: vacía, y «Cobrar» apagado', async () => {
    for (const terminal of [pos3, pos2]) {
      await abrirMesa(terminal, 1)
      await expect(terminal.page.locator('body')).not.toContainText('Café de laboratorio')
      await expect(terminal.page.locator('body')).not.toContainText(/116[.,]00/)
      // Con la cuenta vacía el POS ni siquiera pinta la barra de Enviar/Cobrar
      // (corrida 5: «Toca un producto para agregar», $0.00, sin botón). Lo que se
      // exige es que NO HAYA forma de cobrar: sin botón, o con el botón apagado.
      const cobrar = terminal.page.getByRole('button', { name: 'Cobrar', exact: true })
      if (await cobrar.count() > 0) await expect(cobrar).toBeDisabled()
      await expect(terminal.page.locator('body')).toContainText('Toca un producto para agregar')
      const cache = await terminal.page.evaluate(tenant =>
        JSON.parse(localStorage.getItem(`pos_cuenta_${tenant}_mesa:1`) || 'null'), tenant)
      assert(!cache?.confirmed?.id, `${terminal.name}: la identidad de la cuenta liquidada no sobrevive en caché (18eff681): ${JSON.stringify(cache)}`)
      await foto(terminal, 'mesa1-reabierta')
      // Salir con el botón real prueba el camino que usa el mesero: confirma el
      // UNLOCK con Caja antes del hard replace offline-safe hacia el mapa.
      await terminal.page.getByTitle('Volver al mapa de mesas', { exact: true }).click()
      await expect(terminal.page).toHaveURL(`${uiOrigin}/pos/mesas`, { timeout: 10000 })
      await until(async () => !(await salon()).locks?.['1'], `${terminal.name} libera la mesa 1 al salir`, 10000)
    }
  })
  await check('Video de Eduardo 3 — la cola de POS 3 tiene UN solo cierre de esa orden: no hay segundo cobro', async () => {
    const cierres = await pos3.page.evaluate(async orderId => {
      const db = await new Promise((ok, ko) => {
        const r = indexedDB.open('fullsite_pos'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error)
      })
      if (!db.objectStoreNames.contains('sync_queue')) return { total: 0, cierres: 0 }
      const rows = await new Promise((ok, ko) => {
        const r = db.transaction('sync_queue').objectStore('sync_queue').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error)
      })
      const mios = rows.filter(r => r.data?.order_id === orderId)
      return { total: mios.length, cierres: mios.filter(r => r.data?.status === 'cerrada').length }
    }, orderId)
    assert.equal(cierres.cierres, 1, `cierres encolados para la mesa 1: ${JSON.stringify(cierres)}`)
    // Y Caja conserva la orden como PAGADA, no la borra: el trabajo de cocina de
    // una cuenta cobrada antes de servir sobrevive (D2, ADR-005).
    const snap = await salon()
    const pagada = snap.kds_orders.find(o => o.id === orderId || o.order_id === orderId)
    assert(pagada, 'la comanda cobrada sigue en cocina hasta que se entregue')
    assert.equal(pagada.payment_status, 'pagada')
    assert.equal(Number(pagada.saldo), 0)
  })

  // ── Video 3, adversarial: el aviso de cierre se pierde ──────────────────────
  // Lo de arriba demuestra que el cobro funciona cuando el aviso ORDER_CLOSED llega.
  // Pero ese aviso es «dispara y olvida» con 1.2 s de tope (lib/aviso-lan.ts), y
  // Pedro NUNCA acepta la ausencia en nube como recibo de cierre (state.js,
  // _applyStateSync: una orden local no se toca por el poll). Si la LAN parpadea
  // justo al cobrar —o la caja acaba de cambiar de IP, T-09—, la caja se queda
  // creyendo que la mesa debe dinero. Eso es, palabra por palabra, el video:
  // «se cobra correctamente... si vuelves a ingresar, hay un platillo. Y se puede
  // volver a cobrar.»
  //
  // Aquí se pierde SÓLO ese aviso, se cobra la mesa 3 desde POS 3, y se exige que
  // cuando la LAN vuelva la caja se entere sola, sin que nadie toque nada.
  await check('Video de Eduardo 3, adversarial — si el aviso de cierre se pierde en la LAN, se reintenta hasta que Caja libera la mesa', async () => {
    const eventsDePos3 = `http://127.0.0.1:${pos3.port}/events`
    let perdidos = 0
    const perderElCierre = route => {
      const req = route.request()
      if (req.method() === 'POST' && (req.postData() || '').includes('"ORDER_CLOSED"')) { perdidos++; return route.abort('connectionfailed') }
      return route.fallback()
    }
    await pos3.page.route(eventsDePos3, perderElCierre)
    try {
      await abrirMesa(pos3, 3)
      await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
      await cobrarEnEfectivo(pos3)
      await until(() => perdidos >= 1, 'el aviso de cierre salió de la pantalla y se perdió en la LAN')
      // Mientras el aviso no llega, Caja sigue creyendo que la mesa 3 debe $58, y el
      // lector de un segundo vuelve a pintar el platillo en la pantalla que acaba de
      // cobrarlo. Ésa es la puerta del doble cobro; se registra como evidencia.
      const snap = await salon()
      assert.equal(ordenesDeMesa(snap, 3).length, 1, 'premisa: sin el aviso, Caja no sabe que se cobró')
      await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 10000 })
      await foto(pos3, 'mesa3-cobrada-con-aviso-perdido')
    } finally {
      await pos3.page.unroute(eventsDePos3, perderElCierre)
    }
    // La LAN vuelve. El aviso pendiente tiene que reintentarse SOLO.
    await until(async () => {
      const s = await salon()
      return ordenesDeMesa(s, 3).length === 0 && s.mesas?.['3']?.status === 'libre'
    }, `Caja libera la mesa 3 cuando el aviso pendiente se reintenta (avisos perdidos: ${perdidos})`, 30000)
    await expect(pos3.page.locator('body')).not.toContainText('Café de laboratorio', { timeout: 15000 })
    for (const terminal of [caja(), pos2, pos3]) {
      await irAlMapa(terminal)
      await expect(tile(terminal.page, 3)).not.toContainText('$', { timeout: 15000 })
      await expect(tile(terminal.page, 3)).toContainText(/lug\./)
    }
    await foto(pos3, 'mapa-tras-aviso-reintentado')
  })
}
