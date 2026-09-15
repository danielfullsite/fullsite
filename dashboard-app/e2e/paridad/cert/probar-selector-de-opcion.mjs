// NO TODO LO QUE SE TOCA ES UN <button>.
//
// El selector genérico busca en `button,[role=button]`. Con eso alcanza para
// categorías, productos y botones de acción, pero NO para las opciones de un
// grupo de modificadores: `pos/page.tsx:527` las dibuja como <label> con un
// <input type="checkbox"> en `sr-only` — accesible y correcto, e invisible para
// aquel selector.
//
// Medido en cert-g01-20260915T205037Z: el modal abierto, «Obligatorio», «Max 1»
// y el botón bloqueado en «Elige CERT-G01-OPCION» —el producto cumpliendo la
// ley— y el conductor informando que CERT-G01-ESTANDAR «no está en pantalla».
//
//   node cert/probar-selector-de-opcion.mjs

import { JSDOM } from 'jsdom'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/** El criterio de `pulsarOpcion`, ejercido contra un DOM real. */
function buscarOpcion(doc, win, texto) {
  const vis = (el) => {
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0 && win.getComputedStyle(el).display !== 'none'
  }
  const re = new RegExp(texto, 'i')
  const candidatos = [...doc.querySelectorAll(
    'label,[role=option],[role=radio],[role=checkbox],[role=menuitemradio],button,[role=button]')].filter(vis)
  const nombre = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()

  const el = candidatos.find(x => re.test(nombre(x)))
  if (!el) return { ok: false, motivo: 'no está en pantalla', enPantalla: candidatos.map(nombre).slice(0, 10) }
  const rotulo = nombre(el)
  const dentro = el.querySelector('input,[role=radio],[role=checkbox]')
  const bloqueado = el.getAttribute('aria-disabled') === 'true' || el.disabled === true || (dentro && dentro.disabled === true)
  if (bloqueado) return { ok: false, motivo: 'está deshabilitado', rotulo, controlPresente: true }
  el.click()
  const marcado = dentro ? (dentro.checked === true || dentro.getAttribute('aria-checked') === 'true') : null
  return { ok: true, rotulo, marcado, etiquetaHTML: el.tagName.toLowerCase() }
}

/** El modal tal como lo dibuja el POS: <label> + <input class="sr-only">. */
function modal({ opcion = 'CERT-G01-ESTANDAR', off = false, marcado = false } = {}) {
  const dom = new JSDOM(`<body>
    <div>
      <h3>CERT-G01-OPCION (1/1)</h3>
      <label class="tarjeta">
        <input type="checkbox" class="sr-only"${off ? ' disabled' : ''}${marcado ? ' checked' : ''}>
        <div class="marca"></div>
        <span>${opcion}</span><span>Gratis</span>
      </label>
    </div>
    <button>Cancelar</button>
    <button disabled>Elige CERT-G01-OPCION</button>
  </body>`)
  const w = dom.window
  w.Element.prototype.getBoundingClientRect = function () { return { width: 200, height: 60, top: 0, left: 0 } }
  // `sr-only` esconde visualmente el input, pero el <label> sigue siendo visible.
  return { doc: w.document, win: w }
}

console.log('EL SELECTOR DE OPCIÓN DE MODIFICADOR\n' + '═'.repeat(68))

console.log('\n1 · el caso exacto de cert-g01-20260915T205037Z')
{
  const { doc, win } = modal()
  const r = buscarOpcion(doc, win, 'CERT\\-G01\\-ESTANDAR')
  T('encuentra la opción aunque sea un <label>, no un <button>', r.ok, r.motivo)
  T('el elemento pulsado es el <label>', r.etiquetaHTML === 'label', r.etiquetaHTML)
  T('al pulsarlo, el input queda marcado', r.marcado === true, String(r.marcado))
}

console.log('\n2 · el selector viejo NO podía encontrarla (la regresión)')
{
  const { doc, win } = modal()
  const soloBotones = [...doc.querySelectorAll('button,[role=button]')]
    .map(b => (b.textContent || '').trim())
  T('entre los <button> no está la opción',
    !soloBotones.some(t => /CERT-G01-ESTANDAR/.test(t)), soloBotones.join(' | '))
  T('y sí están Cancelar y el botón bloqueado',
    soloBotones.some(t => /Cancelar/.test(t)) && soloBotones.some(t => /^Elige /.test(t)))
}

console.log('\n3 · una opción bloqueada por el producto NO se confunde con ausente')
{
  const { doc, win } = modal({ off: true })
  const r = buscarOpcion(doc, win, 'CERT\\-G01\\-ESTANDAR')
  T('reporta «está deshabilitado», no «no está en pantalla»', r.motivo === 'está deshabilitado', r.motivo)
  T('marca controlPresente para que se impute al producto', r.controlPresente === true)
}

console.log('\n4 · sigue funcionando con otras formas de opción')
{
  for (const [etiqueta, html] of [
    ['role=radio',       '<div role="radio" aria-checked="false">CERT-G01-ESTANDAR</div>'],
    ['role=option',      '<div role="option">CERT-G01-ESTANDAR</div>'],
    ['button (si algún día lo es)', '<button>CERT-G01-ESTANDAR Gratis</button>'],
  ]) {
    const dom = new JSDOM(`<body>${html}</body>`)
    dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 60, top: 0, left: 0 })
    const r = buscarOpcion(dom.window.document, dom.window, 'CERT\\-G01\\-ESTANDAR')
    T(etiqueta, r.ok, r.motivo)
  }
}

console.log('\n5 · si de verdad no está, lo dice')
{
  const dom = new JSDOM('<body><button>Cancelar</button></body>')
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, left: 0 })
  const r = buscarOpcion(dom.window.document, dom.window, 'CERT\\-G01\\-ESTANDAR')
  T('opción ausente → no está en pantalla', !r.ok && r.motivo === 'no está en pantalla')
  T('y lista lo que sí había', Array.isArray(r.enPantalla) && r.enPantalla.includes('Cancelar'))
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron: el conductor volvería a perder la opción.`)
  process.exit(1)
}
console.log('>>> las opciones se pulsan aunque no sean botones.')
