/**
 * Catálogo de casos de uso: esquema permitido del estado, opciones cerradas,
 * reglas deterministas locales y preguntas tipadas para Jev.
 *
 * El esquema es una allowlist: no hay campos de texto libre. Todo string es un
 * valor de enumeración conocido. Eso cierra dos puertas a la vez: no entra PII
 * y no entra una instrucción inyectada (ver THREAT-MODEL §T2).
 */
import type { Authority, Decision, RiskLevel, StateValue, UseCase } from './contract'
import { RISK_LEVELS } from './contract'

export type FieldSpec =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'nullable_bool' }
  | { kind: 'nullable_int'; min: number; max: number }
  | { kind: 'object'; fields: Record<string, FieldSpec> }

export type StateSchema = Record<string, FieldSpec>

/** Pregunta en el formato de la especificación v4 de evaluation-model del AI SDK. */
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: (string | null)[] }
  | { type: 'boolean'; instructions: string; criteria?: { true?: string | null; false?: string | null } }

export interface UseCaseSpec {
  use_case: UseCase
  /** Autoridad mínima del caso, antes de mirar los dominios de efecto. */
  base_authority: Exclude<Authority, 'FORBIDDEN'>
  schema: StateSchema
  /** Opciones cerradas y su descripción; son los `criteria` de la pregunta choice. */
  labels: Record<string, string>
  decisionInstructions: string
  rules: (state: Record<string, StateValue>) => Decision
  /** Si el estado toca algo sensible, devuelve el motivo y la autoridad no puede ser AUTO. */
  sensitive?: (state: Record<string, StateValue>) => string | null
}

// Nombres de las preguntas que se mandan a Jev. Constantes: nunca vienen del estado.
export const Q_DECISION = 'decision'
export const Q_RISK = 'risk'
export const Q_REVIEW = 'needs_human_review'

const RISK_CRITERIA: string[] = [
  'low: no customer or revenue impact',
  'medium: minor degradation, workaround exists',
  'high: service degraded for guests or staff now',
  'critical: service is down or data may be lost',
]

export function buildJevQuestions(spec: UseCaseSpec): Record<string, JevQuestion> {
  return {
    [Q_DECISION]: { type: 'choice', instructions: spec.decisionInstructions, criteria: { ...spec.labels } },
    [Q_RISK]: { type: 'score', instructions: 'Operational risk of this situation for a restaurant.', criteria: [...RISK_CRITERIA] },
    [Q_REVIEW]: {
      type: 'boolean',
      instructions: 'Should a human review this before anyone acts on it?',
      criteria: { true: 'a person must look at it', false: 'safe to route automatically' },
    },
  }
}

const n = (v: StateValue): number => (typeof v === 'number' ? v : 0)
const obj = (v: StateValue): Record<string, StateValue> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, StateValue>) : {}

function d(label: string, confidence: number, risk: RiskLevel, needs_human_review: boolean): Decision {
  return { label, confidence, risk, needs_human_review }
}

// ─── 1. Priorización de alertas ────────────────────────────────────────────────

const alertPriority: UseCaseSpec = {
  use_case: 'alert_priority',
  base_authority: 'AUTO',
  schema: {
    alert_kind: {
      kind: 'enum',
      values: [
        'pos_offline',
        'kds_heartbeat_missing',
        'print_queue_stuck',
        'sync_backlog',
        'delivery_webhook_error',
        'low_stock',
        'telemetry_silent',
      ],
    },
    minutes_active: { kind: 'int', min: 0, max: 100_000 },
    affected_terminals: { kind: 'int', min: 0, max: 1_000 },
    open_orders: { kind: 'int', min: 0, max: 10_000 },
    service_hours: { kind: 'bool' },
    repeats_24h: { kind: 'int', min: 0, max: 10_000 },
  },
  labels: {
    P0: 'service is down right now; page someone immediately',
    P1: 'degraded; must be handled this shift',
    P2: 'can wait until the next business day',
    P3: 'informational only',
  },
  decisionInstructions: 'Assign an operational priority to this restaurant system alert.',
  rules(s) {
    const kind = s.alert_kind
    const svc = s.service_hours === true
    const mins = n(s.minutes_active)
    if (kind === 'pos_offline') return svc ? d('P0', 0.95, 'critical', false) : d('P2', 0.8, 'medium', false)
    if (kind === 'kds_heartbeat_missing') {
      if (svc && n(s.open_orders) > 0 && mins >= 5) return d('P0', 0.9, 'critical', false)
      return svc ? d('P1', 0.8, 'high', false) : d('P3', 0.75, 'low', false)
    }
    if (kind === 'print_queue_stuck') return svc && mins >= 3 ? d('P1', 0.85, 'high', false) : d('P2', 0.75, 'medium', false)
    if (kind === 'sync_backlog') return mins >= 30 ? d('P1', 0.8, 'high', false) : d('P2', 0.75, 'medium', false)
    if (kind === 'delivery_webhook_error') return svc ? d('P1', 0.8, 'high', false) : d('P2', 0.75, 'medium', false)
    if (kind === 'low_stock') return d('P2', 0.8, 'medium', false)
    // Guardián mudo: un silencio de un día entero no es "informativo" (project_guardian_mudo_patron).
    if (kind === 'telemetry_silent') return mins >= 1_440 ? d('P1', 0.8, 'high', true) : d('P3', 0.7, 'low', false)
    return d('P2', 0.3, 'medium', true)
  },
}

