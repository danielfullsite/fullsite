// Fullsite IQ — capa read-only + propuesta. Motor PURO.
//
// POR QUÉ
// El copiloto ya lee auto y ejecuta con confirmación. Falta la capa de IQ operativo: analiza un
// caso (SÓLO lectura), y si sugiere un cambio, lo entrega como PROPUESTA con preview/diff que un
// humano confirma. NADA se ejecuta aquí, y NADA de alto riesgo (compras/precios/horarios) se
// hace autónomo. La allowlist de casos ES el límite.

export type IqCaseId = 'agotados' | 'precios' | 'costos_cero' | 'turnos_abiertos' | 'anomalias'

export interface IqCase {
  id: IqCaseId
  label: string
  /** Siempre true: el caso ANALIZA, no cambia estado. */
  readOnly: true
  /** Riesgo del cambio que PODRÍA proponer (no que ejecute). */
  risk: 'low' | 'medium' | 'high'
}

// Los cinco casos por los que se empieza. Todos read-only. Precios/compras/horarios son de alto
// riesgo: se PROPONEN, nunca se ejecutan autónomamente.
export const IQ_CASES: IqCase[] = [
  { id: 'agotados', label: 'Agotados / puntos de reorden', readOnly: true, risk: 'low' },
  { id: 'costos_cero', label: 'Recetas con costo cero', readOnly: true, risk: 'low' },
  { id: 'turnos_abiertos', label: 'Turnos abiertos sin cierre', readOnly: true, risk: 'low' },
  { id: 'anomalias', label: 'Anomalías operativas', readOnly: true, risk: 'medium' },
  { id: 'precios', label: 'Precios fuera de rango', readOnly: true, risk: 'high' },
]

export function findIqCase(id: unknown): IqCase | null {
  if (typeof id !== 'string') return null
  return IQ_CASES.find((c) => c.id === id) ?? null
}

export interface DiffEntry { field: string; before: unknown; after: unknown }

/** Diff de sólo los campos que cambian, para preview. Determinista. */
export function buildDiff(before: Record<string, unknown>, after: Record<string, unknown>): DiffEntry[] {
  const b = before && typeof before === 'object' ? before : {}
  const a = after && typeof after === 'object' ? after : {}
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
  const out: DiffEntry[] = []
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ field: k, before: b[k], after: a[k] })
  }
  return out
}

export interface IqFinding {
  entity: string                 // qué (item, receta, turno…)
  summary: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>  // valor propuesto, si el caso sugiere un cambio
}

export interface IqProposedAction {
  kind: string
  target: string
  diff: DiffEntry[]
  risk: 'low' | 'medium' | 'high'
  /** Invariante: JAMÁS true. IQ no actúa solo. */
  autonomous: false
}

export interface IqProposal {
  caseId: IqCaseId
  readOnly: true
  findings: IqFinding[]
  proposedActions: IqProposedAction[]
  /** Siempre true: nada se aplica sin confirmación humana. */
  requiresConfirmation: true
}

/**
 * Construye una propuesta read-only para un caso a partir de hallazgos. Cada hallazgo con
 * `after` genera una acción PROPUESTA con su diff; ninguna es autónoma. Alto riesgo se marca,
 * no se ejecuta. Sin hallazgos → propuesta vacía (no se inventan acciones).
 */
export function buildProposal(caseId: IqCaseId, findings: IqFinding[]): IqProposal {
  const c = IQ_CASES.find((x) => x.id === caseId)
  const risk = c?.risk ?? 'high' // caso desconocido: se trata como alto riesgo (fail-safe)
  const list = Array.isArray(findings) ? findings : []
  const proposedActions: IqProposedAction[] = list
    .filter((f) => f.after && typeof f.after === 'object')
    .map((f) => ({
      kind: `propose.${caseId}`,
      target: f.entity,
      diff: buildDiff(f.before || {}, f.after || {}),
      risk,
      autonomous: false as const,
    }))
  return { caseId, readOnly: true, findings: list, proposedActions, requiresConfirmation: true }
}
