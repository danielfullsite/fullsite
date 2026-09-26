import { USE_CASES } from '../contract'
import type { UseCase } from '../contract'
import { SYNTHETIC_CASES } from '../fixtures/synthetic-cases'

/** Objetivo previo a cualquier decisión de adopción. No implica que esos casos ya existan o hayan corrido. */
export const JEV_EVALUATION_TARGET_CASES = 2_000

export interface JevCorpusAllocation {
  use_case: UseCase
  target: number
  authored: number
  independently_labeled_required: number
}

/**
 * Plan estratificado y auditable. Los fixtures actuales validan la tubería, pero fueron escritos
 * junto con las reglas; los faltantes deben tener un oráculo independiente y no ser duplicados.
 */
export function buildJevCorpusPlan(): {
  target: number
  authored: number
  independently_labeled_required: number
  allocation: JevCorpusAllocation[]
  shadow_only: true
  live_execution: false
} {
  const base = Math.floor(JEV_EVALUATION_TARGET_CASES / USE_CASES.length)
  const remainder = JEV_EVALUATION_TARGET_CASES % USE_CASES.length
  const allocation = USE_CASES.map((useCase, index) => {
    const target = base + (index < remainder ? 1 : 0)
    const authored = SYNTHETIC_CASES.filter((fixture) => fixture.input.use_case === useCase).length
    return {
      use_case: useCase,
      target,
      authored,
      independently_labeled_required: Math.max(0, target - authored),
    }
  })
  const authored = SYNTHETIC_CASES.length
  return {
    target: JEV_EVALUATION_TARGET_CASES,
    authored,
    independently_labeled_required: Math.max(0, JEV_EVALUATION_TARGET_CASES - authored),
    allocation,
    shadow_only: true,
    live_execution: false,
  }
}
