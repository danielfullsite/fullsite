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

const VIEWPORTS = [[1600, 900], [1366, 768], [1280, 800], [1024, 768]]

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

  const medir = async (terminal, [w, h]) => {
    await terminal.app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h)
    }, { w, h })
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
      for (const digito of labPin) await terminal.page.getByRole('button', { name: digito, exact: true }).click()
      await entrar.click()
      await expect(entrar).not.toBeVisible({ timeout: 15000 })
      await terminal.page.waitForTimeout(1500)
    } catch (error) { fallos.push(`desbloqueo: ${error.message}`) }
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
      }))
      return { nombre, w, h, ...caja_, scrollVertical: caja_.alto > caja_.ventana + 1 }
    } catch (error) { fallos.push(`${nombre} ${w}x${h}: ${error.message}`); return null }
  }

  // ── Estado operativo: turno abierto y una cuenta con consumo enviado ────────
  await expect(caja.page.getByText('No hay turno abierto', { exact: true })).toBeVisible({ timeout: 60000 })
  await caja.page.getByRole('link', { name: 'Ir a abrir turno', exact: true }).click()
  await caja.page.getByLabel('Fondo inicial en efectivo', { exact: true }).fill('500')
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

    try {
      await caja.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
      await caja.page.waitForTimeout(700)
      medidas.push(await retratar(caja, 'catalogo', vp))
      // Este modal NO cierra con Escape (pos/page.tsx: sólo el telón y la «×» de
      // 40px). Se cierra como lo cierra un dedo: tocando el telón.
      await caja.page.locator('div.fixed.inset-0.z-50').first().click({ position: { x: 6, y: 6 } })
      await caja.page.waitForTimeout(600)
    } catch (error) { fallos.push(`catalogo ${vp.join('x')}: ${error.message}`) }

    try {
      await caja.page.getByRole('button', { name: 'Cobrar', exact: true }).click()
      await expect(caja.page.getByRole('dialog', { name: 'Cobro de la cuenta' })).toBeVisible({ timeout: 20000 })
      medidas.push(await retratar(caja, 'cobro', vp))
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
