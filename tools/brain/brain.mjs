#!/usr/bin/env node
/**
 * CEREBRO OPERATIVO — capa de evidencia, sólo lectura. Fase 1.
 *
 * SUBCOMANDOS
 *   agents    <obs.json>              corre los siete agentes construibles
 *   absence   <obs.json> <señales>    evalúa las señales de ausencia
 *   field-cert open|close ...         abre o cierra una sesión de certificación
 *   release-emit <entrada.json>       emite el artefacto de release
 *   index     [pregunta]              contesta desde los artefactos emitidos
 *
 * LO QUE NO HACE, POR DISEÑO
 *   No se conecta a ninguna base. No maneja credenciales. No escribe en producto.
 *   No ejecuta acciones. Recibe observaciones que alguien más capturó en sólo
 *   lectura, igual que el guardián de esquema. Así el binario es probable sin
 *   entorno y no puede filtrar un secreto que nunca tuvo.
 *
 * LA REGLA QUE ATRAVIESA TODO
 *   La ausencia de evidencia no es salud. Donde no hay observación, el resultado
 *   es UNKNOWN con su motivo — nunca OK.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitir, leerTodos, ESTADOS } from './lib/artifact.mjs'
import { resolverAhora, evaluarEdad, TIEMPO } from './lib/tiempo.mjs'
import { evaluarFrescura, evaluarCobertura, veredictoDeRespuesta, politicaDe, FRESCURA } from './lib/frescura.mjs'
import { AGENTES } from './detectors.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.BRAIN_OUT || join(AQUI, 'out')
// Artefactos que emiten OTRAS herramientas y el cerebro debe poder resolver.
// Un índice que sólo indexa lo suyo no es un índice.
const EXTRA = (process.env.BRAIN_EXTRA || join(AQUI, '..', 'schema-drift')).split(':').filter(Boolean)
/**
 * Un artefacto ajeno se identifica por su campo `tool`, NO editándolo.
 *
 * El primer intento fue agregarle `artifact_kind` al informe del guardián de
 * esquema. El índice lo marcó TAMPERED en la siguiente corrida — su hash ya no
 * cuadraba. La comprobación de integridad funcionó contra su propio autor, y la
 * lección es la regla que este archivo ya declaraba: un artefacto se emite, no
 * se edita. Quien lo quiera indexar se adapta él.
 */
const tipoDe = (a) => a.artifact_kind ?? a.tool ?? null
const todosLosArtefactos = () =>
  [...leerTodos(OUT), ...EXTRA.flatMap(leerTodos)].map(a => ({ ...a, _kind: tipoDe(a) }))
/** Quita los campos del sobre, para que reemitir no los pise con undefined. */
const sinSobre = (a) => {
  const { artifact_kind, artifact_version, emitted_at, content_sha256, guarantees, _path, _integrity, ...resto } = a
  return resto
}
const arg = (n) => process.argv[n]
const leerJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const fallar = (m) => { console.error(`brain: ${m}`); process.exit(2) }

// ─── agents ─────────────────────────────────────────────────────────────────
function correrAgentes(rutaObs) {
  const obs = leerJson(rutaObs)
  const ctx = { artifacts: leerTodos(OUT), releaseArtifacts: leerTodos(OUT).filter(a => a.artifact_kind === 'release-state') }
  const salida = []
  for (const [id, agente] of Object.entries(AGENTES)) {
    if (id === 'AI_OPERATIONS_ANALYST') continue   // corre al final, sobre lo demás
    const findings = agente.run(obs[id] || {}, ctx)
    salida.push(emitir({
      kind: `agent-${id.toLowerCase().replace(/_/g, '-')}`,
      repoSha: obs.repo_sha ?? null, dbIdentity: obs.database_identity ?? null, outDir: OUT,
      body: {
        agent_id: id, level: agente.level, autonomy: 'read-only · no writes · no actions',
        observed_at: obs.observed_at ?? null,
        // Contra qué mundo se observó. Sin esto, un artefacto íntegro puede
        // contestar por un SHA que ya nadie sirve — que fue el defecto.
        observed_sha: obs.repo_sha ?? null,
        serving_sha_at_observation: obs.serving_sha ?? null,
        freshness_policy: politicaDe(`agent-${id.toLowerCase().replace(/_/g, '-')}`),
        findings,
        summary: contar(findings),
      },
    }))
  }
  // El analista interpreta lo que los demás observaron, nunca la base.
  const findings = AGENTES.AI_OPERATIONS_ANALYST.run({}, { artifacts: salida })
  salida.push(emitir({
    kind: 'agent-ai-operations-analyst', repoSha: obs.repo_sha ?? null, outDir: OUT,
    body: { agent_id: 'AI_OPERATIONS_ANALYST', level: 'L1', autonomy: 'read-only · interpreta, no es fuente de verdad',
      findings, summary: contar(findings) },
  }))
  return salida
}
const contar = (f) => f.reduce((m, x) => { m[x.state] = (m[x.state] || 0) + 1; return m }, {})

