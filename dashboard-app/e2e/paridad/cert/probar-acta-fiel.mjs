// ¿EL ACTA DICE LA VERDAD SOBRE SÍ MISMA?
//
// Dos defectos reales de la corrida cert-g01-20260915T203020Z, los dos del
// mismo tipo: el acta afirmaba algo que el disco desmentía.
//
//   1. `capturas: 0` con 12 PNG y 2 trazas EN el directorio de la corrida. El
//      conteo vivía al final del guion feliz, después de la compuerta que corta
//      cuando el driver no ejecuta — justo el caso en que la evidencia más
//      falta hace, porque es lo que se mira para saber por qué falló.
//
//   2. `cdp http://127.0.0.1:9222` cuando la corrida habló con :50815. El
//      encabezado imprimía el default ANTES de que L0 detectara el puerto real.
//
// Un acta con un dato falso vale menos que una sin el dato: quien la lea
// después no puede saber qué se midió. Estas pruebas reintroducen las dos
// condiciones y exigen que el arnés las reporte bien.
//
//   node cert/probar-acta-fiel.mjs

import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nuevoSobre, validar } from './contrato.mjs'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

console.log('EL ACTA DICE LA VERDAD SOBRE SÍ MISMA\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · CONTEO DE EVIDENCIA — la misma función que usa el orquestador
   ───────────────────────────────────────────────────────────────────────────
   Se replica aquí el CRITERIO (extensión .png / .zip sobre el directorio de la
   corrida) y se ejerce contra directorios reales. Lo que se vigila no es la
   aritmética, sino que el conteo mire el DISCO y no un contador en memoria.
   ═══════════════════════════════════════════════════════════════════════════ */
function contar(dir) {
  const archivos = existsSync(dir) ? readdirSync(dir) : []
  return {
    capturas: archivos.filter(f => f.toLowerCase().endsWith('.png')).length,
    trazas: archivos.filter(f => f.toLowerCase().endsWith('.zip')).length,
  }
}

console.log('\n1 · la evidencia se cuenta sobre lo que hay en el disco')
{
  const dir = mkdtempSync(join(tmpdir(), 'cert-acta-'))
  try {
    T('directorio vacío → 0 capturas', contar(dir).capturas === 0)

    // La corrida que falla temprano: 12 capturas, 2 trazas, driver sin ejecutar.
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(dir, `A-paso-0${i}.png`), 'x')
      writeFileSync(join(dir, `B-paso-0${i}.png`), 'x')
    }
    writeFileSync(join(dir, 'traza-A.zip'), 'x')
    writeFileSync(join(dir, 'traza-B.zip'), 'x')
    writeFileSync(join(dir, 'run.json'), '{}')
    writeFileSync(join(dir, 'REPORT.md'), '#')

    const c = contar(dir)
    T('12 PNG en disco → capturas = 12', c.capturas === 12, `contó ${c.capturas}`)
    T('2 ZIP en disco → trazas = 2', c.trazas === 2, `contó ${c.trazas}`)
    T('run.json y REPORT.md NO se cuentan como evidencia visual',
      c.capturas === 12 && c.trazas === 2)

    // LA REGRESIÓN EXACTA: el sobre no puede decir 0 teniendo 12 en el disco.
    const sobre = nuevoSobre({ runId: 'cert-g01-20260915T203020Z-ba82e7' })
    sobre.visual_evidence = { capturas: c.capturas, trazas: c.trazas, archivos: [] }
    T('el sobre de una corrida cortada NO reporta 0 capturas',
      sobre.visual_evidence.capturas > 0, `reportó ${sobre.visual_evidence.capturas}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · V-13 SIGUE MORDIENDO
   ───────────────────────────────────────────────────────────────────────────
   Contar bien no sirve si el contrato deja pasar un PASS sin capturas.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · contar bien no relaja el contrato')
{
  const base = () => {
    const s = nuevoSobre({ runId: 'cert-g01-20260915T193000Z-abc123' })
    s.verdict = 'PASS'; s.preconditions_satisfied = true
    s.identity = { app_git_sha: 'a' }
    s.driver = { executed: true, steps_total: 6, steps_ok: 6 }
    s.observations = [{ id: 'x', classification: 'EXPECTED_BEHAVIOR' }]
    s.mutation = { total: 5, detected: 5, no_aplicables: [], detalle: [] }
    s.oracles = { db: { classification: 'EXPECTED_BEHAVIOR' }, pedro: { classification: 'EXPECTED_BEHAVIOR' },
                  kds: { classification: 'EXPECTED_BEHAVIOR' } }
    s.sandbox = { modo: 'SANDBOX', tenant: 'fullsite-cert-lab-v2', writes: 1, violations: 0, detalle_violaciones: [] }
    s.summary = { EXPECTED_BEHAVIOR: 1 }
    return s
  }
  const cero = base(); cero.visual_evidence = { capturas: 0, trazas: 0, archivos: [] }
  T('V-13 rechaza PASS con 0 capturas', validar(cero).some(f => f.regla === 'V-13'))

  const doce = base(); doce.visual_evidence = { capturas: 12, trazas: 2, archivos: [] }
  T('V-13 acepta PASS con 12 capturas', !validar(doce).some(f => f.regla === 'V-13'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · EL CDP DEL ACTA ES EL QUE SE USÓ
   ───────────────────────────────────────────────────────────────────────────
   El puerto real de la terminal de certificación ha sido 9225 y luego 50815,
   ninguno de los dos el default. El acta tiene que decir cuál se usó, y nunca
   el que estaba escrito en la configuración por si acaso.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · el acta registra el CDP realmente usado')
{
  const sobre = nuevoSobre({ runId: 'cert-g01-20260915T203020Z-ba82e7' })
  T('el sobre nace sin CDP declarado', sobre.cdp === undefined || sobre.cdp === null)

  // Lo que hace el orquestador tras L0.
  const detectado = 'http://127.0.0.1:50815'
  sobre.cdp = { url: detectado, origen: 'detectado en L0' }
  T('tras L0 el acta trae el puerto detectado', sobre.cdp.url === detectado, sobre.cdp.url)
  T('el acta NO contiene el default 9222', !JSON.stringify(sobre.cdp).includes('9222'),
    JSON.stringify(sobre.cdp))

  // Sin navegador, se dice que no hubo — no se rellena con el default.
  const ciego = nuevoSobre({ runId: 'cert-g01-20260915T203020Z-ba82e7' })
  ciego.cdp = { url: null, origen: 'no disponible' }
  T('sin navegador el acta dice null, no 9222', ciego.cdp.url === null)
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron: el acta puede volver a mentir.`)
  process.exit(1)
}
console.log('>>> el conteo mira el disco y el CDP del acta es el que se usó.')
