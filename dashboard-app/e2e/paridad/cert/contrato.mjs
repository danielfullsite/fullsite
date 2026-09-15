// EVIDENCE CONTRACT v1 — el sobre.
//
// Un veredicto sin sobre es una opinión. El sobre dice QUÉ se certificó (el
// sello), QUÉ se hizo (los pasos), QUIÉN lo vio (los oráculos) y DÓNDE está la
// prueba (los artefactos). `REPORT.md` se deriva de aquí y nunca se escribe a
// mano: una sola fuente, o las dos se contradicen y no se sabe cuál mintió.
//
// ── EL MODELO DE CORRELACIÓN ────────────────────────────────────────────────
// `run_id` es la raíz y existe ANTES de que exista cualquier orden. Todo lo
// demás son hijos que se ENLAZAN cuando aparecen:
//
//   run_id  ──┬── save_operation_id   (nace al guardar)
//             ├── order_id
//             ├── turno_id
//             └── pedro_seq           (before/after)
//
// La versión anterior de este diseño usaba `save_operation_id` como llave
// universal. No puede serlo: el journey arranca en el PIN, y ahí todavía no
// hay orden que identificar.

import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const CONTRACT_VERSION = '1.0'

/** `cert-g01-<timestamp>-<random>`. Ordenable, único, legible. */
export function nuevoRunId(journeyId = 'g01') {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `cert-${journeyId.toLowerCase()}-${ts}-${randomBytes(3).toString('hex')}`
}

/** Un sobre vacío, con las secciones que v1 exige. */
export function nuevoSobre({ runId, journeyId = 'G01', nombre = '' }) {
  return {
    contract_version: CONTRACT_VERSION,
    journey_id: journeyId,
    journey_nombre: nombre,
    run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: null,
    verdict: null,
    verdict_razon: null,
    identity: null,
    preconditions_satisfied: null,
    fixture: null,
    driver: { executed: null, steps_total: null, steps_ok: null },
    correlation: { run_id: runId, save_operation_id: null, order_id: null, turno_id: null,
                   pedro_seq_inicial: null, pedro_seq_final: null },
    steps: [],
    oracles: {},                // db / pedro / kds — los llena la fase SANDBOX
    visual_evidence: { capturas: 0, trazas: 0, archivos: [] },
    sandbox: { modo: null, tenant: null, writes: 0, violations: 0, detalle_violaciones: [] },
    parity: null,
    mutation: null,
    manifest_effects: null,
    observations: [],
    summary: null,
    artifacts_dir: null,
  }
}

/**
 * Registra una observación y devuelve su clase. Es el ÚNICO camino por el que
 * algo entra al sobre: si no pasó por aquí, no cuenta para el veredicto.
 */
export function observar(sobre, { id, fase, descripcion, esperado, observado, clase, evidencia = null }) {
  sobre.observations.push({
    id, fase, descripcion,
    esperado: normalizarValor(esperado),
    observado: normalizarValor(observado),
    classification: clase,
    evidence: evidencia,
  })
  return clase
}