// ─── 2. Clasificación de incidentes (§5 del protocolo) ─────────────────────────

const incidentClassification: UseCaseSpec = {
  use_case: 'incident_classification',
  base_authority: 'AUTO',
  schema: {
    symptom: {
      kind: 'enum',
      values: [
        'crash',
        'http_error',
        'test_fails_code_unchanged',
        'schema_mismatch',
        'missing_env',
        'works_locally_fails_ci',
        'intermittent',
        'silent_failure',
      ],
    },
    component: { kind: 'enum', values: ['pos', 'kds', 'print', 'sync', 'auth', 'delivery', 'dashboard', 'ci'] },
    http_status: { kind: 'nullable_int', min: 100, max: 599 },
    reproducible_locally: { kind: 'bool' },
    after_recent_change: { kind: 'bool' },
    affected_tenants: { kind: 'int', min: 0, max: 100_000 },
  },
  labels: {
    regression: 'a real regression introduced by a code change',
    stale_test: 'the test expectation is outdated; product behavior is correct',
    contract_changed: 'an upstream contract or schema changed',
    configuration: 'misconfiguration: environment variables, flags, credentials',
    environment: 'difference between environments (CI, device, network)',
    field_only: 'only reproducible on physical hardware in the restaurant',
  },
  decisionInstructions: 'Classify the root-cause category of this software incident.',
  // Credenciales o autenticación rozan el dominio de seguridad: nunca AUTO.
  sensitive: (s) => (s.component === 'auth' ? 'auth' : s.symptom === 'missing_env' ? 'missing_env' : null),
  rules(s) {
    const sym = s.symptom
    const comp = s.component
    if (sym === 'test_fails_code_unchanged') return d('stale_test', 0.8, 'low', true)
    if (sym === 'schema_mismatch') return d('contract_changed', 0.85, 'high', false)
    if (sym === 'missing_env') return d('configuration', 0.9, 'high', false)
    if (sym === 'works_locally_fails_ci') return d('environment', 0.8, 'medium', false)
    if (s.reproducible_locally === false && (comp === 'print' || comp === 'kds' || comp === 'pos'))
      return d('field_only', 0.7, 'high', true)
    if (comp === 'auth' && (s.http_status === 401 || s.http_status === 403) && s.after_recent_change !== true)
      return d('configuration', 0.7, 'high', true)
    if (s.after_recent_change === true && s.reproducible_locally === true) return d('regression', 0.85, 'high', false)
    return d('regression', 0.4, 'medium', true)
  },
}

// ─── 3. Selección de agente o cola ─────────────────────────────────────────────

const agentRouting: UseCaseSpec = {
  use_case: 'agent_routing',
  base_authority: 'AUTO',
  schema: {
    task_kind: {
      kind: 'enum',
      values: ['ui', 'offline', 'pos_flow', 'kds', 'printing', 'delivery_integration', 'data_query', 'docs', 'security', 'infra'],
    },
    files_touched: { kind: 'int', min: 0, max: 10_000 },
    needs_field_validation: { kind: 'bool' },
    other_agent_active_on_files: { kind: 'bool' },
  },
  labels: {
    frontend: 'UI and design-system work',
    offline_core: 'offline, service worker, sync, local server',
    pos_kds: 'POS and kitchen display flows',
    integrations: 'delivery platforms and external integrations',
    data: 'analytics queries and read-only data work',
    docs: 'documentation only',
    security_review: 'security review queue (human-owned)',
    human_owner: 'needs a human owner before any agent picks it up',
  },
  decisionInstructions: 'Choose the work queue that should own this engineering task.',
  sensitive: (s) => (s.task_kind === 'security' || s.task_kind === 'infra' ? String(s.task_kind) : null),
  rules(s) {
    // §18: si otro agente ya trabaja esos archivos, no se asigna a nadie más.
    if (s.other_agent_active_on_files === true) return d('human_owner', 0.9, 'medium', true)
    const map: Record<string, string> = {
      ui: 'frontend',
      offline: 'offline_core',
      pos_flow: 'pos_kds',
      kds: 'pos_kds',
      printing: 'pos_kds',
      delivery_integration: 'integrations',
      data_query: 'data',
      docs: 'docs',
      security: 'security_review',
      infra: 'human_owner',
    }
    const label = map[String(s.task_kind)] ?? 'human_owner'
    const risky = label === 'security_review' || label === 'human_owner' || label === 'offline_core'
    return d(label, 0.85, risky ? 'high' : 'low', risky)
  },
}

// ─── 4. ¿La tarea está realmente terminada? (§10 del protocolo) ────────────────

const CLAIMS = ['implemented', 'tested_locally', 'deployed', 'field_validated', 'certified', 'closed'] as const

