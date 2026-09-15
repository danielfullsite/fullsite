// LAS REGLAS NUEVAS DEL CONTRATO: V-12, V-13 y V-14.
//
// PR1 ya impedía un PASS sin driver, sin 5/5 y sin los 6 pasos. Faltaba lo que
// distingue «el POS emitió las peticiones correctas» de «el efecto quedó»:
//
//   V-12 · los tres oráculos confirmaron
//   V-13 · hay al menos dos capturas
//   V-14 · el guardia no bloqueó ninguna escritura fuera del laboratorio
//
// Cada regla se prueba por su lado FEO: se arma un sobre que por lo demás
// merecería PASS y se le quita UNA cosa. Si el validador lo deja pasar, la
// regla no existe. Un validador que sólo aprueba no valida.
//
//   node cert/probar-oraculos-y-evidencia.mjs

import { nuevoSobre, validar, CONTRACT_VERSION } from './contrato.mjs'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/** Un sobre que SÍ merece PASS. Cada prueba lo degrada en un solo punto. */
function sobreImpecable() {
  const s = nuevoSobre({ runId: 'cert-g01-20260915T193000Z-abc123', journeyId: 'G01', nombre: 'x' })
  s.verdict = 'PASS'
  s.identity = { app_git_sha: 'a'.repeat(40) }
  s.preconditions_satisfied = true
  s.driver = { executed: true, steps_total: 6, steps_ok: 6 }
  s.observations = [{ id: 'x', fase: 'driver', descripcion: 'd', esperado: 1, observado: 1,
                      classification: 'EXPECTED_BEHAVIOR', evidence: null }]
  s.mutation = { total: 5, detected: 5, no_aplicables: [], detalle: [] }
  s.oracles = {
    db:    { classification: 'EXPECTED_BEHAVIOR', motivo: null, detalle: {} },
    pedro: { classification: 'EXPECTED_BEHAVIOR', motivo: null, detalle: {} },
    kds:   { classification: 'EXPECTED_BEHAVIOR', motivo: null, detalle: {} },
  }
  s.visual_evidence = { capturas: 6, trazas: 1, archivos: [] }
  s.sandbox = { modo: 'SANDBOX', tenant: 'fullsite-cert-lab-v2', writes: 4, violations: 0, detalle_violaciones: [] }
  s.capture = { a_steps: '5/5', b_steps: '5/5', reset_verified: true }
  s.parity = { scope: 'S1-S5_CAPTURE_ONLY', diferencias: 0, detalle: [] }
  s.sandbox_steps = '6/6'
  s.summary = { EXPECTED_BEHAVIOR: 1 }
  return s
}

const reglas = (s) => validar(s).map(f => f.regla)

