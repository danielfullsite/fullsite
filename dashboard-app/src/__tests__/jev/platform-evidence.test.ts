import { describe, expect, it } from 'vitest'
import { parseTaskDoneEvidence, taskDoneInput } from '@/lib/jev/platform-evidence'

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
})
