#!/usr/bin/env node
/**
 * AUTOPRUEBA DEL GUARDIÁN — corre sin base y sin repo.
 *
 * Un validador que sólo aprueba no valida. Estas comprobaciones exigen que el
 * guardián **clasifique distinto** los ocho casos, y sobre todo que NO declare
 * `MATCH` cuando el efecto falta. Es el mismo criterio que
 * `cert/probar-clasificacion.mjs` aplica al arnés de certificación.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'drift-selftest-'))
const w = (n, o) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(o)); return p }

// Un objeto por estado esperado. `file` decide si FILE_ONLY es OK o WARN.
const casos = [
  ['MATCH',                     'OK',    { file: 'm/a.sql', hint: 'aplicada',   enA: true,  enB: true,  enC: 1 }],
  ['FILE_ONLY',                 'OK',    { file: 'm/PENDIENTE_b.sql', hint: 'nunca', enA: true,  enB: false, enC: 0 }],
  ['FILE_ONLY',                 'WARN',  { file: 'm/c.sql', hint: 'nunca',      enA: true,  enB: false, enC: 0 }],
  ['LEDGER_ONLY',               'BLOCK', { file: 'm/ausente.sql', hint: 'aplicada', enA: false, enB: true,  enC: 0 }],
  ['EFFECT_ONLY',               'WARN',  { file: 'm/ausente.sql', hint: 'nunca', enA: false, enB: false, enC: 1 }],
  ['FILE_AND_EFFECT_NO_LEDGER', 'WARN',  { file: 'm/d.sql', hint: 'nunca',      enA: true,  enB: false, enC: 1 }],
  ['LEDGER_AND_EFFECT_NO_FILE', 'WARN',  { file: 'm/ausente.sql', hint: 'aplicada', enA: false, enB: true, enC: 1 }],
  ['MISMATCH',                  'BLOCK', { file: 'm/e.sql', hint: 'aplicada',   enA: true,  enB: true,  enC: 0 }],
  ['UNKNOWN',                   'WARN',  { file: 'm/f.sql', hint: 'nunca',      enA: true,  enB: false, enC: undefined }],
]

const registry = { registry_version: 'selftest', objects: [] }
const effects = {}
const rutas = new Set()
casos.forEach(([esperado, _sev, c], i) => {
  const id = `t${i}.${esperado}`
  registry.objects.push({ id, kind: 'table', rel: null, name: id, file: c.file, ledger_hint: c.hint })
  if (c.enA) rutas.add(c.file)
  if (c.enC !== undefined) effects[id] = c.enC
})

const pR = w('registry.json', registry)
const pF = w('files.json', [...rutas].map(p => ({ path: p })))
const pL = w('ledger.json', [{ version: '1', name: 'aplicada' }])
const pE = w('effects.json', effects)

let salida
try {
  salida = execFileSync('node', [new URL('./drift-guard.mjs', import.meta.url).pathname,
    '--registry', pR, '--files', pF, '--ledger', pL, '--effects', pE,
    '--repo-sha', 'selftest', '--db-identity', 'selftest'], { encoding: 'utf8' })
} catch (e) {
  // salida 1 = hubo bloqueantes, que es lo esperado: dos casos son BLOCK.
  if (e.status !== 1) { console.error('la corrida falló por otra razón:', e.message); process.exit(1) }
  salida = e.stdout
}

const art = JSON.parse(salida)
let fallos = 0
casos.forEach(([esperado, sevEsperada], i) => {
  const o = art.objects.find(x => x.id.startsWith(`t${i}.`))
  const okEstado = o?.state === esperado
  const okSev = o?.severity === sevEsperada
  if (!okEstado || !okSev) {
    fallos++
    console.error(`  ✗ t${i}: esperaba ${esperado}/${sevEsperada}, obtuvo ${o?.state}/${o?.severity}`)
  } else {
    console.log(`  ✓ t${i}  ${esperado.padEnd(26)} ${sevEsperada}`)
  }
})

// La comprobación que más importa: sin efecto NUNCA hay MATCH.
// v1.1: `sources.effect` pasó de booleano a objeto. Con el acceso viejo esta
// comprobación se volvía vacía —siempre pasaba— que es la peor forma de fallar:
// un test verde que no mira nada.
const efectoAusente = (o) => o.sources.effect?.exists === false
const falsoMatch = art.objects.filter(o => efectoAusente(o) && o.state === 'MATCH')
if (falsoMatch.length) { fallos++; console.error(`  ✗ MATCH sin efecto en: ${falsoMatch.map(o => o.id)}`) }
else console.log('  ✓ ningún MATCH sin efecto comprobado')

// El artefacto no puede declarar que escribió.
if (art.guarantees.ddl_executed !== 0 || art.guarantees.ledger_writes !== 0) {
  fallos++; console.error('  ✗ el artefacto declara escrituras')
} else console.log('  ✓ el artefacto declara cero escrituras')


// ═══════════════════════════════════════════════════════════════════════════
// BLOQUE 2 · FINGERPRINTS — existir NO es ser equivalente
//
// Estos casos existen para que el guardián FALLE si alguien vuelve a tratar
// `exists` como prueba de conformidad. Los cuatro primeros tienen archivo +
// ledger + objeto presentes: bajo la lógica v1 serían MATCH. Aquí deben ser
// MISMATCH, porque la definición no corresponde.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── fingerprints ──')

const F = 'm/fp.sql'
const fpCasos = [
  ['col-tipo-distinto', 'MISMATCH', 'column',
    { kind: 'column', data_type: 'text', udt_name: 'text', is_nullable: 'YES', column_default: '' },
    { kind: 'column', data_type: 'integer', udt_name: 'int4', is_nullable: 'YES', column_default: '' }],
  ['idx-predicado-distinto', 'MISMATCH', 'index',
    { kind: 'index', unique: true, indexdef: 'CREATE UNIQUE INDEX i ON t USING btree (a, b) WHERE (b IS NOT NULL)' },
    { kind: 'index', unique: true, indexdef: 'CREATE UNIQUE INDEX i ON t USING btree (a, b) WHERE (b IS NULL)' }],
  ['fn-body-distinto', 'MISMATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public', body_md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public', body_md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
  ['fn-security-distinta', 'MISMATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public' },
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: false, search_path: 'public' }],
  ['fn-correcta', 'MATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'pg_catalog, public' },
    { kind: 'function', args: 'a  text', returns: 'JSONB', security_definer: true, search_path: 'search_path=pg_catalog,public' }],
  ['fn-introspeccion-incompleta', 'MATCH', 'function',   // existe, sin observed → NOT_CHECKED, no MISMATCH
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public' },
    null],

  // ── EL MISMATCH FALSO POR MÉTODO DE HASH ─────────────────────────────────
  // El 2026-09-19 el guardián marcó cuatro funciones como corruptas. Dos no
  // habían cambiado: el pin se había calculado colapsando espacios y la
  // observación no. Comparar dos métodos distintos fabrica corrupción.
  ['fn-metodo-colapsado-que-empata', 'MATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'cccccccccccccccccccccccccccccccc', body_md5_method: 'collapsed' },
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'dddddddddddddddddddddddddddddddd', body_md5_collapsed: 'cccccccccccccccccccccccccccccccc' }],
  // Y el caso que importa de verdad: pedir un método que la introspección NO
  // trajo NO puede producir MISMATCH. Se deja sin comparar y se dice.
  ['fn-metodo-no-observado', 'MATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'cccccccccccccccccccccccccccccccc', body_md5_method: 'collapsed' },
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'dddddddddddddddddddddddddddddddd' }],
  // Con el MISMO método y distinto valor, sigue siendo corrupción.
  ['fn-mismo-metodo-distinto-valor', 'MISMATCH', 'function',
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'cccccccccccccccccccccccccccccccc', body_md5_method: 'collapsed' },
    { kind: 'function', args: 'a text', returns: 'jsonb', security_definer: true, search_path: 'public',
      body_md5: 'cccccccccccccccccccccccccccccccc', body_md5_collapsed: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }],
]

const reg2 = { registry_version: 'selftest-fp', objects: [] }
const eff2 = {}
fpCasos.forEach(([nombre, _esp, kind, expected, observed], i) => {
  const id = `f${i}.${nombre}`
  reg2.objects.push({ id, kind, rel: 't', name: id, file: F, ledger_hint: 'aplicada', expected: { source: 'file', ...expected } })
  eff2[id] = observed ? { exists: true, observed } : { exists: true }
})

const q = (n, o) => { const x = join(dir2, n); writeFileSync(x, JSON.stringify(o)); return x }
const dir2 = mkdtempSync(join(tmpdir(), 'drift-selftest-fp-'))
const art2 = (() => {
  const pR2 = q('registry.json', reg2), pF2 = q('files.json', [{ path: F }])
  const pL2 = q('ledger.json', [{ version: '1', name: 'aplicada' }]), pE2 = q('effects.json', eff2)
  try {
    return JSON.parse(execFileSync('node', [new URL('./drift-guard.mjs', import.meta.url).pathname,
      '--registry', pR2, '--files', pF2, '--ledger', pL2, '--effects', pE2,
      '--repo-sha', 'selftest', '--db-identity', 'selftest'], { encoding: 'utf8' }))
  } catch (e) {
    if (e.status !== 1) { console.error('corrida fp falló:', e.message); process.exit(1) }
    return JSON.parse(e.stdout)
  }
})()

fpCasos.forEach(([nombre, esperado], i) => {
  const o = art2.objects.find(x => x.id.startsWith(`f${i}.`))
  if (o?.state === esperado) console.log(`  ✓ ${nombre.padEnd(30)} ${esperado}`)
  else { fallos++; console.error(`  ✗ ${nombre}: esperaba ${esperado}, obtuvo ${o?.state} (detalle ${o?.sources?.effect?.detail})`) }
})

// LA COMPROBACIÓN QUE NO SE PUEDE QUITAR: si el guardián aceptara existencia
// como equivalencia, los cuatro primeros serían MATCH y esto fallaría.
const falsoPositivo = art2.objects.filter((o, i) => i < 4 && o.state === 'MATCH')
if (falsoPositivo.length) {
  fallos++
  console.error(`  ✗ FALSE_MATCH: el guardián aceptó existencia como equivalencia en ${falsoPositivo.map(o => o.id)}`)
} else console.log('  ✓ FALSE_MATCH: existencia NO se acepta como equivalencia')

// Un MISMATCH tiene que bloquear, no sólo avisar.
const noBloquean = art2.objects.filter(o => o.state === 'MISMATCH' && o.severity !== 'BLOCK')
if (noBloquean.length) { fallos++; console.error(`  ✗ MISMATCH sin BLOCK: ${noBloquean.map(o => o.id)}`) }
else console.log('  ✓ todo MISMATCH bloquea')

// ── LA FIRMA: dos implementaciones, un solo hash ───────────────────────────
// `drift-guard.mjs` copia `hashContenido` en vez de importarla, para poder
// correr en CI sin el cerebro al lado. La copia sólo es segura si esta prueba
// existe: si alguien toca una y no la otra, un artefacto firmado por el
// guardián se leería TAMPERED desde el índice.
const { hashContenido: hashGuard } = await import('./hash.mjs')
  .catch(() => ({ hashContenido: null }))
const { hashContenido: hashBrain } = await import('../brain/lib/artifact.mjs')
  .catch(() => ({ hashContenido: null }))
if (!hashGuard || !hashBrain) { fallos++; console.error('  ✗ no se pudo importar alguna implementación de hash') }
else {
  const muestra = { b: [3, { z: 1, a: 2 }], a: 'x', content_sha256: 'se-ignora' }
  if (hashGuard(muestra) === hashBrain(muestra)) console.log('  ✓ el guardián y el cerebro firman idéntico')
  else { fallos++; console.error('  ✗ las dos implementaciones de hashContenido divergen') }
}

// Y el artefacto emitido tiene que verificar contra su propia firma.
if (art2.content_sha256 && hashGuard && hashGuard(art2) === art2.content_sha256)
  console.log('  ✓ el artefacto emitido verifica contra su firma')
else { fallos++; console.error('  ✗ el artefacto emitido no verifica contra su firma') }

rmSync(dir, { recursive: true, force: true })
rmSync(dir2, { recursive: true, force: true })
const total = casos.length + 2 + fpCasos.length + 2 + 2
console.log(fallos === 0 ? `\nautoprueba: ${total}/${total} OK` : `\nautoprueba: ${fallos} fallo(s) de ${total}`)
process.exit(fallos === 0 ? 0 : 1)