// ─── absence ────────────────────────────────────────────────────────────────
/**
 * El vigilante vive FUERA del emisor de cada señal: un agente caído no se
 * alerta a sí mismo. Por eso esto no consulta a nadie — evalúa la tabla de
 * expectativas contra lo último observado.
 */
function correrAusencia(rutaObs, rutaSenales) {
  const obs = leerJson(rutaObs)
  const spec = leerJson(rutaSenales)
  // `observed_at` manda; `now_ms` sólo vale si coincide. Cuando discrepan se
  // marca CLOCK_SKEW en vez de elegir uno en silencio: elegir en silencio es
  // cómo una observación con 22 h de desfase produjo señales «sanas».
  const ahora = resolverAhora(obs)
  const relojSospechoso = ahora.state !== TIEMPO.OK
  const evaluadas = spec.signals.map(s => {
    const visto = (obs.last_seen || {})[s.EXPECTED_SIGNAL]
    const umbralMin = s.SILENCE_THRESHOLD_MIN ?? null
    const base = { signal: s.EXPECTED_SIGNAL, owner: s.owner }
    if (s.CURRENT_STATE === 'NOT_INSTRUMENTED')
      return { ...base, state: 'NOT_INSTRUMENTED', reason: 'no existe emisor', last_seen: null, age_minutes: null }
    if (visto === undefined)
      return { ...base, state: ESTADOS.UNKNOWN, reason: 'no se observó esta señal en esta corrida', last_seen: null, age_minutes: null }
    if (visto === null)
      return { ...base, state: 'NEVER_SEEN', reason: 'el emisor existe y nunca produjo nada', last_seen: null, age_minutes: null, alert: true }
    const edad = evaluarEdad({ desde: visto, hasta: ahora.ms })
    if (edad.state === TIEMPO.UNREADABLE || edad.state === TIEMPO.UNIT_MISMATCH)
      return { ...base, state: ESTADOS.UNKNOWN, reason: edad.hint ?? 'fecha ilegible', last_seen: visto, age_minutes: null }
    // Una señal del futuro NUNCA es salud: la observación no es creíble.
    if (edad.state === TIEMPO.CLOCK_SKEW)
      return { ...base, state: 'CLOCK_SKEW', reason: edad.hint, last_seen: visto, age_minutes: null, alert: true }
    if (relojSospechoso)
      return { ...base, state: 'CLOCK_SKEW', reason: ahora.hint, last_seen: visto, age_minutes: edad.minutes, alert: true }
    if (umbralMin !== null && edad.minutes > umbralMin)
      return { ...base, state: 'SILENT', reason: `${edad.minutes} min sin señal (umbral ${umbralMin})`, last_seen: visto, age_minutes: edad.minutes, alert: true }
    return { ...base, state: 'HEALTHY', reason: `${edad.minutes} min desde la última`, last_seen: visto, age_minutes: edad.minutes,
      ...(edad.state === TIEMPO.CLOCK_SKEW_TOLERATED ? { note: edad.hint } : {}) }
  })
  // INVARIANTE del artefacto: ninguna edad publicada puede ser negativa.
  const negativas = evaluadas.filter(e => typeof e.age_minutes === 'number' && e.age_minutes < 0)
  if (negativas.length) throw new Error(`invariante rota: edad negativa en ${negativas.map(n => n.signal).join(', ')}`)
  const alertas = evaluadas.filter(e => e.alert)
  return emitir({
    kind: 'signal-health', repoSha: obs.repo_sha ?? null, outDir: OUT,
    body: {
      principle: 'La ausencia de evidencia NO es salud.',
      observed_at: obs.observed_at ?? null,
      observed_sha: obs.repo_sha ?? null,
      serving_sha_at_observation: obs.serving_sha ?? null,
      clock: { resolved_from: ahora.source ?? null, state: ahora.state, hint: ahora.hint ?? null },
      freshness_policy: politicaDe('signal-health'),
      signals: evaluadas,
      summary: evaluadas.reduce((m, e) => { m[e.state] = (m[e.state] || 0) + 1; return m }, {}),
      alerts: alertas.map(a => ({ signal: a.signal, reason: a.reason, owner: a.owner })),
    },
  })
}

