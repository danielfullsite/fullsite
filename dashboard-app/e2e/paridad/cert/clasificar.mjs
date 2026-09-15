// LA CLASIFICACIÓN — una tabla de decisión, no un criterio.
//
// El juicio se separa de la observación a propósito. Cada paso y cada oráculo
// entrega HECHOS; esta función los traduce a una de seis clases sin volver a
// mirar el sistema. Que sea pura es lo que la hace auditable: se le puede pasar
// un hecho a mano y comprobar qué dice.
//
// Las dos reglas duras existen por dos errores ya pagados en este proyecto:
//
//   · NOT_OBSERVED nunca es PASS. El demo estuvo 14 días muerto con el CI en
//     verde porque «no se pudo medir» contaba como «está bien».
//
//   · PRODUCT_DEFECT exige L0 verde Y que el paso se haya ejecutado. Se reportó
//     un P0 de rutas Uber leyendo el working tree en vez de la base correcta, y
//     el PIN de G01 se leyó como «el POS no deja entrar» cuando era la sonda
//     tragándose la autenticación. Un arnés roto no tiene derecho a acusar al
//     producto.

export const CLASES = Object.freeze([
  'EXPECTED_BEHAVIOR',
  'PRODUCT_DEFECT',
  'HARNESS_ERROR',
  'ENVIRONMENT_ERROR',
  'PRECONDITION_FAILURE',
  'NOT_OBSERVED',
])

/** Clases que impiden declarar PASS. Todas menos una. */
export const NO_PASA = Object.freeze(CLASES.filter(c => c !== 'EXPECTED_BEHAVIOR'))

/**
 * Traduce un hecho observado a una clase.
 *
 * @param {object} h
 * @param {'preflight'|'fixture'|'driver'|'oraculo'|'mutacion'|'paridad'} h.fase
 * @param {boolean} h.ok            ¿la expectativa se cumplió?
 * @param {boolean} [h.l0]          ¿el preflight completo pasó? (default true)
 * @param {boolean} [h.ejecuto]     ¿el driver ejecutó el paso? (default true)
 * @param {boolean} [h.legible]     ¿el oráculo se pudo leer? (default true)
 * @param {'entorno'|'arnes'|'precondicion'|'producto'} [h.causa]
 */
export function clasificar(h) {
  const l0      = h.l0 !== false
  const ejecuto = h.ejecuto !== false
  const legible = h.legible !== false

  // 1 · El preflight es el único que puede hablar de precondiciones.
  if (h.fase === 'preflight' || h.fase === 'fixture') {
    if (h.ok) return 'EXPECTED_BEHAVIOR'
    return h.causa === 'entorno' ? 'ENVIRONMENT_ERROR' : 'PRECONDITION_FAILURE'
  }

  // 2 · Nada posterior al preflight puede juzgarse si el preflight no pasó.
  if (!l0) return 'PRECONDITION_FAILURE'

  // 3 · Un paso que no se ejecutó no dice nada del producto. La causa decide
  //     a quién se le imputa: la LAN y Pedro son entorno; un selector que no
  //     está o un timeout del guion son del arnés.
  if (!ejecuto) {
    if (h.causa === 'entorno')      return 'ENVIRONMENT_ERROR'
    if (h.causa === 'precondicion') return 'PRECONDITION_FAILURE'
    return 'HARNESS_ERROR'
  }

  // 4 · Un oráculo que no se pudo leer NO es un aprobado.
  if (!legible) return 'NOT_OBSERVED'

  if (h.ok) return 'EXPECTED_BEHAVIOR'

  // 5 · Sólo aquí, con L0 verde, paso ejecutado y oráculo legible, se puede
  //     acusar al producto.
  if (h.causa === 'arnes')   return 'HARNESS_ERROR'
  if (h.causa === 'entorno') return 'ENVIRONMENT_ERROR'
  return 'PRODUCT_DEFECT'
}

/**
 * El veredicto de la corrida a partir de todas las clases emitidas.
 * PASS exige que TODAS sean EXPECTED_BEHAVIOR — no hay mayoría ni ponderación.
 */
export function veredicto(clases) {
  if (!clases.length) return { verdict: 'FAIL', razon: 'no se emitió ninguna observación' }
  if (clases.includes('PRECONDITION_FAILURE')) {
    return { verdict: 'PRECONDITION_FAILURE', razon: 'el sistema no estaba en condiciones de ser certificado' }
  }
  if (clases.every(c => c === 'EXPECTED_BEHAVIOR')) {
    return { verdict: 'PASS', razon: `${clases.length} observaciones, todas conformes` }
  }
  const primera = clases.find(c => c !== 'EXPECTED_BEHAVIOR')
  return { verdict: 'FAIL', razon: `primera clase no conforme: ${primera}` }
}

/** Cuenta por clase, para el resumen del sobre. */
export function resumir(clases) {
  const r = Object.fromEntries(CLASES.map(c => [c, 0]))
  for (const c of clases) r[c] = (r[c] ?? 0) + 1
  return r
}
