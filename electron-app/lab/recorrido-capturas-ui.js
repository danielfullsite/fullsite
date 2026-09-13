'use strict'
// CAPTURAS REALES DE LAS PANTALLAS OPERATIVAS, A LOS CUATRO TAMAÑOS DE CAJA.
//
// No es una prueba: no afirma nada y no falla el laboratorio. Existe para poder
// comparar «antes» y «después» del trabajo táctil sobre la misma operación, el
// mismo catálogo y la misma cuenta — no con dos capturas de estados distintos.
//
// Se enchufa en el mismo arnés que `recorrido-operacional-ui.js`:
//   FULLSITE_LAB_RECORRIDO=./recorrido-capturas-ui FULLSITE_LAB_OPERATIONAL=1 \
//   FULLSITE_LAB_ETIQUETA=antes node lab/laboratorio-ui-multiterminal.cjs
//
// Las medidas son las de las tabletas y cajas que se usan en piso. La peor es
// 1024×768: ahí se decide si algo cabe. Junto a cada PNG se guarda cuánto mide
// el documento contra la ventana, que es el dato que dice si hay scroll.
const path = require('node:path')
const fs = require('node:fs')

const VIEWPORTS = (() => {
  if (!process.env.FULLSITE_LAB_VIEWPORT) return [[1600, 900], [1366, 768], [1280, 800], [1024, 768]]
  const size = process.env.FULLSITE_LAB_VIEWPORT.split('x').map(Number)
  if (size.length !== 2 || size.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('FULLSITE_LAB_VIEWPORT debe usar el formato 1024x768')
  }
  return [size]
})()

