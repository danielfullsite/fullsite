/**
 * El observador del MAIN, probado sin Electron.
 *
 * Lo que se prueba aquí es lo que decidió el veredicto de
 * cert-g01-20260917T180532Z: que M1, M2 y M3 tengan DÓNDE morder. Un arnés que
 * no captura el save-order los declara «no aplicable» y se queda en 2/5 para
 * siempre — verde por ceguera, que es peor que rojo.
 *
 *   node cert/probar-observador-main.mjs
 */
import { normalizarSaveOrder, fusionarApiWrites, clave, llavesCrudas } from './observador-main.mjs'
import { MUTACIONES } from '../manifiesto-de-efectos.mjs'

let fallas = 0
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  · ${nombre}`) }
  catch (e) { fallas++; console.log(`  ✗ ${nombre}\n      ${e.message}`) }
}
const afirmar = (cond, msg) => { if (!cond) throw new Error(msg) }
const mut = (id) => MUTACIONES.find(m => m.id === id)

/* El cuerpo REAL de un save-order del laboratorio, copiado de la captura del
   MAIN en m3v2-20260917T173218Z. No es una maqueta inventada: son los nombres
   que el producto usa. */
const CUERPO_REAL = JSON.stringify({
  order_id: '9be354d1-93f7-4778-8a70-3b5aef090174',
  save_operation_id: '308939a2-c802-4ebd-b844-889c0e109b1c',
  client_id: 'fullsite-cert-lab-v2', mesa: 1, mesero: 'CERT-GERENTE', status: 'enviada',
  turno_id: 'mu5pkd38aobe', subtotal: 100, iva: 16, total: 116,
  items: [{
    id: 'b27ccaa9-8555-4145-ad0c-f918dd55050b', menuItemId: 'cert-g01-plato',
    nombre: 'CERT-G01-PLATO', precio: 100, cantidad: 1,
    modificadores: ['CERT-G01-ESTANDAR'], modifier_ids: ['cert-g01-estandar'],
    notas: '', precioExtra: 0, subtotal: 100, silla: 1, station: 'cocina',
    courseId: 1, courseStatus: 'pending',
    comanda_batch_id: '0b78306d-5838-47c8-81c1-dbabd4fdcee8', comanda_batch_seq: 0,
  }],
})
const entradaReal = () => normalizarSaveOrder({
  metodo: 'POST', url: 'https://app.fullsite.mx/api/pos/save-order', cuerpoTexto: CUERPO_REAL })

/** Un manifiesto mínimo con el save-order ya fundido, como lo verá el certificador. */
const manifiestoCon = (write) => ({
  api_writes: write ? [write] : [], kds_events: [], audit_events: [], sync_queue: [],
  local_db_writes: [{ store: 'orders', op: 'put' }], pedro_events: [], print_jobs: [],
  drawer_ops: [], order_state: [], table_state: [], sandbox_writes: [], sandbox_violations: [],
})

console.log('EL OBSERVADOR DEL MAIN')
console.log('═'.repeat(66))

/* ── 1 · M1 tiene dónde morder ───────────────────────────────────────────── */
prueba('1 · save-order con cantidad → M1.aplicar() no es null', () => {
  const m = manifiestoCon(entradaReal())
  const r = mut('M1').aplicar(m)
  afirmar(r !== null, 'M1 sigue devolviendo null: la categoría no llegó normalizada')
  afirmar(r.api_writes[0].items[0].q === 2, `M1 debía dejar q=2, dejó ${r.api_writes[0].items[0].q}`)
})

/* ── 2 · M2 tiene dónde morder ───────────────────────────────────────────── */
prueba('2 · modificador obligatorio presente → M2.aplicar() no es null', () => {
  const m = manifiestoCon(entradaReal())
  const r = mut('M2').aplicar(m)
  afirmar(r !== null, 'M2 devolvió null: los modificadores no llegaron al canónico')
  afirmar(r.api_writes[0].items[0].mods.length === 0, 'M2 debía vaciar mods')
})

/* ── 3 · M3 tiene dónde morder ───────────────────────────────────────────── */
prueba('3 · station cocina → M3.aplicar() no es null', () => {
  const m = manifiestoCon(entradaReal())
  const r = mut('M3').aplicar(m)
  afirmar(r !== null, 'M3 devolvió null: la estación no llegó al canónico')
  afirmar(r.api_writes[0].items[0].station === 'barra', 'M3 debía mover la estación a barra')
})

/* ── 4 · raw y canónico conviven ─────────────────────────────────────────── */
prueba('4 · cantidad cruda 1 → q canónico 1, sin borrar el nombre crudo', () => {
  const e = entradaReal()
  afirmar(e.items[0].q === 1, `q canónico debía ser 1, fue ${e.items[0].q}`)
  afirmar(e.items[0].raw.cantidad === 1, 'se perdió el nombre crudo `cantidad`')
  afirmar(Array.isArray(e.items[0].raw.modificadores), 'se perdió `modificadores` crudo')
  afirmar(Array.isArray(e.items[0].raw.modifier_ids), 'se perdió `modifier_ids` crudo')
  afirmar(e.raw_item_keys.includes('cantidad') && e.raw_item_keys.includes('modifier_ids'),
    `raw_item_keys incompleto: ${JSON.stringify(e.raw_item_keys)}`)
  afirmar(e.order_id && e.save_operation_id, 'faltan las identidades del write')
})

/* ── 5 · sin items, nadie finge ──────────────────────────────────────────── */
prueba('5 · save-order sin items → M1/M2/M3 no aplicables, sin inventar', () => {
  const vacio = normalizarSaveOrder({ metodo: 'POST', url: '/api/pos/save-order',
    cuerpoTexto: JSON.stringify({ order_id: 'x', save_operation_id: 'y', items: [] }) })
  afirmar(vacio !== null, 'una petición real sin renglones sigue siendo una petición')
  afirmar(vacio.items.length === 0, 'no debe inventar renglones')
  const m = manifiestoCon(vacio)
  for (const id of ['M1', 'M2', 'M3']) {
    afirmar(mut(id).aplicar(m) === null, `${id} debía ser no aplicable sin renglones`)
  }
  // Y una ruta que no es save-order no produce entrada alguna.
  afirmar(normalizarSaveOrder({ metodo: 'POST', url: '/api/pos/db?path=pos_sessions', cuerpoTexto: '{}' }) === null,
    'normalizarSaveOrder no debe aceptar otras rutas')
  afirmar(normalizarSaveOrder({ metodo: 'POST', url: '/api/pos/save-order', cuerpoTexto: 'no-json' }) === null,
    'un cuerpo ilegible no produce entrada')
})

/* ── 6 · un write, una entrada ───────────────────────────────────────────── */
prueba('6 · la sonda y el MAIN ven el mismo write → una sola entrada, gana el MAIN', () => {
  const delMain = entradaReal()
  const deLaSonda = {   // como la anota la sonda: misma ruta, misma operación
    metodo: 'POST', url: '/api/pos/save-order',
    cuerpo: { order_id: delMain.order_id, save_operation_id: delMain.save_operation_id },
    items: [{ n: 'CERT-G01-PLATO', q: 1, station: 'cocina', mods: ['CERT-G01-ESTANDAR'] }],
  }
  const fusion = fusionarApiWrites([deLaSonda], [delMain])
  afirmar(fusion.length === 1, `debía quedar 1 entrada lógica, quedaron ${fusion.length}`)
  afirmar(fusion[0].source === 'main_http', 'el MAIN debe ganar como autoridad')
  afirmar(clave(deLaSonda) === clave(delMain), 'la identidad debe coincidir entre fuentes')
  // Dos writes DISTINTOS no se colapsan.
  const otro = { ...delMain, save_operation_id: 'otra-operacion' }
  afirmar(fusionarApiWrites([], [delMain, otro]).length === 2, 'dos operaciones distintas no se fusionan')
})

/* ── 7 · sin MAIN no hay aprobado ────────────────────────────────────────── */
prueba('7 · sin fuente MAIN → M1/M2/M3 no aplicables (NOT_OBSERVED), nunca PASS', () => {
  // Lo que la sonda captura HOY sin el observador: pos_sessions, sin renglones.
  const soloSonda = manifiestoCon(null)
  soloSonda.api_writes = [
    { metodo: 'POST', url: '/api/pos/db?path=pos_sessions', cuerpo: { id: 'sess_x' } },
    { metodo: 'PATCH', url: '/api/pos/db?path=pos_sessions%3Fstaff_id%3Deq.x', cuerpo: {} },
  ]
  for (const id of ['M1', 'M2', 'M3']) {
    afirmar(mut(id).aplicar(soloSonda) === null,
      `${id} debe ser no aplicable sin el observador — jamás fabricar un aplicable`)
  }
  // Y la fusión con una lista vacía del MAIN no agrega nada.
  afirmar(fusionarApiWrites(soloSonda.api_writes, []).length === 2, 'la fusión no debe inventar entradas')
})

/* ── 8 · M4 y M5 sin regresión ───────────────────────────────────────────── */
prueba('8 · M4 y M5 siguen detectando con el manifiesto nuevo', () => {
  const m = manifiestoCon(entradaReal())
  m.sync_queue = [{ op: 'save-order', id: 'q1' }]
  const r4 = mut('M4').aplicar(m)
  afirmar(r4 !== null, 'M4 dejó de ser aplicable')
  afirmar(r4.sync_queue.length === 0 && r4.local_db_writes.length === 0, 'M4 debía vaciar las dos colas')
  const r5 = mut('M5').aplicar(m)
  afirmar(r5 !== null, 'M5 dejó de ser aplicable')
  afirmar(r5.api_writes.length === m.api_writes.length + 1, 'M5 debía duplicar la operación')
  afirmar(llavesCrudas(JSON.parse(CUERPO_REAL).items[0]).length > 10, 'el fixture perdió sus llaves crudas')
})

console.log('═'.repeat(66))
console.log(fallas === 0 ? 'TODAS VERDES' : `${fallas} FALLA(S)`)
process.exit(fallas === 0 ? 0 : 1)
