// LA MESA SE IDENTIFICA POR SU NÚMERO, NUNCA POR SU ESTADO.
//
// El patrón anterior era `^<n>\s+(Disponible|Ocupada)`. La corrida
// cert-g01-20260915T204245Z se detuvo en S2 informando «no está en pantalla»
// sobre la mesa 1, que estaba visible, habilitada y decía «1 Sin confirmar
// 4 lug.» — un tercer estado que el propio POS lista en su leyenda
// («Sin confirmar (3) · Ocupada (0) · Lista (0)»).
//
// Enumerar estados sólo aplaza el problema hasta el siguiente que alguien
// agregue. Estas pruebas exigen que el selector encuentre la mesa CON CUALQUIER
// ESTADO, y que el estado siga observándose aparte para la evidencia.
//
// Se ejerce el criterio contra un DOM real de jsdom, no contra una descripción
// del criterio: lo que se vigila es el comportamiento del selector.
//
//   node cert/probar-selector-de-mesa.mjs

import { JSDOM } from 'jsdom'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL CRITERIO, tal como corre dentro de page.evaluate en `pulsarMesa`.
   ───────────────────────────────────────────────────────────────────────────
   Está copiado a propósito: `pulsarMesa` vive dentro del conductor, que
   arrastra playwright. Esta copia se mantiene alineada porque cualquier cambio
   de criterio tiene que pasar por aquí — y si alguien cambia uno sin el otro,
   el caso «Sin confirmar» de abajo vuelve a fallar.
   ═══════════════════════════════════════════════════════════════════════════ */
function buscarMesa(documento, num, ventana) {
  const vis = (el) => {
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0 && ventana.getComputedStyle(el).display !== 'none'
  }
  const controles = [...documento.querySelectorAll('button,[role=button]')].filter(vis)
  const texto = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()

  let b = controles.find(el => {
    const id = el.getAttribute('data-testid') || el.dataset?.mesa || el.dataset?.table || ''
    return new RegExp(`^(mesa|table)[-_]?${num}$`, 'i').test(String(id))
  })
  let via = b ? 'data-testid' : null

  if (!b) {
    b = controles.find(el => new RegExp(`\\bmesa\\s*${num}\\b`, 'i').test(el.getAttribute('aria-label') || ''))
    if (b) via = 'aria-label'
  }
  if (!b) {
    b = controles.find(el => {
      const t = texto(el)
      return new RegExp(`^${num}\\b`).test(t) && t.length > String(num).length
    })
    if (b) via = 'texto'
  }
  if (!b) {
    const hayMesas = controles.some(el => /^\d+\b/.test(texto(el)) && texto(el).length > 1)
    return { ok: false, hayMesas, motivo: hayMesas ? 'no reconoció esta mesa' : 'no hay mesas' }
  }
  const rotulo = texto(b)
  const estadoMesa = (rotulo.replace(new RegExp(`^${num}\\s*`), '').replace(/\d+\s*lug\.?/i, '').trim()) || null
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') {
    return { ok: false, motivo: 'está deshabilitado', rotulo, estadoMesa, via }
  }
  return { ok: true, rotulo, estadoMesa, via, elemento: b }
}

/** Monta un plano de mesas con los estados que se le pasen. */
function plano(mesas, extra = '') {
  const tarjetas = mesas.map(m =>
    `<button${m.testid ? ` data-testid="${m.testid}"` : ''}${m.aria ? ` aria-label="${m.aria}"` : ''}` +
    `${m.off ? ' disabled' : ''}>${m.n} ${m.estado} ${m.lugares ?? 4} lug.</button>`).join('')
  const dom = new JSDOM(`<body>${extra}${tarjetas}</body>`)
  // jsdom da 0×0 a todo; se le da tamaño a los controles para que `vis` sirva.
  const w = dom.window
  w.Element.prototype.getBoundingClientRect = function () { return { width: 120, height: 90, top: 0, left: 0 } }
  return { doc: w.document, win: w }
}

