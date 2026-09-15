// ¿LA CLASIFICACIÓN Y EL VALIDADOR SE DEJAN ENGAÑAR?
//
// Un validador que sólo aprueba sobres buenos no valida. La mitad de este
// archivo le da sobres DEFECTUOSOS a propósito y exige que los rechace, con la
// regla concreta. Si algún día deja de rechazarlos, esta prueba truena.
//
//   node cert/probar-clasificacion.mjs

import { clasificar, veredicto, resumir } from './clasificar.mjs'
import { nuevoRunId, nuevoSobre, observar, validar, CONTRACT_VERSION } from './contrato.mjs'

let fallos = 0
const T = (nombre, real, esperado) => {
  const ok = real === esperado
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `  → esperaba «${esperado}», llegó «${real}»`}`)
}
const TIENE = (nombre, faltas, regla) => {
  const ok = faltas.some(f => f.regla === regla)
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `  → no emitió ${regla}; emitió: ${faltas.map(f => f.regla).join(',') || '(nada)'}`}`)
}

console.log('ARNÉS G01 · clasificación y contrato\n' + '═'.repeat(66))

/* ── 1 · La tabla de decisión ───────────────────────────────────────────── */
console.log('\n1. TABLA DE CLASIFICACIÓN')

T('preflight en verde', clasificar({ fase: 'preflight', ok: true }), 'EXPECTED_BEHAVIOR')
T('compuerta de precondición falla', clasificar({ fase: 'preflight', ok: false }), 'PRECONDITION_FAILURE')
T('compuerta de entorno falla', clasificar({ fase: 'preflight', ok: false, causa: 'entorno' }), 'ENVIRONMENT_ERROR')

// La regla que impide el falso P0: sin L0 nadie juzga al producto.
T('L0 rojo contamina todo lo posterior',
  clasificar({ fase: 'oraculo', ok: false, l0: false }), 'PRECONDITION_FAILURE')

// Un paso que no se ejecutó no observó nada.
T('paso no ejecutado por selector → arnés',
  clasificar({ fase: 'driver', ok: false, ejecuto: false }), 'HARNESS_ERROR')
T('paso no ejecutado por LAN/Pedro → entorno',
  clasificar({ fase: 'driver', ok: false, ejecuto: false, causa: 'entorno' }), 'ENVIRONMENT_ERROR')
T('paso no ejecutado por dato sin sembrar → precondición',
  clasificar({ fase: 'driver', ok: false, ejecuto: false, causa: 'precondicion' }), 'PRECONDITION_FAILURE')

// La regla que mató el verde-en-vacío.
T('oráculo ilegible NO es aprobado',
  clasificar({ fase: 'oraculo', ok: true, legible: false }), 'NOT_OBSERVED')

// El único camino a PRODUCT_DEFECT.
T('L0 verde + paso ejecutado + oráculo contradice → defecto',
  clasificar({ fase: 'oraculo', ok: false, l0: true, ejecuto: true, legible: true }), 'PRODUCT_DEFECT')
T('oráculo conforme', clasificar({ fase: 'oraculo', ok: true }), 'EXPECTED_BEHAVIOR')

/* ── 2 · El veredicto ───────────────────────────────────────────────────── */
console.log('\n2. VEREDICTO')
T('todo conforme → PASS', veredicto(['EXPECTED_BEHAVIOR', 'EXPECTED_BEHAVIOR']).verdict, 'PASS')
T('un NOT_OBSERVED jamás es PASS',
  veredicto(['EXPECTED_BEHAVIOR', 'NOT_OBSERVED']).verdict, 'FAIL')
T('una precondición domina el veredicto',
  veredicto(['PRODUCT_DEFECT', 'PRECONDITION_FAILURE']).verdict, 'PRECONDITION_FAILURE')
T('sin observaciones no hay PASS', veredicto([]).verdict, 'FAIL')

/* ── 3 · EL VALIDADOR, VISTO FALLAR ─────────────────────────────────────── */
console.log('\n3. EL VALIDADOR RECHAZA SOBRES DEFECTUOSOS')

const sobreBueno = () => {
  const runId = nuevoRunId('g01')
  const s = nuevoSobre({ runId, journeyId: 'G01', nombre: 'prueba' })
  s.verdict = 'PASS'
  s.preconditions_satisfied = true
  s.identity = { app_git_sha: 'abc123', app_clean: true, coherente: true }
  s.driver = { executed: true, steps_total: 6, steps_ok: 6 }
  s.mutation = { total: 5, detected: 5, no_aplicables: [], detalle: [] }
  s.summary = resumir(['EXPECTED_BEHAVIOR'])
  observar(s, { id: 'x', fase: 'driver', descripcion: 'algo', esperado: 1, observado: 1, clase: 'EXPECTED_BEHAVIOR' })
  return s
}

T('un sobre bien formado pasa', validar(sobreBueno()).length, 0)

let s = sobreBueno(); s.contract_version = '0.9'
TIENE('rechaza contract_version equivocada', validar(s), 'V-2')

s = sobreBueno(); s.run_id = 'g01-lo-que-sea'
TIENE('rechaza run_id mal formado', validar(s), 'V-3')

s = sobreBueno(); s.verdict = 'CASI'
TIENE('rechaza un veredicto inventado', validar(s), 'V-4')

s = sobreBueno(); s.correlation.run_id = 'cert-g01-20260101T000000Z-aaaaaa'
TIENE('rechaza el árbol de correlación roto', validar(s), 'V-5')

s = sobreBueno(); s.observations = []
TIENE('rechaza PASS sin observaciones', validar(s), 'V-6')

s = sobreBueno()
observar(s, { id: 'y', fase: 'oraculo', descripcion: 'no se pudo leer', esperado: 1, observado: null, clase: 'NOT_OBSERVED' })
TIENE('rechaza PASS con un NOT_OBSERVED dentro', validar(s), 'V-7')

s = sobreBueno(); s.driver.executed = false
TIENE('rechaza PASS sin driver ejecutado', validar(s), 'V-8')

s = sobreBueno(); s.preconditions_satisfied = false
TIENE('impone PRECONDITION_FAILURE cuando L0 falló', validar(s), 'V-9')

s = sobreBueno(); s.mutation = { total: 5, detected: 2, no_aplicables: ['M1', 'M2', 'M3'], detalle: [] }
TIENE('rechaza PASS con mutaciones 2/5', validar(s), 'V-10')

s = sobreBueno(); s.mutation = { total: 5, detected: 5, no_aplicables: ['M1'], detalle: [] }
TIENE('rechaza PASS con una mutación no aplicable', validar(s), 'V-10')

s = sobreBueno(); s.driver.steps_ok = 5
TIENE('rechaza PASS con 5 de 6 pasos', validar(s), 'V-11')

console.log('\n' + '═'.repeat(66))
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron. EL ARNÉS NO ES CONFIABLE.`)
  process.exit(1)
}
console.log(`>>> clasificación y contrato v${CONTRACT_VERSION}: todas las comprobaciones pasan,`)
console.log('    incluidas las doce que exigen que el validador RECHACE.')