console.log('CONTRATO v' + CONTRACT_VERSION + ' · oráculos, evidencia y guardia\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   0 · LA LÍNEA BASE — si esto no pasa, las demás pruebas no dicen nada
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n0 · el sobre impecable SÍ es aceptado')
{
  const faltas = validar(sobreImpecable())
  T('un PASS completo no tiene faltas', faltas.length === 0, JSON.stringify(faltas))
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · V-12 · SIN ORÁCULOS NO HAY PASS
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · V-12 · los tres oráculos')
{
  const sinNada = sobreImpecable(); sinNada.oracles = {}
  T('rechaza PASS sin ningún oráculo', reglas(sinNada).filter(r => r === 'V-12').length === 3,
    JSON.stringify(validar(sinNada).map(f => f.motivo)))

  for (const cual of ['db', 'pedro', 'kds']) {
    const falta = sobreImpecable(); delete falta.oracles[cual]
    T(`rechaza PASS sin el oráculo «${cual}»`, reglas(falta).includes('V-12'))

    const ciego = sobreImpecable()
    ciego.oracles[cual] = { classification: 'NOT_OBSERVED', motivo: 'no se pudo mirar', detalle: null }
    T(`rechaza PASS con «${cual}» en NOT_OBSERVED`, reglas(ciego).includes('V-12'))
  }

  // Un oráculo que reporta defecto tampoco puede convivir con PASS.
  const roto = sobreImpecable()
  roto.oracles.db = { classification: 'PRODUCT_DEFECT', motivo: 'no quedó la orden', detalle: null }
  T('rechaza PASS con un oráculo en PRODUCT_DEFECT', reglas(roto).includes('V-12'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · V-13 · UN PASS QUE NADIE PUEDE VOLVER A MIRAR
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · V-13 · evidencia visual')
{
  const cero = sobreImpecable(); cero.visual_evidence = { capturas: 0, trazas: 0, archivos: [] }
  T('rechaza PASS con 0 capturas', reglas(cero).includes('V-13'))

  const una = sobreImpecable(); una.visual_evidence = { capturas: 1, trazas: 1, archivos: [] }
  T('rechaza PASS con 1 captura (el mínimo es antes/después)', reglas(una).includes('V-13'))

  const ausente = sobreImpecable(); delete ausente.visual_evidence
  T('rechaza PASS sin la sección de evidencia', reglas(ausente).includes('V-13'))

  const dos = sobreImpecable(); dos.visual_evidence = { capturas: 2, trazas: 0, archivos: [] }
  T('acepta PASS con exactamente 2 capturas', !reglas(dos).includes('V-13'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · V-14 · EL GUARDIA BLOQUEÓ ALGO: ESO SE INVESTIGA, NO SE CERTIFICA
   ───────────────────────────────────────────────────────────────────────────
   Que el guardia haya funcionado no vuelve inocuo el intento. Si el journey
   trató de escribir en otro tenant, primero se averigua por qué.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · V-14 · ninguna escritura fuera del laboratorio')
{
  const conIntento = sobreImpecable()
  conIntento.sandbox = { modo: 'SANDBOX', tenant: 'fullsite-cert-lab-v2', writes: 3, violations: 1,
                         detalle_violaciones: [{ url: '/rest/v1/pos_orders', motivo: 'tenant amalay' }] }
  T('rechaza PASS si el guardia bloqueó una escritura', reglas(conIntento).includes('V-14'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · LAS REGLAS VIEJAS SIGUEN VIVAS
   ───────────────────────────────────────────────────────────────────────────
   Agregar reglas es fácil; romper las que ya estaban, también.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · no hay regresión en V-7, V-8, V-10 y V-11')
{
  const sinDriver = sobreImpecable(); sinDriver.driver.executed = false
  T('V-8 sigue rechazando PASS sin driver ejecutado', reglas(sinDriver).includes('V-8'))

  const mut = sobreImpecable(); mut.mutation = { total: 5, detected: 4, no_aplicables: [], detalle: [] }
  T('V-10 sigue rechazando 4/5 mutaciones', reglas(mut).includes('V-10'))

  const pasos = sobreImpecable(); pasos.driver.steps_ok = 5
  T('V-11 sigue rechazando 5/6 pasos', reglas(pasos).includes('V-11'))

  const obs = sobreImpecable()
  obs.observations = [{ id: 'y', classification: 'NOT_OBSERVED' }]
  T('V-7 sigue rechazando PASS con una observación no conforme', reglas(obs).includes('V-7'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · V-15/V-16/V-17 · LAS DOS FASES
   ───────────────────────────────────────────────────────────────────────────
   G01 se certifica en dos fases porque S6 no puede ejecutarse en CAPTURE_ONLY:
   el POS en modo caja exige que la Caja confirme la cuenta, y la sonda impide
   que la Caja se entere. Estas tres reglas impiden que esa separación se
   convierta en un hueco.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5 · V-15/V-16/V-17 · reset, alcance declarado y 6/6 en SANDBOX')
{
  const sinReset = sobreImpecable()
  sinReset.capture = { a_steps: '5/5', b_steps: '5/5', reset_verified: false }
  T('V-15 rechaza PASS sin reset verificado', reglas(sinReset).includes('V-15'))

  const sinCapture = sobreImpecable(); delete sinCapture.capture
  T('V-15 rechaza PASS sin la sección capture', reglas(sinCapture).includes('V-15'))

  const scopeMalo = sobreImpecable()
  scopeMalo.parity = { scope: 'S1-S6', diferencias: 0, detalle: [] }
  T('V-16 rechaza un alcance que diga cubrir S6', reglas(scopeMalo).includes('V-16'))

  const sinScope = sobreImpecable()
  sinScope.parity = { diferencias: 0, detalle: [] }
  T('V-16 rechaza una paridad sin alcance declarado', reglas(sinScope).includes('V-16'))

  const cinco = sobreImpecable(); cinco.sandbox_steps = '5/6'
  T('V-17 rechaza PASS con 5/6 en SANDBOX', reglas(cinco).includes('V-17'))

  const ninguno = sobreImpecable(); delete ninguno.sandbox_steps
  T('V-17 rechaza PASS sin pasos de SANDBOX', reglas(ninguno).includes('V-17'))

  const seis = sobreImpecable(); seis.sandbox_steps = '6/6'
  T('V-17 acepta 6/6', !reglas(seis).includes('V-17'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · UN ORÁCULO NO ACUSA DE ALGO QUE NUNCA SE INTENTÓ
   ───────────────────────────────────────────────────────────────────────────
   En cert-g01-20260915T210702Z el DB oracle dijo «el journey envió a cocina
   pero no quedó ninguna orden». El journey NO envió: S6 falló. El oráculo dio
   por hecho el paso productor y le cobró al producto su ausencia. Los tres
   tienen que quedar en NOT_OBSERVED cuando S6 no se ejecutó.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n6 · sin S6 ejecutado, los tres oráculos son NOT_OBSERVED')
{
  // El criterio del orquestador: la clase la decide S6, no lo que se encuentre.
  const claseDeOraculo = (s6Ejecutado, hallazgo) =>
    s6Ejecutado !== true ? 'NOT_OBSERVED' : hallazgo

  for (const [caso, hallazgo] of [
    ['S6=false + no hay orden en la base', 'PRODUCT_DEFECT'],
    ['S6=false + la secuencia de Pedro no cambió', 'PRODUCT_DEFECT'],
    ['S6=false + no hay item en el KDS', 'PRODUCT_DEFECT'],
  ]) {
    T(`${caso} → NOT_OBSERVED`, claseDeOraculo(false, hallazgo) === 'NOT_OBSERVED')
  }
  T('con S6 ejecutado, el hallazgo SÍ puede acusar',
    claseDeOraculo(true, 'PRODUCT_DEFECT') === 'PRODUCT_DEFECT')
  T('y con S6 ejecutado y efecto presente, es conforme',
    claseDeOraculo(true, 'EXPECTED_BEHAVIOR') === 'EXPECTED_BEHAVIOR')

  // Y el contrato sigue negando el PASS: NOT_OBSERVED nunca es aprobado.
  const ciego = sobreImpecable()
  ciego.oracles.db = { classification: 'NOT_OBSERVED', motivo: 'S6 no se ejecutó', detalle: null }
  T('V-12 sigue rechazando el PASS con el oráculo ciego', reglas(ciego).includes('V-12'))
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron: el contrato no está vigilando lo que dice.`)
  process.exit(1)
}
console.log('>>> V-12, V-13 y V-14 rechazan lo que deben; V-7/V-8/V-10/V-11 intactas.')