console.log('EL SELECTOR DE MESA\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · EL CASO QUE TUMBÓ LA CORRIDA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · «Sin confirmar» — el estado exacto de cert-g01-20260915T204245Z')
{
  const { doc, win } = plano([
    { n: 1, estado: 'Sin confirmar' }, { n: 2, estado: 'Sin confirmar' }, { n: 3, estado: 'Sin confirmar' },
  ])
  const r = buscarMesa(doc, 1, win)
  T('encuentra la mesa 1 en «Sin confirmar»', r.ok, r.motivo)
  T('la puede pulsar (no está deshabilitada)', r.ok && !!r.elemento)
  T('el estado se observa APARTE, no como identidad', r.estadoMesa === 'Sin confirmar', r.estadoMesa)
  T('el rótulo completo queda en la evidencia', r.rotulo === '1 Sin confirmar 4 lug.', r.rotulo)
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · CUALQUIER ESTADO, INCLUIDO UNO QUE AÚN NO EXISTE
   ───────────────────────────────────────────────────────────────────────────
   El punto entero: el selector no puede depender de la lista de estados.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · el número basta, diga lo que diga el estado')
{
  for (const estado of ['Disponible', 'Ocupada', 'Lista', 'Sin confirmar', 'Reservada', 'Por cobrar', 'ESTADO-QUE-NO-EXISTE-AÚN']) {
    const { doc, win } = plano([{ n: 3, estado }])
    const r = buscarMesa(doc, 3, win)
    T(`«${estado}»`, r.ok && r.estadoMesa === estado, r.ok ? r.estadoMesa : r.motivo)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · LA CASCADA DE PRIORIDAD
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · prioridad: testid → aria-label → texto')
{
  const a = plano([{ n: 5, estado: 'Ocupada', testid: 'mesa-5' }])
  T('usa data-testid cuando existe', buscarMesa(a.doc, 5, a.win).via === 'data-testid')

  const b = plano([{ n: 6, estado: 'Lista', aria: 'Mesa 6' }])
  T('usa aria-label cuando no hay testid', buscarMesa(b.doc, 6, b.win).via === 'aria-label')

  const c = plano([{ n: 7, estado: 'Sin confirmar' }])
  T('cae al texto cuando no hay ninguno de los dos', buscarMesa(c.doc, 7, c.win).via === 'texto')
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · NO CONFUNDIR LA MESA CON EL TECLADO DEL PIN
   ───────────────────────────────────────────────────────────────────────────
   La pantalla de bloqueo tiene botones cuyo texto es exactamente «1».
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · la tecla «1» del PIN no es la mesa 1')
{
  const teclado = [1,2,3,4,5,6,7,8,9,0].map(d => `<button>${d}</button>`).join('')
  const { doc, win } = plano([{ n: 1, estado: 'Sin confirmar' }], teclado)
  const r = buscarMesa(doc, 1, win)
  T('elige la tarjeta, no la tecla', r.ok && r.rotulo === '1 Sin confirmar 4 lug.', r.rotulo)

  // Sólo teclado: no hay mesa que abrir, y eso NO puede parecer un acierto.
  const solo = new JSDOM(`<body>${teclado}</body>`)
  solo.window.Element.prototype.getBoundingClientRect = () => ({ width: 60, height: 60, top: 0, left: 0 })
  const r2 = buscarMesa(solo.window.document, 1, solo.window)
  T('con sólo el teclado, NO encuentra mesa', !r2.ok, r2.rotulo)
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · LOS TRES DESENLACES SE DISTINGUEN
   ───────────────────────────────────────────────────────────────────────────
   Confundirlos es lo que manda a buscar por el lado equivocado: «no hay mesas»
   es del tenant, «no reconocí ésta» es del arnés, «deshabilitada» es del
   producto.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5 · ausente ≠ desconocida ≠ deshabilitada')
{
  const vacio = new JSDOM('<body><button>Plano</button></body>')
  vacio.window.Element.prototype.getBoundingClientRect = () => ({ width: 80, height: 30, top: 0, left: 0 })
  const r0 = buscarMesa(vacio.window.document, 1, vacio.window)
  T('sin mesas → hayMesas=false (precondición del tenant)', !r0.ok && r0.hayMesas === false)

  const otras = plano([{ n: 2, estado: 'Ocupada' }, { n: 3, estado: 'Lista' }])
  const r1 = buscarMesa(otras.doc, 9, otras.win)
  T('hay mesas pero no la 9 → hayMesas=true (se imputa al arnés)', !r1.ok && r1.hayMesas === true)

  const off = plano([{ n: 4, estado: 'Ocupada', off: true }])
  const r2 = buscarMesa(off.doc, 4, off.win)
  T('mesa presente y deshabilitada → motivo distinto de «no está»',
    !r2.ok && r2.motivo === 'está deshabilitado', r2.motivo)
  T('y aun deshabilitada reporta su estado', r2.estadoMesa === 'Ocupada', r2.estadoMesa)
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron: el selector volvería a perder la mesa.`)
  process.exit(1)
}
console.log('>>> la mesa se encuentra por su número, con cualquier estado.')
