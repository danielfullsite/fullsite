// ¿Los botones del POS responden a un clic sintético, o exigen entrada REAL?
//
// El conductor pulsa con `elemento.click()` dentro de `page.evaluate`. Eso
// dispara un evento `click` no confiable y NO dispara la secuencia de puntero
// (pointerdown → pointerup → click) que sí produce un dedo o un ratón.
//
// El POS es una terminal TÁCTIL. Si sus botones escuchan `onPointerDown` —lo
// razonable para que respondan sin los 300 ms de retardo del táctil— entonces
// el clic sintético no los toca, y el arnés mediría una pantalla que nunca
// recibió la pulsación.
//
// Se comparan los tres caminos sobre el MISMO botón, contando los puntos del
// PIN después de cada uno.

import { chromium } from 'playwright'

const nav = await chromium.connectOverCDP(process.env.FULLSITE_CDP || 'http://127.0.0.1:9224')
const ctx = nav.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]

/** Cuántos dígitos lleva el PIN, contado de varias formas por si la clase cambió. */
const puntos = () => page.evaluate(() => {
  const llenos = document.querySelectorAll('.dots i.f').length
  const circulos = [...document.querySelectorAll('[class*=dot] i, .dots i')].length
  // Sin clases conocidas: el botón Borrar habilitado ya implica al menos un dígito.
  const borrar = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === 'Borrar')
  const entrar = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === 'Entrar')
  return { llenos, circulos, borrarActivo: borrar ? !borrar.disabled : null, entrarActivo: entrar ? !entrar.disabled : null }
})

const limpiar = async () => {
  const borrar = page.locator('button[aria-label="Borrar"]')
  for (let i = 0; i < 6; i++) { if (await borrar.isEnabled().catch(() => false)) await borrar.click().catch(() => {}) }
  await page.waitForTimeout(300)
}

console.log('estado inicial:', JSON.stringify(await puntos()))

// ── 1 · clic sintético dentro de evaluate (lo que hace el conductor hoy) ─────
await limpiar()
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '1')
  if (b) b.click()
})
await page.waitForTimeout(600)
console.log('1 · elemento.click() sintético :', JSON.stringify(await puntos()))

// ── 2 · clic REAL de Playwright (pointerdown → pointerup → click) ────────────
await limpiar()
await page.locator('button', { hasText: /^2$/ }).first().click().catch(e => console.log('   error:', e.message.slice(0, 60)))
await page.waitForTimeout(600)
console.log('2 · locator.click() real        :', JSON.stringify(await puntos()))

// ── 3 · toque táctil explícito ──────────────────────────────────────────────
await limpiar()
try {
  const caja = await page.locator('button', { hasText: /^3$/ }).first().boundingBox()
  if (caja) {
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2)
    await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up()
  }
} catch (e) { console.log('   error:', e.message.slice(0, 60)) }
await page.waitForTimeout(600)
console.log('3 · mouse.down/up explícito     :', JSON.stringify(await puntos()))

// ── ¿Qué escucha realmente el botón? ────────────────────────────────────────
const oyentes = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '1')
  if (!b) return null
  // React no expone sus manejadores; se buscan las props del fiber, que es lo
  // único que dice si escucha click o pointerdown.
  const clave = Object.keys(b).find(k => k.startsWith('__reactProps'))
  if (!clave) return { fiber: false }
  return { fiber: true, props: Object.keys(b[clave]).filter(k => k.startsWith('on')) }
})
console.log('\noyentes del botón «1»:', JSON.stringify(oyentes))

await limpiar()
await nav.close()
