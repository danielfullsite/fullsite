/**
 * Contrato de la capa de decisión Jev — Fase 0 (shadow).
 *
 * Este archivo es la única fuente de los tipos que cruzan la capa. Cualquier
 * cambio incompatible sube `JEV_CONTRACT_VERSION` (regla OCM: nunca romper sin
 * versionar). La capa NO ejecuta acciones: todo lo que produce es una
 * recomendación con `executable: false`.
 */

export const JEV_CONTRACT_VERSION = 'jev-decision/0.1.0' as const

/** Único modelo permitido. No hay fallback a otro modelo: si no responde, se bloquea. */
export const JEV_MODEL_ID = 'typesafe-ai/jev' as const
export const JEV_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model' as const

/** Precio publicado en https://ai-gateway.vercel.sh/v1/models (2026-09-25): USD por token de entrada. Salida = 0. */
export const JEV_PRICE_PER_INPUT_TOKEN_USD = 0.000000042

/** Modo de operación. Fase 0 sólo admite shadow; 'autonomous' no existe a propósito. */
export type JevMode = 'shadow'

export type UseCase =
  | 'alert_priority'
  | 'incident_classification'
  | 'agent_routing'
  | 'task_done'
  | 'contradiction_check'

export const USE_CASES: readonly UseCase[] = [
  'alert_priority',
  'incident_classification',
  'agent_routing',
  'task_done',
  'contradiction_check',
]

/**
 * Autoridad de una recomendación.
 * - AUTO: clasificación, prioridad o routing sin efecto externo.
 * - HUMAN_REQUIRED: cualquier efecto comercial u operativo.
 * - FORBIDDEN: dinero, identidad, seguridad, deploy, migraciones, producción. Jev ni se consulta.
 */
export type Authority = 'AUTO' | 'HUMAN_REQUIRED' | 'FORBIDDEN'

/** Dominios que un estado puede declarar como afectados por la decisión. */
export type EffectDomain =
  | 'none'
  | 'commercial'
  | 'operational'
  | 'money'
  | 'identity'
  | 'security'
  | 'deploy'
  | 'migration'
  | 'production'

export const FORBIDDEN_DOMAINS: readonly EffectDomain[] = [
  'money',
  'identity',
  'security',
  'deploy',
  'migration',
  'production',
]

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical']

/** Valores escalares permitidos dentro de un estado redactado. */
export type StateScalar = string | number | boolean | null
export type StateValue = StateScalar | StateScalar[] | { [k: string]: StateValue }

/** Entrada a la capa. `state` debe venir ya redactado por el llamador; la capa lo vuelve a verificar. */
export interface DecisionInput {
  contract_version: typeof JEV_CONTRACT_VERSION
  use_case: UseCase
  /** Identificador opaco del tenant (p. ej. hash). Nunca un nombre ni slug legible. */
  tenant_ref: string
  /** Dominios que tocaría actuar sobre la recomendación. */
  effect_domains: EffectDomain[]
  state: { [k: string]: StateValue }
}

/** Decisión tipada, venga de reglas o de Jev. */
export interface Decision {
  /** Etiqueta elegida entre las opciones cerradas del caso de uso. */
  label: string
  /** 0..1. Para Jev: probabilidad de la opción elegida. Para reglas: fija por regla. */
  confidence: number
  risk: RiskLevel
  needs_human_review: boolean
}

export type DecisionSource = 'rules' | 'jev'

export type BlockReason =
  | 'jev_disabled'
  | 'credential_missing'
  | 'timeout'
  | 'http_error'
  | 'network_error'
  | 'invalid_response'
  | 'forbidden_authority'
  | 'input_rejected'
  | 'model_mismatch'

export interface JevOutcome {
  status: 'ok' | 'blocked'
  decision: Decision | null
  /** Distribución completa de Jev sobre las etiquetas, si la devolvió. Base del Brier score. */
  distribution: Record<string, number> | null
  block_reason: BlockReason | null
  /** Detalle sanitizado (sin cuerpo de respuesta completo ni credenciales). */
  detail: string | null
  latency_ms: number | null
  input_tokens: number | null
  cost_usd: number | null
  provider: string | null
  model: typeof JEV_MODEL_ID
}

/** Lo que sale de la capa. Nunca es ejecutable. */
/** 'invalid' sólo aparece cuando la entrada fue rechazada antes de saber su caso de uso. */
export type UseCaseOrInvalid = UseCase | 'invalid'

export interface Recommendation {
  contract_version: typeof JEV_CONTRACT_VERSION
  mode: JevMode
  executable: false
  use_case: UseCaseOrInvalid
  authority: Authority
  /** Política que se aplicó, para auditoría (p. ej. 'forbidden:money', 'auto', 'human:low_confidence'). */
  policy_applied: string[]
  input_hash: string
  /** En shadow la decisión vigente es SIEMPRE la de reglas. */
  effective: Decision | null
  effective_source: DecisionSource | null
  rules: Decision | null
  jev: JevOutcome
  agreement: 'agree' | 'disagree' | 'not_compared'
  /**
   * Lo que Jev habría cambiado si mandara (p. ej. 'jev:disagreement', 'jev:low_confidence').
   * Sólo informativo: `authority` y `policy_applied` dependen únicamente de la entrada y
   * de las reglas, para que la salida sea determinista con o sin Jev.
   */
  shadow_notes: string[]
}

export interface AuditRecord {
  seq: number
  ts: string
  prev_hash: string
  record_hash: string
  contract_version: typeof JEV_CONTRACT_VERSION
  use_case: UseCaseOrInvalid
  tenant_ref: string
  input_hash: string
  authority: Authority
  policy_applied: string[]
  model: typeof JEV_MODEL_ID
  provider: string | null
  latency_ms: number | null
  input_tokens: number | null
  cost_usd: number | null
  jev_status: JevOutcome['status']
  jev_block_reason: BlockReason | null
  jev_decision: Decision | null
  rules_decision: Decision | null
  effective_source: DecisionSource | null
  agreement: Recommendation['agreement']
  shadow_notes: string[]
}