/** Nada de payloads completos en el acta: lo que se compara, no todo lo que pasó. */
function normalizarValor(v) {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…' : v
  if (typeof v !== 'object') return v
  const s = JSON.stringify(v)
  return s.length > 400 ? JSON.parse(JSON.stringify(v, replacerCorto)) : v
}
function replacerCorto(k, v) {
  return typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL VALIDADOR — un sobre mal formado no se acepta
   ───────────────────────────────────────────────────────────────────────────
   Se le pide que FALLE ante sus propios defectos, no sólo que apruebe los
   sobres buenos. Un validador que nunca rechaza nada no valida.
   ═══════════════════════════════════════════════════════════════════════════ */

const OBLIGATORIAS = ['contract_version', 'journey_id', 'run_id', 'started_at', 'verdict',
  'identity', 'preconditions_satisfied', 'driver', 'correlation', 'steps', 'oracles',
  'observations', 'summary']

export function validar(sobre) {
  const faltas = []
  const F = (regla, motivo) => faltas.push({ regla, motivo })

  if (!sobre || typeof sobre !== 'object') return [{ regla: 'V-0', motivo: 'el sobre no es un objeto' }]

  for (const k of OBLIGATORIAS) {
    if (sobre[k] === undefined) F('V-1', `falta la sección obligatoria «${k}»`)
  }
  if (sobre.contract_version !== CONTRACT_VERSION) F('V-2', `contract_version debe ser ${CONTRACT_VERSION}`)
  if (!/^cert-[a-z0-9]+-\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(sobre.run_id || '')) {
    F('V-3', `run_id mal formado: «${sobre.run_id}»`)
  }
  if (!['PASS', 'FAIL', 'PRECONDITION_FAILURE'].includes(sobre.verdict)) {
    F('V-4', `verdict inválido: «${sobre.verdict}»`)
  }
  if (sobre.correlation && sobre.correlation.run_id !== sobre.run_id) {
    F('V-5', 'correlation.run_id no coincide con run_id — el árbol de correlación está roto')
  }
  if (!Array.isArray(sobre.observations) || sobre.observations.length === 0) {
    F('V-6', 'un sobre sin observaciones no puede sostener un veredicto')
  }

  // V-7 · La regla dura: NOT_OBSERVED jamás convive con PASS.
  const clases = (sobre.observations || []).map(o => o.classification)
  if (sobre.verdict === 'PASS' && clases.some(c => c !== 'EXPECTED_BEHAVIOR')) {
    F('V-7', `PASS con observaciones no conformes: ${[...new Set(clases.filter(c => c !== 'EXPECTED_BEHAVIOR'))].join(', ')}`)
  }
  // V-8 · PASS exige que el driver haya ejecutado. Dos corridas vacías son
  //       idénticas, y eso no dice nada del sistema.
  if (sobre.verdict === 'PASS' && sobre.driver?.executed !== true) {
    F('V-8', 'PASS sin driver.executed === true')
  }
  // V-9 · Precondiciones no satisfechas ⇒ el veredicto sólo puede ser
  //       PRECONDITION_FAILURE. Impuesto, no recomendado.
  if (sobre.preconditions_satisfied === false && sobre.verdict !== 'PRECONDITION_FAILURE') {
    F('V-9', `preconditions_satisfied=false exige verdict=PRECONDITION_FAILURE, no «${sobre.verdict}»`)
  }
  // V-10 · PASS exige 5/5 mutaciones detectadas. Una mutación no aplicable no
  //        es un aprobado: es una categoría de efectos que nadie está mirando.
  if (sobre.verdict === 'PASS') {
    const m = sobre.mutation
    if (!m || m.detected !== m.total || m.total === 0) {
      F('V-10', `PASS exige mutaciones detectadas === total (>0); llegó ${m?.detected}/${m?.total}`)
    }
    if (m?.no_aplicables?.length) {
      F('V-10', `mutaciones no aplicables: ${m.no_aplicables.join(', ')} — categorías sin observar`)
    }
  }
  // V-11 · PASS exige los 6 pasos.
  if (sobre.verdict === 'PASS' && sobre.driver?.steps_ok !== sobre.driver?.steps_total) {
    F('V-11', `PASS exige todos los pasos; llegó ${sobre.driver?.steps_ok}/${sobre.driver?.steps_total}`)
  }

  /* ── V-12 · LOS TRES ORÁCULOS ────────────────────────────────────────────
     El manifiesto dice qué INTENTÓ el POS; un oráculo dice qué QUEDÓ. Sin los
     tres, un PASS sólo afirma que el journey emitió las peticiones correctas —
     que es precisamente lo que el arnés viejo ya sabía hacer y no alcanzaba.

     `null`, `NOT_OBSERVED` y «no aplicable» valen igual: no se miró. */
  const ORACULOS = ['db', 'pedro', 'kds']
  if (sobre.verdict === 'PASS') {
    for (const o of ORACULOS) {
      const r = sobre.oracles?.[o]
      if (!r) { F('V-12', `PASS sin el oráculo «${o}»`); continue }
      if (r.classification !== 'EXPECTED_BEHAVIOR') {
        F('V-12', `el oráculo «${o}» no confirmó: ${r.classification}${r.motivo ? ` — ${r.motivo}` : ''}`)
      }
    }
  }

  /* ── V-13 · EVIDENCIA VISUAL ─────────────────────────────────────────────
     Un PASS que nadie puede volver a mirar no se puede auditar después. El
     mínimo es antes y después del journey; el arnés captura por paso. Cero
     capturas nunca es un aprobado. */
  if (sobre.verdict === 'PASS') {
    const n = sobre.visual_evidence?.capturas ?? 0
    if (n < 2) F('V-13', `PASS exige al menos 2 capturas (antes/después); llegó ${n}`)
  }

  /* ── V-14 · NI UNA ESCRITURA FUERA DEL LABORATORIO ───────────────────────
     El guardia de SANDBOX anota cada intento que bloqueó. Que haya bloqueado
     bien no vuelve inocuo el intento: significa que el journey trató de tocar
     un tenant que no le toca, y eso se investiga antes de certificar nada. */
  const violaciones = sobre.sandbox?.violations ?? 0
  if (sobre.verdict === 'PASS' && violaciones > 0) {
    F('V-14', `el guardia bloqueó ${violaciones} escritura(s) fuera del laboratorio`)
  }
  return faltas
}

/** Escribe el sobre y devuelve su ruta. El directorio se decide afuera. */
export function escribir(sobre, dir) {
  mkdirSync(dir, { recursive: true })
  sobre.artifacts_dir = dir
  const ruta = join(dir, 'run.json')
  writeFileSync(ruta, JSON.stringify(sobre, null, 2))
  return ruta
}
