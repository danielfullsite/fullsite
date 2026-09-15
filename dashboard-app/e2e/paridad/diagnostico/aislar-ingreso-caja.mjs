// La petición a Caja, hecha DESDE LA PÁGINA y con la misma forma que usa el POS.
//
// El manejador del PIN (pos/layout.tsx:573) llama a `ingresarConPinEnCaja` y
// muestra su `error.message` tal cual — de ahí sale «Caja no confirmó la
// sesión», que nace en `pedro-actor.ts:31` DESPUÉS del fetch. O sea que la
// petición sí sale y sí falla; el observador de red de Playwright no la vio,
// probablemente porque `localNetworkFetch` la marca con `targetAddressSpace` y
// Chromium la resuelve por otro camino.
//
// Aquí se repite exactamente, desde el contexto de la página, para ver el
// código y el cuerpo reales. Sin eso sólo hay conjeturas sobre por qué falla.

import { chromium } from 'playwright'

const nav = await chromium.connectOverCDP(process.env.FULLSITE_CDP || 'http://127.0.0.1:9224')
const ctx = nav.contexts()[0]
const page = ctx.pages().find(p => p.url().includes('/pos')) || ctx.pages()[0]

const r = await page.evaluate(async (pin) => {
  const base = localStorage.getItem('FULLSITE_BRIDGE_URL') || 'http://127.0.0.1:7717'
  const secreto = localStorage.getItem('FULLSITE_LAN_SECRET') || ''
  const terminal = localStorage.getItem('FULLSITE_TERMINAL_ID') || ''
  const cliente = localStorage.getItem('fullsite_client_id') || ''

  const intentar = async (etiqueta, opciones) => {
    try {
      const res = await fetch(`${base}/auth/pin`, opciones)
      const texto = await res.text()
      let cuerpo = texto
      try {
        const j = JSON.parse(texto)
        // Nunca se devuelve un token: sólo su presencia y tamaño.
        if (typeof j.shiftToken === 'string') j.shiftToken = `(${j.shiftToken.length} car.)`
        if (typeof j.actor_token === 'string') j.actor_token = `(${j.actor_token.length} car.)`
        if (j.staff) j.staff = { id: j.staff.id ? '(presente)' : null, role: j.staff.role ?? null }
        cuerpo = JSON.stringify(j)
      } catch {}
      return { etiqueta, estado: res.status, cuerpo: String(cuerpo).slice(0, 200) }
    } catch (e) {
      return { etiqueta, estado: 0, cuerpo: `${e.name}: ${e.message}`.slice(0, 200) }
    }
  }

  const cuerpoPin = JSON.stringify({ pin })

  return {
    contexto: { base, tieneSecreto: !!secreto, terminal: terminal.slice(0, 8) + '…', cliente },
    // 1 · Tal como lo manda `pedro-actor.ts`: sin cabeceras de identidad.
    comoElPos: await intentar('como lo manda el POS', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpoPin,
    }),
    // 2 · Con la credencial de red local a mano.
    conCredencial: await intentar('con x-fullsite-lan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fullsite-lan': secreto },
      body: cuerpoPin,
    }),
    // 3 · Con todo lo que la identidad inyectada ofrece.
    conTodo: await intentar('con credencial + terminal + restaurante', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-fullsite-lan': secreto,
        'x-fullsite-terminal': terminal, 'x-fullsite-restaurant': cliente,
      },
      body: cuerpoPin,
    }),
  }
}, process.env.FULLSITE_PIN || '1234')

console.log('contexto:', JSON.stringify(r.contexto))
for (const k of ['comoElPos', 'conCredencial', 'conTodo']) {
  console.log(`\n${r[k].etiqueta}`)
  console.log(`  HTTP ${r[k].estado}`)
  console.log(`  ${r[k].cuerpo}`)
}
await nav.close()