// ─── field-cert ─────────────────────────────────────────────────────────────
/**
 * La sesión captura identidad SIN que nadie teclee. El único acto humano es
 * decir «empieza». Si un campo de identidad no se pudo capturar, se registra
 * como null y la sesión lo dice: no se inventa.
 */
function fieldCert(accion, rutaIdent) {
  if (accion === 'open') {
    const id = leerJson(rutaIdent)
    const faltantes = ['release_sha', 'tenant_id', 'terminal_id', 'actor_id'].filter(k => !id[k])
    const ts = new Date().toISOString()
    const sid = `fcert-${id.tenant_id || 'sin-tenant'}-${ts.replace(/[-:.]/g, '').slice(0, 15)}Z-${Math.random().toString(16).slice(2, 8)}`
    return emitir({
      kind: 'field-cert-session', repoSha: id.release_sha ?? null, outDir: OUT,
      body: {
        cert_session_id: sid, mode: 'FIELD_CERT', started_at: ts, ended_at: null,
        identity: {
          release_sha: id.release_sha ?? null, deployment_id: id.deployment_id ?? null,
          tenant_class: id.tenant_class ?? 'UNKNOWN', tenant_id: id.tenant_id ?? null,
          location_id: id.location_id ?? null, terminal_id: id.terminal_id ?? null,
          actor_id: id.actor_id ?? null, shift_id: null,
        },
        identity_capture: 'AUTOMATIC — ningún campo tecleado',
        observed_sha: id.release_sha ?? null,
        serving_sha_at_observation: id.serving_sha ?? null,
        freshness_policy: politicaDe('field-cert-session'),
        identity_incomplete: faltantes,
        preconditions_L0: id.preconditions_L0 ?? { satisfied: null, reason: 'no se evaluaron' },
        // Una sesión con identidad incompleta NO se bloquea: se marca. Bloquear
        // aquí dejaría a Daniel parado en la puerta por un dato que el software
        // debía capturar solo.
        state: faltantes.length ? 'OPEN_WITH_GAPS' : 'OPEN',
        physical_confirmations: [],
        not_observable_today: ['KDS_RECEIVED', 'OFFLINE_ENTERED', 'COMMAND_QUEUED', 'RECONNECT_DETECTED', 'QUEUE_DRAIN_STARTED', 'QUEUE_DRAINED'],
      },
    })
  }
  if (accion === 'close') {
    const ruta = join(OUT, 'field-cert-session.json')
    if (!existsSync(ruta)) fallar('no hay sesión abierta que cerrar')
    const s = leerJson(ruta)
    const conf = rutaIdent ? leerJson(rutaIdent) : { physical_confirmations: [] }
    const pend = (conf.physical_confirmations || []).filter(c => c.confirmed !== true)
    return emitir({
      kind: 'field-cert-artifact', repoSha: s.repo_sha ?? null, outDir: OUT,
      body: {
        // `artifact_kind: undefined` pisaba el del sobre y JSON.stringify lo
        // borraba: el artefacto salía SIN su propio tipo y el índice no lo
        // encontraba nunca. Lo descubrió el índice al devolver UNKNOWN.
        ...sinSobre(s), ended_at: new Date().toISOString(),
        physical_confirmations: conf.physical_confirmations || [],
        // Una confirmación no dada NO es false: es espera. Y la espera nunca es PASS.
        verdict: pend.length ? 'WAITING_PHYSICAL_CONFIRMATION'
               : s.identity_incomplete?.length ? 'INCOMPLETE' : 'PASS',
        verdict_reason: pend.length ? `${pend.length} confirmación(es) física(s) pendiente(s)`
               : s.identity_incomplete?.length ? `identidad incompleta: ${s.identity_incomplete.join(', ')}`
               : 'todas las observaciones y confirmaciones en regla',
      },
    })
  }
  fallar(`acción desconocida de field-cert: ${accion}`)
}

