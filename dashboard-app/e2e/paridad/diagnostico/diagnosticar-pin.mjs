// ¿Por qué no desbloquea el PIN, si Pedro contesta 200 a /auth/pin?
//
// El conductor encuentra y pulsa «Entrar» —eso ya está arreglado— y la pantalla
// sigue en el PIN. Hay tres explicaciones posibles y hay que separarlas en vez
// de elegir la más cómoda:
//
//   1. Los dígitos no se registran (el estado del componente no cambia).
//   2. Se registran, se envía la petición, y falla — por red, por credencial
//      de red local, o porque el navegador no lleva la identidad inyectada.
//   3. Se completa y la pantalla no reacciona.
//
// Se miran las tres: el estado visible, la consola y la red.

import { chromium } from 'playwright'

const nav = await chromium.connectOverCDP(process.env.FULLSITE_CDP || 'http://127.0.0.1:9224')
const ctx = nav.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]

const consola = []
const red = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consola.push(`${m.type()}: ${m.text().slice(0, 160)}`) })
page.on('requestfailed', r => red.push(`FALLÓ ${r.method()} ${r.url().slice(0, 90)} — ${r.failure()?.errorText}`))
page.on('response', async r => {
  const u = r.url()
  if (/auth\/pin|\/api\/pos\/|:7717/.test(u)) red.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 70)}`)
})

const mirar = () => page.evaluate(() => {
  const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
  const nombre = el => el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.innerText || '').trim()
  return {
    texto: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    puntos: document.querySelectorAll('.dots i.f, [class*=dot][class*=fill]').length,
    botones: [...document.querySelectorAll('button')].filter(vis)
      .map(b => `${nombre(b) || '(sin nombre)'}${b.disabled ? '[dis]' : ''}`),
    // La identidad inyectada: sin ella, bajo Caja el POS no puede hablar con Pedro.
    identidad: {
      clientId: !!localStorage.getItem('fullsite_client_id'),
      lan: !!localStorage.getItem('FULLSITE_LAN_SECRET'),
      bridge: localStorage.getItem('FULLSITE_BRIDGE_URL') || 'AUSENTE',
      terminal: !!localStorage.getItem('FULLSITE_TERMINAL_ID'),
    },
  }
})

console.log('═══ ANTES ═══')
const a = await mirar()
console.log('  texto    :', a.texto)
console.log('  identidad:', JSON.stringify(a.identidad))

console.log('\n═══ TECLEANDO 1-2-3-4 ═══')
for (const d of '1234') {
  await page.evaluate(x => {
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
    const b = [...document.querySelectorAll('button')].filter(vis).find(y => (y.innerText || '').trim() === x)
    if (b) b.click()
  }, d)
  await page.waitForTimeout(200)
}
const b = await mirar()
console.log('  puntos llenos:', b.puntos)
console.log('  botones      :', b.botones.join(' | '))

console.log('\n═══ PULSANDO «Entrar» ═══')
const pulsado = await page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const b = [...document.querySelectorAll('button')].filter(vis)
    .find(x => (x.getAttribute('aria-label') || '') === 'Entrar')
  if (!b) return 'no está'
  if (b.disabled) return 'deshabilitado'
  b.click()
  return 'pulsado'
})
console.log('  resultado:', pulsado)
await page.waitForTimeout(6000)

const c = await mirar()
console.log('\n═══ DESPUÉS ═══')
console.log('  texto:', c.texto)
console.log('  ¿sigue en el PIN?:', /Ingresa tu PIN/i.test(c.texto))

console.log('\n═══ RED ═══')
for (const r of red.slice(-10)) console.log('  ' + r)
if (!red.length) console.log('  (ninguna petición relevante — el clic no disparó nada)')

console.log('\n═══ CONSOLA ═══')
for (const m of consola.slice(-8)) console.log('  ' + m)
if (!consola.length) console.log('  (sin errores)')

await nav.close()
