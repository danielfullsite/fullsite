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

/** Export estable de la Caja Windows. Sólo este resumen cerrado puede importarse. */
export interface P19GateExport {
  schemaVersion: 1
  gate: 'fresh_p19_pos_kds_integral'
  status: 'tested_locally'
  gateResult: 'blocked'
  review: 'human_review_required'
  uiPolicy: 'hold'
  productionAuthorized: false
  operationAuthorized: false
  sourceEvidenceManifestSha256: string
  counts: {
    directedNode: ExecutionCounts
    directedElectronNode: ExecutionCounts
    uniqueTests: null
    finalCandidateCertifiedTests: null
    nativeRecoveryCases: number
    nativeRecoveryObservedSuccessful: number
    secondRoundStages: number
    secondRoundStagesObservedSuccessful: number
    externalLiveOmitted: number
  }
  pending: Record<'guiCdp' | 'visualReplay' | 'twoGuiRestarts' | 'chromiumNetLogs' | 'rendererSecretAudit' | 'integralRegressionBuild' | 'physicalValidation', 'pending'>
  qualification: 'historical_observations_not_final_candidate_certification'
}

interface ExecutionCounts {
  executions: number
  successfulExecutions: number
  unsuccessfulExecutions: number
  explicitlyTimedOutExecutions: number
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

function executionCounts(value: unknown): value is ExecutionCounts {
  if (!isRecord(value)) return false
  const fields = ['executions', 'successfulExecutions', 'unsuccessfulExecutions', 'explicitlyTimedOutExecutions'] as const
  if (!fields.every((key) => nonNegativeInt(value[key]))) return false
  const counts = value as unknown as ExecutionCounts
  return counts.successfulExecutions + counts.unsuccessfulExecutions === counts.executions && counts.explicitlyTimedOutExecutions <= counts.unsuccessfulExecutions
}

/**
 * Convierte el manifiesto P19 Windows a contradiction_check. Sus fallos/timeouts
 * no se maquillan como PASS: las reglas devolverán contradicción y revisión humana.
 */
export function parseP19GateExport(raw: unknown, sourceSha256: unknown): { ok: true; source_ref: string; source_sha256: string; input: DecisionInput } | { ok: false; error: string } {
  if (!isRecord(raw) || typeof sourceSha256 !== 'string' || !SHA256_RE.test(sourceSha256)) return { ok: false, error: 'Manifiesto o hash inválido.' }
  const manifest = raw as Partial<P19GateExport>
  if (manifest.schemaVersion !== 1 || manifest.gate !== 'fresh_p19_pos_kds_integral' || manifest.status !== 'tested_locally' || manifest.gateResult !== 'blocked' || manifest.review !== 'human_review_required' || manifest.uiPolicy !== 'hold' || manifest.productionAuthorized !== false || manifest.operationAuthorized !== false || manifest.qualification !== 'historical_observations_not_final_candidate_certification') {
    return { ok: false, error: 'El manifiesto P19 no conserva sus límites obligatorios.' }
  }
  if (typeof manifest.sourceEvidenceManifestSha256 !== 'string' || !SHA256_RE.test(manifest.sourceEvidenceManifestSha256) || !isRecord(manifest.counts)) return { ok: false, error: 'Integridad o conteos P19 inválidos.' }
  const counts = manifest.counts as P19GateExport['counts']
  if (!executionCounts(counts.directedNode) || !executionCounts(counts.directedElectronNode) || counts.uniqueTests !== null || counts.finalCandidateCertifiedTests !== null || !['nativeRecoveryCases', 'nativeRecoveryObservedSuccessful', 'secondRoundStages', 'secondRoundStagesObservedSuccessful', 'externalLiveOmitted'].every((key) => nonNegativeInt(counts[key as keyof typeof counts])) || counts.nativeRecoveryObservedSuccessful > counts.nativeRecoveryCases || counts.secondRoundStagesObservedSuccessful > counts.secondRoundStages) {
    return { ok: false, error: 'Conteos P19 inconsistentes.' }
  }
  const pendingKeys: (keyof P19GateExport['pending'])[] = ['guiCdp', 'visualReplay', 'twoGuiRestarts', 'chromiumNetLogs', 'rendererSecretAudit', 'integralRegressionBuild', 'physicalValidation']
  if (!isRecord(manifest.pending) || !pendingKeys.every((key) => manifest.pending?.[key] === 'pending')) return { ok: false, error: 'Los gates pendientes fueron alterados.' }
  // No sumamos recovery/stages como pruebas únicas: el manifiesto declara que el
  // total único es desconocido. Sólo contamos las ejecuciones dirigidas explícitas.
  const passed = counts.directedNode.successfulExecutions + counts.directedElectronNode.successfulExecutions
  const failed = counts.directedNode.unsuccessfulExecutions + counts.directedElectronNode.unsuccessfulExecutions
  const input: DecisionInput = {
    contract_version: JEV_CONTRACT_VERSION,
    use_case: 'contradiction_check',
    // Scope sintético estable del paquete, no representa un restaurante ni un tenant real.
    tenant_ref: `t_${sourceSha256.slice(0, 32)}`,
    effect_domains: ['operational'],
    state: {
      report: { claimed_status: 'tested_locally', claimed_tests_passed: passed, claimed_tests_failed: failed, claims_no_limitations: false },
      tests: { passed, failed, skipped: counts.externalLiveOmitted },
      limitations: { open_count: pendingKeys.length, any_blocks_claimed_status: false },
    },
  }
  return checkInput(input).ok
    ? { ok: true, source_ref: 'fresh-p19-pos-kds-integral-20260926', source_sha256: sourceSha256, input }
    : { ok: false, error: 'El manifiesto no pudo convertirse a evidencia segura.' }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
