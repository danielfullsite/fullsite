/**
 * Aprendizaje reutilizable sin mezclar información de restaurantes.
 *
 * La base sólo activa una `policy_key`. El texto que llega al modelo vive aquí, se revisa
 * con código y no proviene de una conversación, corrección o dato comercial de un tenant.
 * Una lección requiere revisión humana y evaluación antes de marcarse `active`.
 */

export const POLITICAS_MAESTRAS = {
  evidence_before_conclusion: 'Antes de concluir, verifica que la evidencia cubra el dato y periodo preguntados.',
  distinguish_fact_inference: 'Separa con claridad el hecho observado, la inferencia razonable y el dato que falta.',
  declare_coverage_gap: 'Si una fuente no cubre el periodo o tema, dilo como cobertura insuficiente; nunca lo conviertas en cero.',
  intraday_same_hour: 'En un día o turno abierto, compara sólo contra el mismo avance horario de días equivalentes; nunca declares un cierre final.',
  ambiguous_reference: 'Cuando una referencia como "eso", "ellos" o "el de ayer" tenga más de un antecedente, pide una sola aclaración breve.',
  recommend_action: 'Da una siguiente acción concreta, segura y proporcional a la evidencia; no presentes una recomendación como hecho.',
  source_reconcile: 'Cuando cruces fuentes, declara cuál es la fuente primaria, el rango y cualquier diferencia o límite de conciliación.',
} as const

export type PoliticaMaestra = keyof typeof POLITICAS_MAESTRAS
export type EstadoLeccionMaestra = 'draft' | 'approved_for_staging' | 'active' | 'retired'

export interface LeccionMaestraRegistrada {
  policy_key: string
  status: EstadoLeccionMaestra
  policy_version: number
}

export interface CandidataLeccionMaestra {
  policy_key: PoliticaMaestra
  source_feedback_count: number
  source_client_count: number
  evaluation_cases: number
  reviewed_at: string | null
  reviewed_by: string | null
}

export function esPoliticaMaestra(value: string): value is PoliticaMaestra {
  return Object.prototype.hasOwnProperty.call(POLITICAS_MAESTRAS, value)
}

/** Sólo se inyectan políticas conocidas, activas y con una versión válida. */
export function politicasMaestrasActivas(rows: LeccionMaestraRegistrada[]): PoliticaMaestra[] {
  return rows
    .filter((row) => row.status === 'active' && Number.isInteger(row.policy_version) && row.policy_version > 0)
    .map((row) => row.policy_key)
    .filter(esPoliticaMaestra)
}

/**
 * Convierte la lista aprobada en reglas fijas para el prompt. Nada libre procedente de DB
 * se interpola: aunque un registro fuese mal editado, no puede inyectar una instrucción.
 */
export function marcoAprendizajeMaestro(rows: LeccionMaestraRegistrada[]): string {
  const policies = politicasMaestrasActivas(rows)
  if (!policies.length) return ''
  return `\nAPRENDIZAJE MAESTRO APROBADO (general, sin datos de otros restaurantes):\n${policies
    .map((key) => `- ${POLITICAS_MAESTRAS[key]}`)
    .join('\n')}`
}

/** Sólo propone staging; una señal de un tenant nunca activa una regla global. */
export function dictaminarLeccionMaestra(candidata: CandidataLeccionMaestra):
  | { estado: 'pendiente'; razones: string[] }
  | { estado: 'aprobada_para_staging'; razones: string[] } {
  const razones: string[] = []
  if (candidata.source_feedback_count < 10) razones.push('faltan al menos 10 señales agregadas')
  if (candidata.source_client_count < 3) razones.push('faltan al menos 3 restaurantes distintos')
  if (candidata.evaluation_cases < 20) razones.push('faltan al menos 20 casos de evaluación')
  if (!candidata.reviewed_at || !candidata.reviewed_by?.trim()) razones.push('falta revisión humana')
  if (razones.length) return { estado: 'pendiente', razones }
  return {
    estado: 'aprobada_para_staging',
    razones: ['puede probarse en staging; requiere promoción separada para activarse globalmente'],
  }
}
