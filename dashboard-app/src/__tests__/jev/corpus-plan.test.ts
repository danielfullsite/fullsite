import { describe, expect, it } from 'vitest'
import { USE_CASES } from '@/lib/jev/contract'
import { buildJevCorpusPlan, JEV_EVALUATION_TARGET_CASES } from '@/lib/jev/eval/corpus-plan'
import { SYNTHETIC_CASES } from '@/lib/jev/fixtures/synthetic-cases'

describe('Jev corpus plan', () => {
  it('distribuye exactamente 2,000 casos entre todos los casos de uso', () => {
    const plan = buildJevCorpusPlan()
    expect(plan.target).toBe(2_000)
    expect(plan.allocation).toHaveLength(USE_CASES.length)
    expect(plan.allocation.map((row) => row.use_case)).toEqual(USE_CASES)
    expect(plan.allocation.reduce((sum, row) => sum + row.target, 0)).toBe(JEV_EVALUATION_TARGET_CASES)
  })

  it('declara la brecha real sin contar fixtures repetidos como evidencia nueva', () => {
    const plan = buildJevCorpusPlan()
    expect(new Set(SYNTHETIC_CASES.map((fixture) => fixture.case_id)).size).toBe(SYNTHETIC_CASES.length)
    expect(plan.authored).toBe(SYNTHETIC_CASES.length)
    expect(plan.independently_labeled_required).toBe(plan.target - plan.authored)
    expect(plan.allocation.every((row) => row.independently_labeled_required === row.target - row.authored)).toBe(true)
    expect(plan.live_execution).toBe(false)
    expect(plan.shadow_only).toBe(true)
  })
})
