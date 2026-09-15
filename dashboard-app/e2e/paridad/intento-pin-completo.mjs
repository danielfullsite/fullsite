// El intento completo del PIN, medido por el ESTADO DE LOS CONTROLES.
//
// Corrección de método: la vez anterior conté «puntos llenos» con un selector
// (`.dots i.f`) que este paquete no usa, obtuve 0, y lo leí como «los dígitos no
// se registran». Falso: el botón Borrar se habilita con el primer dígito y el
// botón Entrar con el cuarto. Ésos son los indicadores reales, y los pone el
// propio componente.
//
// La diferencia importa: «no se registra» manda a arreglar el driver;
// «se registra y la petición falla» manda a mirar la autenticación.

import { chromium } from 'playwright'

const nav = await chromium.connectOverCDP(process.env.FULLSITE_CDP || 'http://127.0.0.1:9224')
const ctx = nav.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]

const red = []
page.on('response', r => {
  const u = r.url()
  if (/auth|pin|7717|\/api\//.test(u)) red.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}`)
})
page.on('requestfailed', r => red.push(`FALLÓ ${r.method()} ${r.url().slice(0, 70)} — ${r.failure()?.errorText}`))

const estado = () => page.evaluate(() => {
  const btn = n => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === n)
  const t = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
  return {
    borrar: btn('Borrar') ? !btn('Borrar').disabled : null,
    entrar: btn('Entrar') ? !btn('Entrar').disabled : null,
    enPin: /Ingresa tu PIN/i.test(t),
    aviso: (t.match(/Caja no confirmó[^]{0,40}|PIN incorrecto[^]{0,30}|sesión[^]{0,30}/i) || [])[0] || null,
    ruta: location.pathname,
  }
})

const limpiar = async () => {
  for (let i = 0; i < 6; i++) {
    const b = page.locator('button[aria-label="Borrar"]')
    if (await b.isEnabled().catch(() => false)) await b.click().catch(() => {}) ; else break
  }
  await page.waitForTimeout(250)
}

await limpiar()
console.log('inicio      :', JSON.stringify(await estado()))

for (const d of (process.env.FULLSITE_PIN || '1234').split('')) {
  await page.locator('button', { hasText: new RegExp(`^${d}$`) }).first().click().catch(() => {})
  await page.waitForTimeout(220)
  const e = await estado()
  console.log(`tras «${d}»   : borrar=${e.borrar} entrar=${e.entrar}`)
}

red.length = 0
console.log('\npulsando Entrar…')
await page.locator('button[aria-label="Entrar"]').click().catch(e => console.log('  error:', e.message.slice(0, 70)))
await page.waitForTimeout(8000)

const fin = await estado()
console.log('\ndespués     :', JSON.stringify(fin))
console.log('\nred durante el intento:')
for (const r of red.slice(0, 12)) console.log('  ' + r)
if (!red.length) console.log('  (ninguna — el manejador no llegó a pedir nada)')

console.log(fin.enPin
  ? '\n*** SIGUE EN EL PIN — no desbloqueó.'
  : `\n>>> DESBLOQUEÓ · ruta ${fin.ruta}`)
await nav.close()