const taskDone: UseCaseSpec = {
  use_case: 'task_done',
  // Declarar algo terminado cierra trabajo: efecto operativo. Nunca AUTO.
  base_authority: 'HUMAN_REQUIRED',
  schema: {
    claimed_status: { kind: 'enum', values: CLAIMS },
    tests_passed: { kind: 'int', min: 0, max: 1_000_000 },
    tests_failed: { kind: 'int', min: 0, max: 1_000_000 },
    ci_green: { kind: 'nullable_bool' },
    requires_physical_validation: { kind: 'bool' },
    field_validated_same_commit: { kind: 'nullable_bool' },
    adversarial_review_done: { kind: 'nullable_bool' },
    rollback_verified: { kind: 'nullable_bool' },
    docs_updated: { kind: 'nullable_bool' },
    branch_aligned_with_main: { kind: 'nullable_bool' },
  },
  labels: {
    done: 'the evidence supports the claimed status',
    not_done: 'the evidence contradicts the claimed status',
    insufficient_evidence: 'the evidence required for the claimed status is missing',
  },
  decisionInstructions:
    'Given the claimed status and the evidence, decide whether the task really reached that status.',
  rules(s) {
    const claim = String(s.claimed_status)
    const level = CLAIMS.indexOf(claim as (typeof CLAIMS)[number])
    if (n(s.tests_failed) > 0 && level >= 1) return d('not_done', 0.95, 'high', true)
    // "Verde en vacío": cero pruebas no prueba nada (project_demo_tenant_sin_datos).
    if (level >= 1 && n(s.tests_passed) === 0) return d('insufficient_evidence', 0.9, 'high', true)
    const required: string[] = []
    if (level >= 2) required.push('ci_green')
    if (level >= 3 && s.requires_physical_validation === true) required.push('field_validated_same_commit')
    if (level >= 4) required.push('adversarial_review_done', 'rollback_verified', 'docs_updated', 'branch_aligned_with_main')
    if (required.some((k) => s[k] === false)) return d('not_done', 0.9, 'high', true)
    if (required.some((k) => s[k] === null)) return d('insufficient_evidence', 0.85, 'medium', true)
    return d('done', 0.8, level >= 4 ? 'medium' : 'low', true)
  },
}

// ─── 5. Contradicciones entre reporte, pruebas y limitaciones ─────────────────

const contradictionCheck: UseCaseSpec = {
  use_case: 'contradiction_check',
  base_authority: 'AUTO',
  schema: {
    report: {
      kind: 'object',
      fields: {
        claimed_status: { kind: 'enum', values: CLAIMS },
        claimed_tests_passed: { kind: 'int', min: 0, max: 1_000_000 },
        claimed_tests_failed: { kind: 'int', min: 0, max: 1_000_000 },
        claims_no_limitations: { kind: 'bool' },
      },
    },
    tests: {
      kind: 'object',
      fields: {
        passed: { kind: 'int', min: 0, max: 1_000_000 },
        failed: { kind: 'int', min: 0, max: 1_000_000 },
        skipped: { kind: 'int', min: 0, max: 1_000_000 },
      },
    },
    limitations: {
      kind: 'object',
      fields: {
        open_count: { kind: 'int', min: 0, max: 10_000 },
        any_blocks_claimed_status: { kind: 'bool' },
      },
    },
  },
  labels: {
    consistent: 'report, test results and limitations agree',
    contradiction: 'the report says something the tests or limitations contradict',
    insufficient_evidence: 'there is not enough evidence to judge the report',
  },
  decisionInstructions: 'Check whether the report is consistent with the test results and the open limitations.',
  rules(s) {
    const r = obj(s.report)
    const t = obj(s.tests)
    const l = obj(s.limitations)
    if (n(r.claimed_tests_passed) !== n(t.passed) || n(r.claimed_tests_failed) !== n(t.failed))
      return d('contradiction', 0.95, 'high', true)
    if (r.claims_no_limitations === true && n(l.open_count) > 0) return d('contradiction', 0.9, 'high', true)
    // Por definición del campo: una limitación que bloquea el estado declarado lo contradice, sea cual sea.
    if (l.any_blocks_claimed_status === true) return d('contradiction', 0.9, 'high', true)
    if (n(t.passed) + n(t.failed) === 0) return d('insufficient_evidence', 0.85, 'medium', true)
    if (n(t.failed) > 0 && String(r.claimed_status) !== 'implemented') return d('contradiction', 0.85, 'high', true)
    return d('consistent', 0.8, 'low', false)
  },
}

export const USE_CASE_SPECS: Record<UseCase, UseCaseSpec> = {
  alert_priority: alertPriority,
  incident_classification: incidentClassification,
  agent_routing: agentRouting,
  task_done: taskDone,
  contradiction_check: contradictionCheck,
}

export function riskFromScore(score: number): RiskLevel {
  const i = Math.min(RISK_LEVELS.length - 1, Math.max(0, Math.round(score)))
  return RISK_LEVELS[i]
}