// ─── release-emit ───────────────────────────────────────────────────────────
function emitirRelease(rutaEntrada) {
  const e = leerJson(rutaEntrada)
  const falta = (v) => v === undefined || v === null || v === ''
  const desconocidos = []
  const campo = (k, v) => { if (falta(v)) desconocidos.push(k); return falta(v) ? 'UNKNOWN' : v }
  const body = {
    release_id: e.release_id || `rel-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`,
    what_shipped: {
      code_sha: campo('code_sha', e.code_sha),
      vercel_deployment_id: campo('vercel_deployment_id', e.vercel_deployment_id),
      p0a_final_sha: e.p0a_final_sha ?? 'UNKNOWN',
      p0a_still_ancestor: e.p0a_still_ancestor ?? 'UNKNOWN',
      migrations_applied: e.migrations_applied ?? [],
    },
    field_cert: { verdict: campo('field_cert_verdict', e.field_cert_verdict) },
    signal_health: { artifact: e.signal_health_artifact ?? 'UNKNOWN' },
    agent_activity: { agents_running: 0, actions_executed: 0, highest_level_in_use: 'L1' },
    unknown_fields: desconocidos,
    // Un artefacto con huecos se emite igual, y los declara. Callarlos sería la
    // única forma de que el artefacto mienta.
    evidence_complete: desconocidos.length === 0,
  }
  // UN VEREDICTO SIN MOTIVO ES UN ARTEFACTO MUDO.
  //
  // La versión anterior devolvía INCOMPLETE con `verdict_reason: ''` en cuanto
  // todos los campos traían evidencia pero nadie pasaba `verdict`. Quien leyera
  // el artefacto veía «INCOMPLETE» y ningún porqué — que es justo lo que este
  // cerebro existe para impedir. El veredicto se deriva ahora, siempre con su
  // razón, y EVIDENCE_COMPLETE no se confunde con certificado: la certificación
  // la sigue dando field_cert, no este emisor.
  const fc = body.field_cert.verdict
  if (desconocidos.length) {
    body.verdict = 'INCOMPLETE'
    body.verdict_reason = `${desconocidos.length} campo(s) sin evidencia: ${desconocidos.join(', ')}`
  } else if (fc === 'PASS') {
    body.verdict = e.verdict ?? 'EVIDENCE_COMPLETE'
    body.verdict_reason = e.verdict_reason || 'todos los campos tienen evidencia y la certificación de campo pasó'
  } else {
    body.verdict = e.verdict ?? 'INCOMPLETE'
    body.verdict_reason = e.verdict_reason || `todos los campos tienen evidencia, pero la certificación de campo está en ${fc}`
  }
  body.observed_sha = e.code_sha ?? null
  body.serving_sha_at_observation = e.serving_sha ?? null
  body.freshness_policy = politicaDe('release-state')
  return emitir({ kind: 'release-state', repoSha: e.code_sha ?? null, outDir: OUT, body })
}

