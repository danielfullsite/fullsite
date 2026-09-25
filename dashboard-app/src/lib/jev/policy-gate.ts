/**
 * Policy gate de la capa Jev.
 *
 * Dos momentos:
 *  - ANTES de consultar a nadie: si la decisión toca un dominio prohibido, la
 *    autoridad es FORBIDDEN y Jev ni siquiera se llama. Tampoco se emite regla.
 *  - DESPUÉS: la autoridad sólo puede SUBIR (AUTO → HUMAN_REQUIRED), nunca bajar,
 *    y sólo con base en las reglas. En shadow, Jev NO mueve la autoridad: lo que
 *    habría escalado se anota aparte (`shadowNotes`), para que la salida sea la
 *    misma con Jev disponible, caído o apagado.
 */
import type { Authority, Decision, DecisionInput } from './contract'
import { FORBIDDEN_DOMAINS } from './contract'
import { USE_CASE_SPECS } from './use-cases'

/** Debajo de esto, cualquier decisión de reglas pide revisión humana. */
export const MIN_AUTO_CONFIDENCE = 0.7

export interface GateResult {
  authority: Authority
  policy: string[]
}

export function preGate(input: DecisionInput): GateResult {
  const forbidden = input.effect_domains.filter((d) => FORBIDDEN_DOMAINS.includes(d))
  if (forbidden.length > 0) {
    return { authority: 'FORBIDDEN', policy: forbidden.map((d) => `forbidden:${d}`) }
  }
  const spec = USE_CASE_SPECS[input.use_case]
  const policy: string[] = []
  let authority: Authority = spec.base_authority
  if (authority === 'HUMAN_REQUIRED') policy.push(`human:use_case:${input.use_case}`)
  for (const d of input.effect_domains) {
    if (d === 'commercial' || d === 'operational') {
      authority = 'HUMAN_REQUIRED'
      policy.push(`human:effect:${d}`)
    }
  }
  // Piso por contenido: FORBIDDEN depende de lo que declara el llamador; esto evita que un
  // estado claramente sensible salga AUTO aunque el llamador haya declarado ['none'].
  const floor = spec.sensitive?.(input.state)
  if (floor) {
    authority = 'HUMAN_REQUIRED'
    policy.push(`human:sensitive_state:${floor}`)
  }
  if (authority === 'AUTO') policy.push('auto:no_external_effect')
  return { authority, policy: dedupe(policy) }
}

/** Escalamiento posterior basado SÓLO en la decisión de reglas. */
export function postGate(pre: GateResult, rules: Decision | null): GateResult {
  if (pre.authority === 'FORBIDDEN') return pre
  const policy = [...pre.policy]
  let authority: Authority = pre.authority
  const escalate = (why: string) => {
    authority = 'HUMAN_REQUIRED'
    policy.push(`human:${why}`)
  }
  if (!rules) escalate('no_decision')
  else {
    if (rules.confidence < MIN_AUTO_CONFIDENCE) escalate('low_confidence')
    if (rules.needs_human_review) escalate('review_flag')
    if (rules.risk === 'critical') escalate('risk_critical')
  }
  return { authority, policy: dedupe(policy) }
}

/** Qué habría escalado Jev. Informativo: nunca se aplica a la autoridad en shadow. */
export function shadowNotes(rules: Decision | null, jev: Decision | null): string[] {
  if (!jev) return []
  const notes: string[] = []
  if (jev.confidence < MIN_AUTO_CONFIDENCE) notes.push('jev:low_confidence')
  if (jev.needs_human_review) notes.push('jev:review_flag')
  if (jev.risk === 'critical') notes.push('jev:risk_critical')
  if (rules && jev.label !== rules.label) notes.push('jev:disagreement')
  return notes
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}
