#!/usr/bin/env node
/**
 * AUTOPRUEBA DEL CEREBRO — sin base, sin red, sin entorno.
 *
 * Estas comprobaciones existen para que el cerebro FALLE si alguien vuelve a
 * tratar la ausencia de evidencia como salud. Cada una está escrita para poder
 * fallar: una prueba que sólo aprueba no prueba nada.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitir, leer, hashContenido, revisarFugas, sinEvidencia, ESTADOS } from './lib/artifact.mjs'
import { evaluarEdad, resolverAhora, TIEMPO } from './lib/tiempo.mjs'
import { evaluarFrescura, evaluarCobertura, veredictoDeRespuesta, FRESCURA } from './lib/frescura.mjs'
import { AGENTES } from './detectors.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BRAIN = join(AQUI, 'brain.mjs')
let ok = 0, fail = 0
const t = (cond, nombre, detalle = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`) }
  else { fail++; console.error(`  ✗ ${nombre}${detalle ? ' — ' + detalle : ''}`) }
}
const dir = mkdtempSync(join(tmpdir(), 'brain-selftest-'))
const w = (n, o) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(o)); return p }
const correr = (args, env = {}) => {
  try { return { out: execFileSync('node', [BRAIN, ...args], { encoding: 'utf8', env: { ...process.env, BRAIN_OUT: dir, BRAIN_EXTRA: '', ...env } }), code: 0 } }
  catch (e) { return { out: e.stdout || '', err: e.stderr || '', code: e.status } }
}

console.log('── sobre de artefacto ──')
const a1 = emitir({ kind: 'prueba', body: { x: 1 } })
t(a1.content_sha256?.length === 64, 'el artefacto se firma con su propio hash')
t(a1.guarantees.read_only === true, 'declara que es de sólo lectura')
const manipulado = { ...a1, x: 2 }
t(hashContenido(manipulado) !== a1.content_sha256, 'editar el contenido rompe el hash')
const p1 = join(dir, 'prueba.json'); writeFileSync(p1, JSON.stringify(manipulado))
t(leer(p1)._integrity === 'TAMPERED', 'un artefacto editado a mano se marca TAMPERED')
// Un artefacto ajeno sin firma NO es manipulación. Confundirlos produce una
// falsa alarma permanente, y una falsa alarma permanente apaga la comprobación.
const p2 = join(dir, 'ajeno.json'); writeFileSync(p2, JSON.stringify({ tool: 'otra-herramienta', x: 1 }))
t(leer(p2)._integrity === 'UNSIGNED', 'un artefacto sin firma se marca UNSIGNED, no TAMPERED')

console.log('\n── fugas: el emisor se niega ──')
for (const [caso, cuerpo] of [
  ['JWT', { tok: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0' }],
  ['correo', { quien: 'alguien@ejemplo.com' }],
  ['bearer', { h: 'Bearer abcdefghijklmnopqrstuvwxyz0123' }],
]) {
  let lanzo = false
  try { emitir({ kind: 'fuga', body: cuerpo }) } catch { lanzo = true }
  t(lanzo, `se niega a emitir con ${caso}`)
}
t(revisarFugas({ a: 'texto inocente', sha: 'a'.repeat(40) }) === null, 'un SHA de commit no se confunde con un secreto')

console.log('\n── la ausencia de evidencia NO es salud ──')
t(sinEvidencia('x').state === ESTADOS.UNKNOWN, 'sinEvidencia() sólo produce UNKNOWN')
for (const [id, ag] of Object.entries(AGENTES)) {
  if (id === 'AI_OPERATIONS_ANALYST') continue
  const f = ag.run({}, { artifacts: [] })
  const hayOk = f.some(x => x.state === ESTADOS.OK)
  t(!hayOk, `${id} sin observaciones NO devuelve ningún OK`,
    hayOk ? `devolvió ${f.filter(x => x.state === ESTADOS.OK).map(x => x.id)}` : '')
}

console.log('\n── detectores: casos que deben ALERTAR ──')
t(AGENTES.CASH_AND_SHIFT_GUARDIAN.run({ now_ms: Date.now(), open_shift_index_exists: true, cash_movements_without_op_id: 0,
    open_shifts: [{ tenant: 'a', id: '1', opened_at: new Date().toISOString() }, { tenant: 'a', id: '2', opened_at: new Date().toISOString() }] })
  .some(f => f.id.startsWith('multiple_open') && f.state === ESTADOS.ALERT), 'dos turnos abiertos del mismo tenant → ALERT')
t(AGENTES.SOURCE_AUTHORITY_GUARDIAN.run({ contract_tables: [{ table: 't', rpc: 'r', in_proxy_allow: true }] })
  .some(f => f.state === ESTADOS.ALERT && f.invariant === 'INV-07'), 'tabla con RPC y expuesta por el proxy → ALERT INV-07')
t(AGENTES.SECURITY_CONFIG_GUARDIAN.run({ pos_terminals_exists: false, receipt_ledger_writable: false,
    enrolled_terminal_flag: [{ tenant: 'a', value: true }] })
  .some(f => f.severity === 'CRITICAL'), 'flag de enrolamiento encendido sin su tabla → CRITICAL')
t(AGENTES.INCIDENT_TRIAGE_AGENT.run({ findings: [{ id: 'x', class: 'NOT_OBSERVED', treated_as: 'PASS' }] })
  .some(f => f.state === ESTADOS.ALERT), 'NOT_OBSERVED tratado como PASS → ALERT')
t(AGENTES.INCIDENT_TRIAGE_AGENT.run({ findings: [{ id: 'y', class: 'PRODUCT_DEFECT', reproduced: false }] })
  .some(f => f.state === ESTADOS.DEGRADED), 'PRODUCT_DEFECT sin reproducir → DEGRADED')
t(AGENTES.RELEASE_GUARDIAN.run({ serving: { code_sha: 'abc' }, p0a_ancestor: true }, { releaseArtifacts: [] })
  .some(f => f.id === 'serving_sha' && f.state === ESTADOS.ALERT), 'SHA servido sin artefacto de release → ALERT')

console.log('\n── vigilante de ausencia ──')
const señales = {
  signals: [
    { EXPECTED_SIGNAL: 'viva', SILENCE_THRESHOLD_MIN: 60, CURRENT_STATE: 'HEALTHY', owner: 'x' },
    { EXPECTED_SIGNAL: 'muda', SILENCE_THRESHOLD_MIN: 10, CURRENT_STATE: 'HEALTHY', owner: 'x' },
    { EXPECTED_SIGNAL: 'nunca', SILENCE_THRESHOLD_MIN: 10, CURRENT_STATE: 'NEVER_SEEN', owner: 'x' },
    { EXPECTED_SIGNAL: 'sin_emisor', SILENCE_THRESHOLD_MIN: null, CURRENT_STATE: 'NOT_INSTRUMENTED', owner: 'x' },
    { EXPECTED_SIGNAL: 'no_medida', SILENCE_THRESHOLD_MIN: 10, CURRENT_STATE: 'HEALTHY', owner: 'x' },
  ],
}
const ahora = Date.now()
const obsA = w('obs-a.json', { now_ms: ahora, last_seen: {
  viva: new Date(ahora - 5 * 60000).toISOString(),
  muda: new Date(ahora - 600 * 60000).toISOString(),
  nunca: null } })   // `no_medida` se omite a propósito
const rA = JSON.parse(correr(['absence', obsA, w('sig.json', señales)]).out)
const est = Object.fromEntries(rA.signals.map(s => [s.signal, s.state]))
t(est.viva === 'HEALTHY', 'señal dentro de su frecuencia → HEALTHY')
t(est.muda === 'SILENT', 'señal que llegó y dejó de llegar → SILENT')
t(est.nunca === 'NEVER_SEEN', 'emisor que nunca produjo → NEVER_SEEN')
t(est.sin_emisor === 'NOT_INSTRUMENTED', 'sin emisor → NOT_INSTRUMENTED, que no es alerta')
t(est.no_medida === 'UNKNOWN', 'señal NO observada en la corrida → UNKNOWN, nunca HEALTHY')
t(rA.alerts.length === 2 && rA.alerts.every(a => ['muda', 'nunca'].includes(a.signal)), 'alerta sólo lo que debe alertar')

console.log('\n── field cert: la espera no es aprobación ──')
const ident = w('id.json', { release_sha: 'a'.repeat(40), tenant_class: 'CERT', tenant_id: 'lab', terminal_id: null, actor_id: null })
const s1 = JSON.parse(correr(['field-cert', 'open', ident]).out)
t(s1.state === 'OPEN_WITH_GAPS', 'identidad incompleta se marca, no se inventa')
t(s1.identity_incomplete.includes('terminal_id'), 'dice exactamente qué campo falta')
t(s1.identity_capture === 'AUTOMATIC — ningún campo tecleado', 'declara que nadie tecleó nada')
const c1 = JSON.parse(correr(['field-cert', 'close', w('c.json', { physical_confirmations: [{ check_id: 'PAPER_PRINTED', confirmed: null }] })]).out)
t(c1.verdict === 'WAITING_PHYSICAL_CONFIRMATION', 'una confirmación pendiente NUNCA promueve a PASS')
t(c1.artifact_kind === 'field-cert-artifact', 'el artefacto conserva su tipo al reemitirse')
const c2 = JSON.parse(correr(['field-cert', 'close', w('c2.json', { physical_confirmations: [{ check_id: 'PAPER_PRINTED', confirmed: true }] })]).out)
t(c2.verdict === 'INCOMPLETE', 'con identidad incompleta tampoco es PASS, aunque lo físico esté confirmado')

console.log('\n── emisor de release: los huecos se declaran ──')
const r1 = JSON.parse(correr(['release-emit', w('rel.json', { code_sha: 'b'.repeat(40) })]).out)
t(r1.verdict === 'INCOMPLETE', 'faltan campos → INCOMPLETE, no SHIPPED')
t(r1.unknown_fields.length >= 2, 'enumera qué campos no tienen evidencia')
t(r1.what_shipped.vercel_deployment_id === 'UNKNOWN', 'un campo sin evidencia dice UNKNOWN, no se omite')
t(r1.verdict_reason && r1.verdict_reason.length > 0, 'un INCOMPLETE por huecos dice cuáles')
t(r1.evidence_complete === false, 'declara explícitamente que la evidencia no está completa')

// UN VEREDICTO MUDO. Con todos los campos presentes el emisor devolvía
// INCOMPLETE y `verdict_reason: ''`. Quien lo leyera no tenía por qué.
const relCompleto = {
  code_sha: 'c'.repeat(40), vercel_deployment_id: 'dpl_x', field_cert_verdict: 'WAITING_PHYSICAL_CONFIRMATION',
}
const r2 = JSON.parse(correr(['release-emit', w('rel2.json', relCompleto)]).out)
t(r2.unknown_fields.length === 0, 'sin huecos no enumera huecos')
t(r2.evidence_complete === true, 'con todos los campos, evidence_complete = true')
t(r2.verdict === 'INCOMPLETE', 'evidencia completa NO basta: la certificación de campo sigue pendiente')
t(/WAITING_PHYSICAL_CONFIRMATION/.test(r2.verdict_reason || ''), 'y el motivo nombra el estado de la certificación')
const r3 = JSON.parse(correr(['release-emit', w('rel3.json', { ...relCompleto, field_cert_verdict: 'PASS' })]).out)
t(r3.verdict === 'EVIDENCE_COMPLETE', 'con field_cert PASS el veredicto es EVIDENCE_COMPLETE')
t(r3.verdict !== 'CERTIFIED' && r3.verdict !== 'PASS', 'el emisor NUNCA certifica: eso lo hace la certificación de campo')
t((r3.verdict_reason || '').length > 0, 'incluso el veredicto bueno trae su razón')

console.log('\n── índice ──')
const idx = JSON.parse(correr(['index']).out)
t(idx.questions.every(q => q.answer === 'UNKNOWN' ? q.why : true), 'toda respuesta UNKNOWN explica por qué')
t(idx.questions.every(q => q.answer === 'UNKNOWN' || q.as_of), 'toda respuesta con dato lleva su fecha')

// ═══════════════════════════════════════════════════════════════════════════
// TIEMPO — el defecto del -1302 y su familia
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── tiempo: edad, unidades y desfase de reloj ──')
const BASE = Date.parse('2026-09-19T06:00:00Z')
const en = (min) => new Date(BASE + min * 60000).toISOString()

t(evaluarEdad({ desde: en(0), hasta: BASE }).minutes === 0, 'mismo instante → 0')
t(evaluarEdad({ desde: en(-18), hasta: BASE }).minutes === 18, '18 min de antigüedad → 18')
t(evaluarEdad({ desde: en(-120), hasta: BASE }).minutes === 120, '2 h de antigüedad → 120')

const fut2 = evaluarEdad({ desde: en(2), hasta: BASE })
t(fut2.minutes === 0 && fut2.state === TIEMPO.CLOCK_SKEW_TOLERATED, '+2 min al futuro dentro de tolerancia → 0 y CLOCK_SKEW_TOLERATED')
const fut60 = evaluarEdad({ desde: en(60), hasta: BASE })
t(fut60.state === TIEMPO.CLOCK_SKEW && fut60.minutes === null, '+1 h al futuro → CLOCK_SKEW, sin número')

t(evaluarEdad({ desde: Math.floor(BASE / 1000), hasta: BASE }).state === TIEMPO.UNIT_MISMATCH,
  'epoch en segundos donde se esperan ms → UNIT_MISMATCH, no una fecha de 1970')
t(evaluarEdad({ desde: 'no es fecha', hasta: BASE }).state === TIEMPO.UNREADABLE, 'fecha ilegible → UNREADABLE')

// EL BUG EXACTO, con sus números reales.
const skew = resolverAhora({ observed_at: '2026-09-19T05:59:42Z', now_ms: 1789718382736 })
t(skew.state === TIEMPO.CLOCK_SKEW, 'observed_at y now_ms con 22 h de desfase → CLOCK_SKEW')
t(skew.source === 'observed_at', 'ante el desacuerdo manda observed_at, no now_ms')
const reproducido = evaluarEdad({ desde: '2026-09-19T05:41:53Z', hasta: skew.ms })
t(reproducido.minutes === 18, 'con el reloj resuelto bien, la edad del bug pasa de -1302 a 18 min')

// LA INVARIANTE. Fuerza bruta sobre el rango completo.
let negativa = null
for (let m = -500; m <= 500; m += 7) {
  const r = evaluarEdad({ desde: en(m), hasta: BASE })
  if (typeof r.minutes === 'number' && r.minutes < 0) { negativa = m; break }
}
t(negativa === null, 'INVARIANTE age_minutes >= 0 en todo el rango', negativa !== null ? `falló en ${negativa} min` : '')
t(resolverAhora({ observed_at: '2026-09-19T06:00:00Z', now_ms: BASE }).state === TIEMPO.OK,
  'observed_at y now_ms coherentes → OK')

console.log('\n── el vigilante nunca declara sano un reloj roto ──')
const obsSkew = w('obs-skew.json', { observed_at: '2026-09-19T05:59:42Z', now_ms: 1789718382736,
  last_seen: { viva: '2026-09-19T05:41:53Z' } })
const sigSkew = w('sig-skew.json', { signals: [{ EXPECTED_SIGNAL: 'viva', SILENCE_THRESHOLD_MIN: 60, CURRENT_STATE: 'HEALTHY', owner: 'x' }] })
const rSkew = JSON.parse(correr(['absence', obsSkew, sigSkew]).out)
t(rSkew.signals[0].state === 'CLOCK_SKEW', 'con relojes en desacuerdo la señal es CLOCK_SKEW, jamás HEALTHY')
t(rSkew.signals.every(s => s.age_minutes === null || s.age_minutes >= 0), 'ninguna edad publicada es negativa')

// ═══════════════════════════════════════════════════════════════════════════
// FRESCURA — íntegro no es vigente
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── frescura: integridad ≠ vigencia ──')
const ahoraMs = Date.now()
const artSha = (sha, minAtras = 1) => ({ _kind: 'release-state', emitted_at: new Date(ahoraMs - minAtras * 60000).toISOString(),
  serving_sha_at_observation: sha, findings: [{ state: 'OK' }] })

t(evaluarFrescura(artSha('aaa'), { ahoraMs, servingSha: 'aaa' }).state === FRESCURA.CURRENT,
  'observado sobre el SHA que sirve → CURRENT')
t(evaluarFrescura(artSha('aaa'), { ahoraMs, servingSha: 'bbb' }).state === FRESCURA.STALE,
  'observado sobre otro SHA → STALE, aunque el artefacto esté íntegro')
t(evaluarFrescura(artSha('aaa'), { ahoraMs, servingSha: null }).state === FRESCURA.UNKNOWN,
  'sin saber qué SHA sirve producción → UNKNOWN_CURRENT_STATE, nunca CURRENT')
t(evaluarFrescura(artSha('aaa', 999), { ahoraMs, servingSha: 'aaa' }).state === FRESCURA.STALE,
  'dentro del SHA correcto pero fuera de su ventana → STALE')
t(evaluarFrescura({ _kind: 'signal-health', emitted_at: new Date(ahoraMs - 5 * 60000).toISOString(), findings: [] },
  { ahoraMs, servingSha: null }).state === FRESCURA.CURRENT,
  'un dominio no sensible al SHA no necesita conocerlo')

t(evaluarCobertura({ findings: [{ state: 'UNKNOWN' }, { state: 'UNKNOWN' }] }).state === 'INSUFFICIENT',
  'si nada pudo observarse la cobertura es INSUFFICIENT')
t(evaluarCobertura({ findings: [{ state: 'OK' }, { state: 'UNKNOWN' }] }).state === 'PARTIAL', 'cobertura a medias → PARTIAL')
t(veredictoDeRespuesta({ integrity: 'OK', freshness: FRESCURA.STALE, coverage: 'COMPLETE' }).usable === false,
  'una respuesta STALE no es utilizable aunque el artefacto esté íntegro')
t(veredictoDeRespuesta({ integrity: 'TAMPERED', freshness: FRESCURA.CURRENT, coverage: 'COMPLETE' }).usable === false,
  'una respuesta alterada no es utilizable aunque esté fresca')
t(veredictoDeRespuesta({ integrity: 'OK', freshness: FRESCURA.CURRENT, coverage: 'COMPLETE' }).state === 'CURRENT',
  'sólo con las tres pasa se llama CURRENT')

console.log('\n── el índice no publica un valor que no puede sostener ──')
const dirStale = mkdtempSync(join(tmpdir(), 'brain-stale-'))
writeFileSync(join(dirStale, 'release-state.json'), JSON.stringify(
  { artifact_kind: 'release-state', emitted_at: new Date().toISOString(),
    serving_sha_at_observation: 'viejo'.padEnd(40, '0'), what_shipped: { code_sha: 'viejo'.padEnd(40, '0') }, findings: [{ state: 'OK' }] }))
const idxStale = JSON.parse(correr(['index'], { BRAIN_OUT: dirStale, BRAIN_SERVING_SHA: 'nuevo'.padEnd(40, '0') }).out)
const fila = idxStale.questions.find(q => q.artifact === 'release-state')
t(fila.state === 'STALE', 'un artefacto de otro SHA se reporta STALE')
t(fila.answer === 'STALE' && fila.withheld_value, 'el valor obsoleto NO se publica como respuesta: se retiene y se dice por qué')
rmSync(dirStale, { recursive: true, force: true })

rmSync(dir, { recursive: true, force: true })
console.log(`\nautoprueba: ${ok}/${ok + fail} ${fail ? `· ${fail} fallo(s)` : 'OK'}`)
process.exit(fail ? 1 : 0)
