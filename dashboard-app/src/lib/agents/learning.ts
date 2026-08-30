// ─── Aprendizaje de los agentes — el veredicto humano cambia el comportamiento ──
//
// EL PROBLEMA QUE RESUELVE
// -----------------------
// Hasta el 2026-08-30 el ciclo estaba construido a medias: la página `/agentes` tenía los
// botones, existían `/api/agents/outcome`, `/ack`, `/metrics` y `/feedback`, y el esquema
// tenía `outcome: 'correct' | 'false_positive'`. Todo para MEDIR precisión.
//
// Lo que faltaba era lo otro: **ningún agente leía sus propios veredictos**. `outcome`
// aparecía en `lib/agents/` sólo dentro de `types.ts`, como definición de tipo. Aunque un
// restaurante marcara cien veces el mismo hallazgo como falso positivo, al día siguiente el
// agente lo volvía a emitir idéntico, con la misma confianza. Eso no es un agente que
// aprende: es uno que insiste.
//
// CÓMO FUNCIONA
// -------------
// Antes de guardar, cada hallazgo se pondera con el historial de SU MISMO `type` PARA ESE
// RESTAURANTE. La cuenta es directa:
//
//     confianza_ajustada = confianza_del_agente × precisión_histórica_de_ese_tipo
//
// Es la lectura bayesiana obvia: "qué tan seguro está el agente" por "cuántas veces este
// tipo de hallazgo resultó cierto aquí". Un tipo que acierta siempre no se toca; uno que
// falla seguido se hunde solo.
//
// POR QUÉ NO SE SUPRIME A LA PRIMERA
// ----------------------------------
// Un tipo marcado falso positivo tres veces puede ser real la cuarta. Suprimir en silencio
// sería repetir exactamente el pecado que costó nueve días de agentes muertos: convertir
// una decisión en una ausencia que nadie puede ver.
//
// Por eso el comportamiento por defecto es **degradar y explicar**, no callar. El hallazgo
// sigue apareciendo, con menos confianza y con una nota que dice cuántas veces se marcó mal.
// El operador ve el historial y decide él.
//
// Sólo se suprime en el caso extremo — nunca acertó, con muestra suficiente — y aun entonces
// queda registrado en `agent_runs.skip_reason`. Suprimido no es lo mismo que inexistente.

import type { AgentEvent, AgentId } from './types'

/** Veredictos acumulados de un `type` para un restaurante. */
export interface TypeVerdicts {
  correct: number
  false_positive: number
  /** correct / (correct + false_positive). null si nadie ha opinado todavía. */
  precision: number | null
}

/** Mínimo de veredictos para que el historial pese. Con menos, es anécdota, no señal. */
export const MIN_VERDICTS = 3

/** Con esta muestra y precisión 0 —nunca acertó ni una vez— el tipo se suprime. */
export const SUPPRESS_MIN_VERDICTS = 5

export type LearningDecision =
  | { action: 'keep'; event: AgentEvent }
  | { action: 'downgrade'; event: AgentEvent; from: number; to: number; verdicts: TypeVerdicts }
  | { action: 'suppress'; event: AgentEvent; verdicts: TypeVerdicts }

/**
 * Agrupa los veredictos por `type`.
 *
 * Sólo cuenta filas con `outcome` puesto: un hallazgo que nadie tocó no es evidencia de
 * nada. Tratar el silencio como "estuvo bien" inventaría precisión que no existe —
 * justamente lo que hace hoy que `precision_rate` sea 0/0 y no 100%.
 */
export function tallyVerdicts(
  rows: Array<{ type: string; outcome: string | null }>,
): Map<string, TypeVerdicts> {
  const out = new Map<string, TypeVerdicts>()
  for (const row of rows) {
    if (row.outcome !== 'correct' && row.outcome !== 'false_positive') continue
    const cur = out.get(row.type) ?? { correct: 0, false_positive: 0, precision: null }
    if (row.outcome === 'correct') cur.correct++
    else cur.false_positive++
    out.set(row.type, cur)
  }
  for (const v of out.values()) {
    const total = v.correct + v.false_positive
    v.precision = total > 0 ? v.correct / total : null
  }
  return out
}

/**
 * Decide qué hacer con un hallazgo a la luz de su historial.
 *
 * Nunca sube la confianza. Un tipo que acertó siempre se queda como lo dejó el agente: el
 * historial sirve para desconfiar, no para envalentonarse. Inflar confianza con una racha
 * corta es como creerle a un pronóstico porque atinó tres veces seguidas.
 */
export function decideWithHistory(event: AgentEvent, verdicts?: TypeVerdicts): LearningDecision {
  if (!verdicts) return { action: 'keep', event }

  const total = verdicts.correct + verdicts.false_positive
  if (total < MIN_VERDICTS || verdicts.precision === null) return { action: 'keep', event }

  // Nunca acertó, y ya hay muestra suficiente para afirmarlo.
  if (verdicts.precision === 0 && total >= SUPPRESS_MIN_VERDICTS) {
    return { action: 'suppress', event, verdicts }
  }

  if (verdicts.precision >= 1) return { action: 'keep', event }

  const ajustada = Math.round(event.confidence * verdicts.precision * 100) / 100
  const nota =
    `\n\nHistorial en este restaurante: de ${total} veces que se evaluó este tipo de hallazgo, ` +
    `${verdicts.correct} resultó certero y ${verdicts.false_positive} falso positivo. ` +
    `Por eso la confianza baja de ${event.confidence} a ${ajustada}.`

  return {
    action: 'downgrade',
    from: event.confidence,
    to: ajustada,
    verdicts,
    event: {
      ...event,
      confidence: ajustada,
      explanation: event.explanation + nota,
      evidence: {
        ...event.evidence,
        historial_aprendizaje: {
          certeros: verdicts.correct,
          falsos_positivos: verdicts.false_positive,
          precision: Math.round(verdicts.precision * 100) / 100,
          confianza_original: event.confidence,
        },
      },
    },
  }
}

/**
 * Aplica el historial a la tanda completa de hallazgos de un agente.
 *
 * Devuelve los que sobreviven y el detalle de lo que se degradó o suprimió, para que quien
 * llama pueda dejarlo en la bitácora. El resumen no es cosmético: es lo que permite
 * responder "¿por qué el agente dejó de avisarme de esto?" sin leer código.
 */
export function applyLearning(
  events: AgentEvent[],
  verdictsByType: Map<string, TypeVerdicts>,
): { events: AgentEvent[]; downgraded: number; suppressed: string[] } {
  const kept: AgentEvent[] = []
  const suppressed: string[] = []
  let downgraded = 0

  for (const e of events) {
    const d = decideWithHistory(e, verdictsByType.get(e.type))
    if (d.action === 'suppress') { suppressed.push(e.type); continue }
    if (d.action === 'downgrade') downgraded++
    kept.push(d.event)
  }
  return { events: kept, downgraded, suppressed }
}

/** Ventana del historial. 90 días: suficiente para tener señal, corto para que un cambio de operación se note. */
export const LEARNING_WINDOW_DAYS = 90

/** Query PostgREST de los veredictos de un agente en un restaurante. */
export function verdictsQuery(clientId: string, agentId: AgentId): string {
  const cutoff = new Date(Date.now() - LEARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  return (
    `client_id=eq.${encodeURIComponent(clientId)}&agent_id=eq.${agentId}` +
    `&outcome=not.is.null&created_at=gte.${cutoff}&select=type,outcome&limit=1000`
  )
}
