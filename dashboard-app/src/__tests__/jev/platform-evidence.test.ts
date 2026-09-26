import { describe, expect, it } from 'vitest'
import { createJevAdapter } from '@/lib/jev/adapter'
import { createMemoryAuditSink } from '@/lib/jev/audit'
import { evaluateDecision } from '@/lib/jev/engine'
import { parseP19GateExport, parseTaskDoneEvidence, taskDoneInput } from '@/lib/jev/platform-evidence'

const valid = {
  source_ref: 'fresh-p19-pos-kds-integral-20260926',
  source_sha256: 'a'.repeat(64),
  tenant_ref: 't_7f48e0ce61ced6ca61b87984253b5dd7',
  claimed_status: 'certified',
  tests_passed: 16,
  tests_failed: 0,
  ci_green: null,
  requires_physical_validation: true,
  field_validated_same_commit: null,
  adversarial_review_done: false,
  rollback_verified: null,
  docs_updated: null,
  branch_aligned_with_main: null,
} as const

describe('evidencia JEV del control plane', () => {
  it('deriva una entrada task_done exacta y redactable', () => {
    const parsed = parseTaskDoneEvidence(valid)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.input).toEqual(taskDoneInput(valid))
    expect(parsed.input.effect_domains).toEqual(['operational'])
  })

  it.each([
    { ...valid, source_ref: 'https://example.com/report' },
    { ...valid, source_sha256: 'not-a-hash' },
    { ...valid, tenant_ref: 'amalay' },
    { ...valid, tests_passed: -1 },
    { ...valid, ci_green: 'yes' },
    { ...valid, claimed_status: 'P19 completo' },
  ])('rechaza una fuente no verificable o no tipada', (input) => {
    expect(parseTaskDoneEvidence(input).ok).toBe(false)
  })

  it('importa P19 bloqueado sin maquillar timeouts o fallos como PASS', async () => {
    const manifest = {
      schemaVersion: 1, gate: 'fresh_p19_pos_kds_integral', status: 'tested_locally', gateResult: 'blocked', review: 'human_review_required', uiPolicy: 'hold', productionAuthorized: false, operationAuthorized: false,
      sourceEvidenceManifestSha256: 'b'.repeat(64),
      counts: { directedNode: { executions: 9, successfulExecutions: 8, unsuccessfulExecutions: 1, explicitlyTimedOutExecutions: 1 }, directedElectronNode: { executions: 9, successfulExecutions: 8, unsuccessfulExecutions: 1, explicitlyTimedOutExecutions: 0 }, uniqueTests: null, finalCandidateCertifiedTests: null, nativeRecoveryCases: 16, nativeRecoveryObservedSuccessful: 16, secondRoundStages: 8, secondRoundStagesObservedSuccessful: 8, externalLiveOmitted: 6 },
      pending: { guiCdp: 'pending', visualReplay: 'pending', twoGuiRestarts: 'pending', chromiumNetLogs: 'pending', rendererSecretAudit: 'pending', integralRegressionBuild: 'pending', physicalValidation: 'pending' },
      qualification: 'historical_observations_not_final_candidate_certification',
    } as const
    const parsed = parseP19GateExport(manifest, 'c'.repeat(64))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.input.use_case).toBe('contradiction_check')
    expect(parsed.input.state).toMatchObject({ tests: { passed: 16, failed: 2, skipped: 6 }, limitations: { open_count: 7 } })
    const result = await evaluateDecision(parsed.input, { jev: createJevAdapter({ enabled: false }), audit: createMemoryAuditSink() })
    expect(result.effective?.label).toBe('contradiction')
    expect(result.authority).toBe('HUMAN_REQUIRED')
  })

  it('rechaza P19 si alguien intenta cambiar HOLD o borrar sus pendientes', () => {
    expect(parseP19GateExport({ schemaVersion: 1, gate: 'fresh_p19_pos_kds_integral', uiPolicy: 'open' }, 'c'.repeat(64)).ok).toBe(false)
  })
})
