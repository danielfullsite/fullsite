/**
 * Contrato del centro de control JEV.
 *
 * Sólo admite hechos enumerados y verificables. No acepta reportes, rutas,
 * URLs, textos libres, secretos ni datos de operación. El API deriva la
 * entrada Jev desde este paquete; el navegador nunca construye `state`.
 */
import { JEV_CONTRACT_VERSION } from './contract'
import type { DecisionInput } from './contract'
import { TENANT_REF_RE, checkInput } from './redaction'

export const JEV_EVIDENCE_SCHEMA_VERSION = 'jev-evidence/0.1.0' as const

const SOURCE_REF_RE = /^[a-z0-9][a-z0-9._-]{2,119}$/
const SHA256_RE = /^[a-f0-9]{64}$/

export type TaskClaim = 'implemented' | 'tested_locally' | 'deployed' | 'field_validated' | 'certified' | 'closed'

export interface TaskDoneEvidenceDraft {
  source_ref: string
  source_sha256: string
  tenant_ref: string
  claimed_status: TaskClaim
  tests_passed: number
  tests_failed: number
  ci_green: boolean | null
  requires_physical_validation: boolean
  field_validated_same_commit: boolean | null
  adversarial_review_done: boolean | null
  rollback_verified: boolean | null
  docs_updated: boolean | null
  branch_aligned_with_main: boolean | null
}

export interface StoredJevEvidence {
  id: string
  source_ref: string
  source_sha256: string
  decision_input: DecisionInput
  created_at: string
}

export interface StoredJevDecision {
  id: string
  evidence_id: string
  recommendation: Record<string, unknown>
  audit_record: Record<string, unknown>
  created_at: string
}

export interface StoredJevReview {
  decision_id: string
  disposition: 'accepted' | 'rejected'
  created_at: string
}

export function taskDoneInput(draft: TaskDoneEvidenceDraft): DecisionInput {
  return {
    contract_version: JEV_CONTRACT_VERSION,
    use_case: 'task_done',
    tenant_ref: draft.tenant_ref,
    effect_domains: ['operational'],
    state: {
      claimed_status: draft.claimed_status,
      tests_passed: draft.tests_passed,
      tests_failed: draft.tests_failed,
      ci_green: draft.ci_green,
      requires_physical_validation: draft.requires_physical_validation,
      field_validated_same_commit: draft.field_validated_same_commit,
      adversarial_review_done: draft.adversarial_review_done,
      rollback_verified: draft.rollback_verified,
      docs_updated: draft.docs_updated,
      branch_aligned_with_main: draft.branch_aligned_with_main,
    },
  }
}

function boolOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000
}

/** Convierte una solicitud del panel en evidencia segura o la rechaza por completo. */
export function parseTaskDoneEvidence(raw: unknown): { ok: true; value: TaskDoneEvidenceDraft; input: DecisionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Paquete inválido.' }
  const value = raw as Partial<TaskDoneEvidenceDraft>
  const claims: readonly TaskClaim[] = ['implemented', 'tested_locally', 'deployed', 'field_validated', 'certified', 'closed']
  if (typeof value.source_ref !== 'string' || !SOURCE_REF_RE.test(value.source_ref)) return { ok: false, error: 'Referencia de fuente inválida.' }
  if (typeof value.source_sha256 !== 'string' || !SHA256_RE.test(value.source_sha256)) return { ok: false, error: 'Hash SHA-256 inválido.' }
  if (typeof value.tenant_ref !== 'string' || !TENANT_REF_RE.test(value.tenant_ref)) return { ok: false, error: 'Tenant debe ser un identificador opaco.' }
  if (!claims.includes(value.claimed_status as TaskClaim)) return { ok: false, error: 'Estado declarado inválido.' }
  if (!nonNegativeInt(value.tests_passed) || !nonNegativeInt(value.tests_failed)) return { ok: false, error: 'Los conteos de pruebas deben ser enteros no negativos.' }
  const nullable = [
    value.ci_green,
    value.field_validated_same_commit,
    value.adversarial_review_done,
    value.rollback_verified,
    value.docs_updated,
    value.branch_aligned_with_main,
  ]
  if (typeof value.requires_physical_validation !== 'boolean' || !nullable.every(boolOrNull)) {
    return { ok: false, error: 'Los campos de verificación deben ser booleanos o pendientes.' }
  }
  const draft = value as TaskDoneEvidenceDraft
  const input = taskDoneInput(draft)
  const validation = checkInput(input)
  return validation.ok ? { ok: true, value: draft, input } : { ok: false, error: 'El paquete no cumple el contrato de redacción.' }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
