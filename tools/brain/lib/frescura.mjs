// Frescura — un artefacto íntegro puede estar obsoleto.
//
// ── EL DEFECTO ──────────────────────────────────────────────────────────────
// El índice contestó «¿qué SHA está sirviendo?» con `7ae2745b` porque era el
// artefacto más reciente que existía. Producción servía `de435f5d`. El artefacto
// estaba íntegro —su hash cuadraba— y era falso. **Integridad no es vigencia.**
//
// Y elegir «el más reciente que existe» es justo la regla equivocada: garantiza
// que el índice siempre conteste algo, que es peor que contestar «no se sabe».
//
// ── TRES PREGUNTAS DISTINTAS ────────────────────────────────────────────────
//   INTEGRITY  ¿alguien lo alteró?            → OK | TAMPERED | UNSIGNED
//   FRESHNESS  ¿representa el mundo de hoy?   → CURRENT | STALE | UNKNOWN_CURRENT_STATE
//   COVERAGE   ¿observó todo lo necesario?    → COMPLETE | PARTIAL | INSUFFICIENT
//
// Una respuesta sólo es CURRENT cuando las tres pasan.

import { evaluarEdad, TIEMPO } from './tiempo.mjs'

export const FRESCURA = Object.freeze({
  CURRENT: 'CURRENT', STALE: 'STALE', UNKNOWN: 'UNKNOWN_CURRENT_STATE',
})
export const COBERTURA = Object.freeze({
  COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', INSUFFICIENT: 'INSUFFICIENT',
})

/**
 * Política por dominio: cuánto vive una observación y si depende del SHA servido.
 *
 * `sha_sensitive` marca los dominios cuya respuesta deja de valer en cuanto
 * cambia el código desplegado. La deriva de esquema NO lo es —el esquema no
 * cambia por un deploy de front—; el estado de release sí.
 */
export const POLITICA = {
  'release-state':                    { stale_after_min: 60,    sha_sensitive: true },
  'field-cert-artifact':              { stale_after_min: 1440,  sha_sensitive: true },
  'field-cert-session':               { stale_after_min: 720,   sha_sensitive: true },
  'signal-health':                    { stale_after_min: 60,    sha_sensitive: false },
  'schema-drift-guard':               { stale_after_min: 1440,  sha_sensitive: false },
  'agent-release-guardian':           { stale_after_min: 60,    sha_sensitive: true },
  'agent-cash-and-shift-guardian':    { stale_after_min: 120,   sha_sensitive: false },
  'agent-source-authority-guardian':  { stale_after_min: 1440,  sha_sensitive: true },
  'agent-security-config-guardian':   { stale_after_min: 720,   sha_sensitive: false },
  'agent-data-truth-guardian':        { stale_after_min: 1440,  sha_sensitive: false },
  'agent-incident-triage-agent':      { stale_after_min: 1440,  sha_sensitive: false },
  'agent-ai-operations-analyst':      { stale_after_min: 120,   sha_sensitive: false },
}
export const politicaDe = (kind) => POLITICA[kind] ?? { stale_after_min: null, sha_sensitive: false }

/**
 * ¿Este artefacto puede contestar por el estado ACTUAL?
 *
 * `servingSha` es el SHA que produccón sirve HOY. Si no se conoce, ningún
 * dominio sensible al SHA puede declararse CURRENT: se devuelve
 * UNKNOWN_CURRENT_STATE, que es la respuesta honesta.
 */
export function evaluarFrescura(art, { ahoraMs, servingSha = null }) {
  const kind = art._kind ?? art.artifact_kind ?? art.tool ?? null
  const pol = politicaDe(kind)
  const sello = art.emitted_at ?? art.checked_at ?? null
  const edad = evaluarEdad({ desde: sello, hasta: ahoraMs })

  if (edad.state === TIEMPO.UNREADABLE)
    return { state: FRESCURA.UNKNOWN, reason: 'el artefacto no trae fecha legible', age_minutes: null, policy: pol }
  if (edad.state === TIEMPO.CLOCK_SKEW)
    return { state: FRESCURA.UNKNOWN, reason: edad.hint, age_minutes: null, policy: pol }

  if (pol.sha_sensitive) {
    if (!servingSha)
      return { state: FRESCURA.UNKNOWN, reason: 'no se conoce el SHA que sirve producción', age_minutes: edad.minutes, policy: pol }
    const observado = art.serving_sha_at_observation ?? art.observed_sha ?? art.repo_sha ?? null
    if (!observado)
      return { state: FRESCURA.UNKNOWN, reason: 'el artefacto no declara contra qué SHA se observó', age_minutes: edad.minutes, policy: pol }
    if (observado !== servingSha)
      return { state: FRESCURA.STALE, reason: `observado sobre ${observado.slice(0, 8)}, producción sirve ${servingSha.slice(0, 8)}`,
        age_minutes: edad.minutes, policy: pol }
  }

  if (pol.stale_after_min !== null && edad.minutes > pol.stale_after_min)
    return { state: FRESCURA.STALE, reason: `${edad.minutes} min de antigüedad (política: ${pol.stale_after_min})`,
      age_minutes: edad.minutes, policy: pol }

  return { state: FRESCURA.CURRENT, reason: `${edad.minutes} min`, age_minutes: edad.minutes, policy: pol }
}

/**
 * Cobertura: ¿el artefacto observó lo suficiente para que su respuesta valga?
 * Un artefacto con hallazgos UNKNOWN contesta a medias, y hay que decirlo.
 */
export function evaluarCobertura(art) {
  const f = art.findings ?? []
  if (f.length === 0) return { state: COBERTURA.PARTIAL, reason: 'el artefacto no trae hallazgos' }
  const desconocidos = f.filter(x => x.state === 'UNKNOWN').length
  if (desconocidos === f.length) return { state: COBERTURA.INSUFFICIENT, reason: 'ningún hallazgo pudo observarse' }
  if (desconocidos > 0) return { state: COBERTURA.PARTIAL, reason: `${desconocidos} de ${f.length} hallazgos sin observar` }
  return { state: COBERTURA.COMPLETE, reason: `${f.length} hallazgos observados` }
}

/** Una respuesta es utilizable sólo si las tres preguntas pasan. */
export function veredictoDeRespuesta({ integrity, freshness, coverage }) {
  if (integrity === 'TAMPERED') return { usable: false, state: 'TAMPERED', why: 'el artefacto fue alterado' }
  if (freshness === FRESCURA.STALE) return { usable: false, state: 'STALE', why: 'el artefacto no representa el estado actual' }
  if (freshness === FRESCURA.UNKNOWN) return { usable: false, state: FRESCURA.UNKNOWN, why: 'no se puede saber si representa el estado actual' }
  if (coverage === COBERTURA.INSUFFICIENT) return { usable: false, state: 'INSUFFICIENT_COVERAGE', why: 'no se observó nada' }
  return { usable: true, state: 'CURRENT', why: null }
}