module.exports = async function ({ caja, pos2, kds, expect, until, request, output, uiOrigin, labPin }) {
  const etiqueta = process.env.FULLSITE_LAB_ETIQUETA || 'captura'
  const destino = path.join(output, 'capturas', etiqueta)
  fs.mkdirSync(destino, { recursive: true })
  // Next en desarrollo compila la ruta la primera vez que alguien la pide: en
  // este mismo worktree /pos/corte tardó 159s en frío. El presupuesto de
  // navegación tiene que cubrir eso o el retrato muere antes de empezar.
  const navigationTimeout = 300000
  const snapshot = async () => (await request(caja, '/state')).json()
  const fallos = []
  const escribirConTecladoTactil = async (terminal, locator, valor) => {
    const handle = await locator.elementHandle()
    if (!handle) throw new Error(`No se encontró el campo táctil para «${valor}»`)
    await locator.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
    const teclado = terminal.page.getByRole('dialog', { name: /Teclado en pantalla para/ })
    await expect(teclado).toBeVisible()
    await teclado.getByRole('button', { name: 'Limpiar', exact: true }).click()
    for (const caracter of valor) await teclado.getByRole('button', { name: `Escribir ${caracter}`, exact: true }).click()
    await teclado.getByRole('button', { name: 'Listo', exact: true }).click()
    const escrito = await handle.inputValue()
    if (escrito !== valor) throw new Error(`El teclado escribió «${escrito}» en vez de «${valor}»`)
  }

  const medir = async (terminal, [w, h]) => {
    // Next puede terminar una navegación justo cuando Playwright entra al proceso
    // principal. Ese cambio destruye el contexto, no la ventana: se reintenta sólo
    // ese caso transitorio y cualquier otro error sigue abortando el retrato.
    for (let intento = 0; intento < 3; intento++) {
      try {
        await terminal.app.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h)
        }, { w, h })
        break
      } catch (error) {
        if (!/Execution context was destroyed/.test(error.message) || intento === 2) throw error
        await terminal.page.waitForTimeout(750)
      }
    }
    await terminal.page.waitForTimeout(500)
  }
  // El POS se bloquea solo por inactividad, y este recorrido pasa minutos sin
  // tocar nada entre pantalla y pantalla: sin esto, media sesión de capturas
  // sale con el teclado de PIN en vez de la pantalla que se quería retratar.
  // Es exactamente lo que haría una persona operando: la mano en la pantalla.
  // Y cuando ya se bloqueó, marcar actividad no sirve: la pantalla borró la
  // sesión. Entonces hay que entrar como entra el cajero, tecleando el PIN.
  const despertar = async terminal => {
    try { await terminal.page.evaluate(() => sessionStorage.setItem('pos_last_activity', String(Date.now()))) } catch {}
    const entrar = terminal.page.getByRole('button', { name: 'Entrar', exact: true })
    try {
      if (!await entrar.isVisible()) return
      // Al navegar, el shell bloqueado aparece un instante antes de restaurar la
      // sesión. Esperar evita teclear medio PIN sobre un componente que React está
      // desmontando y reportar un falso fallo con el botón Entrar deshabilitado.
      await terminal.page.waitForTimeout(1000)
      if (!await entrar.isVisible()) return
      const borrar = terminal.page.getByRole('button', { name: 'Borrar', exact: true })
      while (await borrar.isVisible() && await borrar.isEnabled()) await borrar.click()
      for (const digito of labPin) {
        if (!await entrar.isVisible()) return
        await terminal.page.getByRole('button', { name: digito, exact: true }).click()
      }
      if (!await entrar.isVisible()) return
      await expect(entrar).toBeEnabled({ timeout: 5000 })
      await entrar.click()
      await expect(entrar).not.toBeVisible({ timeout: 15000 })
      await terminal.page.waitForTimeout(1500)
    } catch (error) {
      // Si el teclado ya no existe, la restauración ganó la carrera y logró
      // exactamente el estado buscado: POS desbloqueado. El texto concreto del
      // error de Playwright cambia según en qué dígito ocurrió el desmontaje.
      const sesionRestaurada = !await entrar.isVisible().catch(() => false)
      if (!sesionRestaurada) fallos.push(`desbloqueo: ${error.message}`)
    }
  }
  const retratar = async (terminal, nombre, [w, h]) => {
    try {
      await despertar(terminal)
      await terminal.page.screenshot({ path: path.join(destino, `${w}x${h}-${nombre}.png`) })
      const caja_ = await terminal.page.evaluate(() => ({
        alto: document.documentElement.scrollHeight,
        ventana: window.innerHeight,
        anchoDoc: document.documentElement.scrollWidth,
        anchoVentana: window.innerWidth,
        // Contenedores internos que hoy hacen scroll, que es donde se esconde
        // lo que el dedo no encuentra.
        internos: [...document.querySelectorAll('*')]
          .filter(el => el.scrollHeight > el.clientHeight + 8 && getComputedStyle(el).overflowY.match(/auto|scroll/))
          .map(el => ({ clase: (el.className || '').toString().slice(0, 60), alto: el.scrollHeight, visible: el.clientHeight }))
          .slice(0, 8),
        dialogo: (() => {
          const dialog = document.querySelector('[data-teclado-tactil-panel]') || document.querySelector('[role="dialog"]')
          if (!dialog) return null
          const panel = dialog.firstElementChild
          const controlesMenores56 = [...dialog.querySelectorAll('button,input,select')]
            .filter(el => {
              const rect = el.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 && rect.height < 55.5
            })
            .map(el => ({ nombre: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 60) || el.tagName, alto: el.getBoundingClientRect().height }))
          return {
            alto: panel?.getBoundingClientRect().height ?? 0,
            visible: window.innerHeight,
            scroll: panel ? panel.scrollHeight > panel.clientHeight + 1 : false,
            controlesMenores56,
          }
        })(),
      }))
      return { nombre, w, h, ...caja_, scrollVertical: caja_.alto > caja_.ventana + 1 }
    } catch (error) { fallos.push(`${nombre} ${w}x${h}: ${error.message}`); return null }
  }

  // ── Estado operativo: turno abierto y una cuenta con consumo enviado ────────
  await expect(caja.page.getByText('No hay turno abierto', { exact: true })).toBeVisible({ timeout: 60000 })
  await caja.page.getByRole('link', { name: 'Ir a abrir turno', exact: true }).click()
  await escribirConTecladoTactil(caja, caja.page.getByLabel('Fondo inicial en efectivo', { exact: true }), '500')
  await caja.page.getByRole('button', { name: /Abrir turno/i }).click()
  await until(async () => (await snapshot()).turno?.opening_cash_cents === 50000, 'Turno durable desde UI')
  for (const t of [caja, pos2]) await t.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
  await expect(caja.page.getByRole('button', { name: /Bebidas laboratorio/ })).toBeVisible({ timeout: 120000 })
  // Diez renglones, no tres: una comanda de mesa real desborda la lista, y eso es
  // justo lo que hay que poder ver en la captura.
  for (let i = 0; i < 10; i++) {
    await caja.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
    await caja.page.getByRole('button', { name: /Café de laboratorio.*50/ }).click()
    await caja.page.locator('label').getByText('Caliente de laboratorio', { exact: true }).click()
    await caja.page.getByRole('button', { name: /Agregar.*50/ }).click()
  }
  // Ver el comentario de `enviarACocina` en recorrido-operacional-ui.js: en
  // desarrollo el distintivo de Next se para sobre el centro de este botón.
  await caja.page.getByRole('button', { name: 'Enviar', exact: true }).click({ position: { x: 140, y: 20 } })
  await until(async () => (await snapshot()).kds_orders.length === 1, 'Ronda en cocina para el KDS')

  // ── Recorrido de capturas ──────────────────────────────────────────────────
  const medidas = []
  for (const vp of VIEWPORTS) {
    await despertar(caja)
    await medir(caja, vp)
    await medir(kds, vp)

    await caja.page.goto(`${uiOrigin}/pos/mesas`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await despertar(caja)
    await caja.page.waitForTimeout(2500)
    medidas.push(await retratar(caja, 'mesas', vp))

    await caja.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
    await despertar(caja)
    await expect(caja.page.getByRole('button', { name: /Bebidas laboratorio/ })).toBeVisible({ timeout: 120000 })
    medidas.push(await retratar(caja, 'comanda', vp))
    medidas.push(await retratar(caja, 'categorias', vp))

    try {
      const buscador = caja.page.getByPlaceholder('Buscar platillo...', { exact: true })
      await buscador.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
      const teclado = caja.page.getByRole('dialog', { name: /Teclado en pantalla para/ })
      await expect(teclado).toBeVisible()
      medidas.push(await retratar(caja, 'teclado-texto', vp))
      await teclado.getByRole('button', { name: 'Cancelar', exact: true }).click()
    } catch (error) { fallos.push(`teclado texto ${vp.join('x')}: ${error.message}`) }

    try {
      // El fixture de laboratorio tiene un solo café; el demo añade categorías
      // de veinte platillos. Retratar una de éstas comprueba densidad y paginación
      // reales en vez de validar sólo el estado vacío.
      const categoriaConVolumen = caja.page.getByRole('button', { name: /Cervezas/ })
      const categoria = await categoriaConVolumen.isVisible()
        ? categoriaConVolumen
        : caja.page.getByRole('button', { name: /Bebidas laboratorio/ })
      await categoria.click()
      await caja.page.waitForTimeout(700)
      medidas.push(await retratar(caja, 'catalogo', vp))
      // Escape es una salida real además del botón Cerrar de 56px. Si no funciona,
      // el siguiente retrato deja evidencia del modal atorado sobre la operación.
      await caja.page.keyboard.press('Escape')
      await expect(caja.page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })
      await caja.page.waitForTimeout(600)
    } catch (error) { fallos.push(`catalogo ${vp.join('x')}: ${error.message}`) }

    try {
      await caja.page.getByRole('button', { name: 'Cobrar', exact: true }).click()
      await expect(caja.page.getByRole('dialog', { name: 'Cobro de la cuenta' })).toBeVisible({ timeout: 20000 })
      medidas.push(await retratar(caja, 'cobro', vp))
      const preparar = caja.page.getByRole('button', { name: 'Preparar cuenta para cobrar', exact: true })
      if (await preparar.isVisible().catch(() => false)) {
        await preparar.click()
        await expect(caja.page.getByRole('tab', { name: /Efectivo/ })).toBeVisible({ timeout: 20000 })
      }
      for (const [pestana, nombre] of [['Efectivo', 'cobro-efectivo'], ['Tarjeta', 'cobro-tarjeta'], ['Por confirmar', 'cobro-por-confirmar'], ['Cobrados', 'cobro-cobrados']]) {
        await caja.page.getByRole('tab', { name: new RegExp(`^${pestana}`) }).click()
        await caja.page.waitForTimeout(200)
        medidas.push(await retratar(caja, nombre, vp))
      }
      await caja.page.getByRole('tab', { name: /^Efectivo/ }).click()
      const importe = caja.page.getByLabel('Importe a cobrar', { exact: true })
      await importe.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
      const teclado = caja.page.getByRole('dialog', { name: /Teclado en pantalla para/ })
      await expect(teclado).toBeVisible()
      medidas.push(await retratar(caja, 'teclado-decimal', vp))
      await teclado.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await caja.page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await caja.page.waitForTimeout(400)
    } catch (error) { fallos.push(`cobro ${vp.join('x')}: ${error.message}`) }

    for (const [ruta, nombre] of [['/pos/turno', 'turno'], ['/pos/corte', 'corte']]) {
      try {
        await caja.page.goto(`${uiOrigin}${ruta}`, { waitUntil: 'domcontentloaded', timeout: navigationTimeout })
        await despertar(caja)
        await caja.page.waitForTimeout(3000)
        medidas.push(await retratar(caja, nombre, vp))
      } catch (error) { fallos.push(`${nombre} ${vp.join('x')}: ${error.message}`) }
    }

    try {
      await kds.page.waitForTimeout(1500)
      medidas.push(await retratar(kds, 'kds', vp))
    } catch (error) { fallos.push(`kds ${vp.join('x')}: ${error.message}`) }
  }

  const resumen = medidas.filter(Boolean)
  fs.writeFileSync(path.join(destino, 'medidas.json'), JSON.stringify({ etiqueta, medidas: resumen, fallos }, null, 2))
  const conScroll = resumen.filter(m => m.scrollVertical)
  console.log(`Capturas «${etiqueta}» en ${destino}`)
  console.log(`${resumen.length} pantallas retratadas · ${conScroll.length} con scroll de página`)
  for (const m of conScroll) console.log(`  SCROLL ${m.nombre} ${m.w}x${m.h}: documento ${m.alto}px en ventana de ${m.ventana}px`)
  for (const f of fallos) console.log(`  FALLO ${f}`)
}
