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
const falsoMatch = art.objects.filter(o => o.sources.effect === false && o.state === 'MATCH')
if (falsoMatch.length) { fallos++; console.error(`  ✗ MATCH sin efecto en: ${falsoMatch.map(o => o.id)}`) }
else console.log('  ✓ ningún MATCH sin efecto comprobado')

// El artefacto no puede declarar que escribió.
if (art.guarantees.ddl_executed !== 0 || art.guarantees.ledger_writes !== 0) {
  fallos++; console.error('  ✗ el artefacto declara escrituras')
} else console.log('  ✓ el artefacto declara cero escrituras')

rmSync(dir, { recursive: true, force: true })
console.log(fallos === 0 ? `\nautoprueba: ${casos.length + 2}/${casos.length + 2} OK` : `\nautoprueba: ${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