// ─── index ──────────────────────────────────────────────────────────────────
const PREGUNTAS = [
  { q: '¿Qué SHA está sirviendo?', kind: 'release-state', pick: a => a.what_shipped?.code_sha },
  { q: '¿Está field-certified?', kind: 'field-cert-artifact', pick: a => a.verdict },
  { q: '¿Qué invariantes están pendientes?', kind: 'agent-cash-and-shift-guardian', pick: a => a.findings.filter(f => f.blocker).map(f => f.id).join(', ') || 'ninguno bloqueante' },
  { q: '¿Qué tablas tienen drift?', kind: 'schema-drift-guard', pick: a => `${a.summary?.by_state ? Object.entries(a.summary.by_state).map(([k, v]) => `${k}=${v}`).join(' · ') : 'UNKNOWN'}` },
  { q: '¿Qué terminal está muda?', kind: 'signal-health', pick: a => a.alerts?.map(x => x.signal).join(', ') || 'ninguna alerta' },
  { q: '¿Qué caminos saltan un contrato?', kind: 'agent-source-authority-guardian', pick: a => a.findings.filter(f => f.state === 'ALERT').map(f => f.id).join(', ') || 'ninguno' },
  { q: '¿Hay configuración peligrosa?', kind: 'agent-security-config-guardian', pick: a => a.findings.filter(f => f.state !== 'OK').map(f => f.id).join(', ') || 'ninguna' },
  { q: '¿Cuál es la salud de datos?', kind: 'agent-data-truth-guardian', pick: a => a.findings.filter(f => f.state !== 'OK').map(f => f.id).join(', ') || 'todos frescos' },
]
/**
 * El índice NO devuelve «el artefacto más reciente que existe».
 *
 * Ésa fue la regla equivocada: garantiza que siempre haya respuesta, y una
 * respuesta siempre disponible es peor que un «no se sabe». Se resuelve por
 * dominio + fecha + destino + SHA servido, y se evalúan las TRES preguntas
 * —integridad, frescura, cobertura— antes de llamar CURRENT a nada.
 */
function indice(filtro, opciones = {}) {
  const servingSha = opciones.servingSha ?? process.env.BRAIN_SERVING_SHA ?? null
  const ahoraMs = Date.now()
  const arts = todosLosArtefactos()
  const filas = PREGUNTAS.filter(p => !filtro || p.q.toLowerCase().includes(filtro.toLowerCase())).map(p => {
    const a = arts.find(x => x._kind === p.kind)
    if (!a) return { question: p.q, state: 'UNKNOWN', answer: 'UNKNOWN', why: `no existe el artefacto ${p.kind}`,
      artifact: null, as_of: null, integrity: null, freshness: null, coverage: null }
    const integrity = a._integrity ?? 'NO_VERIFICABLE'
    const fr = evaluarFrescura(a, { ahoraMs, servingSha })
    const co = evaluarCobertura(a)
    const v = veredictoDeRespuesta({ integrity, freshness: fr.state, coverage: co.state })
    return {
      question: p.q,
      state: v.state,
      // Una respuesta que no es utilizable NO se publica como dato: se publica
      // el motivo. Publicar el valor «sólo para informar» es cómo un stale se
      // cuela en una decisión.
      answer: v.usable ? String(p.pick(a) ?? 'UNKNOWN') : v.state,
      why: v.usable ? null : `${v.why} — ${fr.reason}`,
      artifact: p.kind, as_of: a.emitted_at ?? a.checked_at ?? 'SIN_FECHA',
      age_minutes: fr.age_minutes,
      integrity, freshness: fr.state, coverage: co.state,
      stale_after_min: fr.policy.stale_after_min, sha_sensitive: fr.policy.sha_sensitive,
      ...(v.usable ? {} : { withheld_value: String(p.pick(a) ?? 'UNKNOWN') }),
    }
  })
  return {
    serving_sha: servingSha ?? 'UNKNOWN',
    questions: filas,
    current: filas.filter(f => f.state === 'CURRENT').length,
    stale: filas.filter(f => f.state === 'STALE').length,
    unknown: filas.filter(f => f.state === 'UNKNOWN' || f.state === FRESCURA.UNKNOWN).length,
    total: filas.length,
  }
}

// ─── main ───────────────────────────────────────────────────────────────────
const cmd = arg(2)
if (!cmd) fallar('uso: brain.mjs agents|absence|field-cert|release-emit|index')
let r
if (cmd === 'agents') r = { emitted: correrAgentes(arg(3) || fallar('falta obs.json')).map(a => a.artifact_kind) }
else if (cmd === 'absence') r = correrAusencia(arg(3) || fallar('falta obs.json'), arg(4) || fallar('falta señales'))
else if (cmd === 'field-cert') r = fieldCert(arg(3), arg(4))
else if (cmd === 'release-emit') r = emitirRelease(arg(3) || fallar('falta entrada.json'))
else if (cmd === 'index') r = indice(arg(3), { servingSha: process.env.BRAIN_SERVING_SHA || null })
else fallar(`subcomando desconocido: ${cmd}`)
console.log(JSON.stringify(r, null, 2))
