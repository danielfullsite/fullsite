/**
 * Comparación Jev vs reglas locales sobre casos con oráculo.
 *
 * Criterios de éxito tomados de JEV-SHADOW-EVALUATION-PLAN.md §6 (2026-09-25),
 * fijados antes de correr: Jev pasa un caso de uso si su acuerdo con el oráculo
 * es ≥ reglas + 5 pp, o igual acuerdo con Brier menor. Latencia p95 < 1 s es
 * informativa. Si Jev no respondió ni una vez, el veredicto es BLOCKED — no se
 * inventa una precisión.
 */
import type { Recommendation, UseCase } from './contract'
import { JEV_CONTRACT_VERSION, JEV_MODEL_ID, USE_CASES } from './contract'
import { USE_CASE_SPECS } from './use-cases'

export interface CaseResult {
  case_id: string
  expected: string
  hard: boolean
  rec: Recommendation
}

export interface ArmStats {
  n: number
  answered: number
  correct: number
  accuracy: number | null
  hard_n: number
  hard_correct: number
  brier: number | null
}

export interface UseCaseComparison {
  use_case: UseCase
  n: number
  rules: ArmStats
  jev: ArmStats
  agreement_rate: number | null
  verdict: 'PASS' | 'REJECT' | 'BLOCKED'
}

export interface ComparisonReport {
  contract_version: typeof JEV_CONTRACT_VERSION
  model: typeof JEV_MODEL_ID
  generated_at: string
  mode: 'shadow'
  cases: number
  jev_calls_ok: number
  jev_blocked_by_reason: Record<string, number>
  latency_ms: { p50: number | null; p95: number | null; max: number | null }
  cost_usd_total: number
  input_tokens_total: number
  by_use_case: UseCaseComparison[]
  status: 'JEV_DECISION_LAYER_BLOCKED' | 'JEV_DECISION_LAYER_PHASE_0_COMPLETE'
}

function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

/** Brier multiclase: Σ (p_k − y_k)² sobre las etiquetas. */
export function brier(dist: Record<string, number>, labels: string[], truth: string): number {
  return labels.reduce((acc, l) => acc + ((dist[l] ?? 0) - (l === truth ? 1 : 0)) ** 2, 0)
}

/** Las reglas dan una confianza puntual; se reparte el resto uniformemente para poder compararlas. */
export function rulesDistribution(label: string, confidence: number, labels: string[]): Record<string, number> {
  const rest = labels.length > 1 ? (1 - confidence) / (labels.length - 1) : 0
  return Object.fromEntries(labels.map((l) => [l, l === label ? confidence : rest]))
}

function emptyArm(): ArmStats {
  return { n: 0, answered: 0, correct: 0, accuracy: null, hard_n: 0, hard_correct: 0, brier: null }
}

export function compare(results: CaseResult[], now: Date = new Date()): ComparisonReport {
  const blocked: Record<string, number> = {}
  const latencies: number[] = []
  let cost = 0
  let tokens = 0
  let ok = 0

  const byUc = new Map<UseCase, { rules: ArmStats; jev: ArmStats; agree: number; compared: number; rb: number[]; jb: number[] }>()
  for (const uc of USE_CASES) byUc.set(uc, { rules: emptyArm(), jev: emptyArm(), agree: 0, compared: 0, rb: [], jb: [] })

  for (const r of results) {
    const j = r.rec.jev
    if (j.status === 'ok') ok++
    else blocked[j.block_reason ?? 'unknown'] = (blocked[j.block_reason ?? 'unknown'] ?? 0) + 1
    if (j.latency_ms !== null && j.status === 'ok') latencies.push(j.latency_ms)
    cost += j.cost_usd ?? 0
    tokens += j.input_tokens ?? 0

    if (r.rec.use_case === 'invalid') continue
    const acc = byUc.get(r.rec.use_case)!
    const labels = Object.keys(USE_CASE_SPECS[r.rec.use_case].labels)
    for (const arm of [acc.rules, acc.jev]) {
      arm.n++
      if (r.hard) arm.hard_n++
    }
    if (r.rec.rules) {
      acc.rules.answered++
      const hit = r.rec.rules.label === r.expected
      if (hit) acc.rules.correct++
      if (hit && r.hard) acc.rules.hard_correct++
      acc.rb.push(brier(rulesDistribution(r.rec.rules.label, r.rec.rules.confidence, labels), labels, r.expected))
    }
    if (j.status === 'ok' && j.decision) {
      acc.jev.answered++
      const hit = j.decision.label === r.expected
      if (hit) acc.jev.correct++
      if (hit && r.hard) acc.jev.hard_correct++
      if (j.distribution) acc.jb.push(brier(j.distribution, labels, r.expected))
      if (r.rec.rules) {
        acc.compared++
        if (r.rec.rules.label === j.decision.label) acc.agree++
      }
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const by_use_case: UseCaseComparison[] = []
  for (const [uc, a] of byUc) {
    if (a.rules.n === 0) continue
    a.rules.accuracy = a.rules.answered ? a.rules.correct / a.rules.n : null
    a.jev.accuracy = a.jev.answered ? a.jev.correct / a.jev.n : null
    a.rules.brier = mean(a.rb)
    a.jev.brier = mean(a.jb)
    let verdict: UseCaseComparison['verdict'] = 'BLOCKED'
    // Jev debe cubrir TODOS los casos del uso para emitir veredicto: un faltante cuenta como bloqueo.
    if (a.jev.answered === a.jev.n && a.jev.accuracy !== null && a.rules.accuracy !== null) {
      const better = a.jev.accuracy >= a.rules.accuracy + 0.05
      const calibrated =
        Math.abs(a.jev.accuracy - a.rules.accuracy) < 1e-9 && a.jev.brier !== null && a.rules.brier !== null && a.jev.brier < a.rules.brier
      verdict = better || calibrated ? 'PASS' : 'REJECT'
    }
    by_use_case.push({
      use_case: uc,
      n: a.rules.n,
      rules: a.rules,
      jev: a.jev,
      agreement_rate: a.compared ? a.agree / a.compared : null,
      verdict,
    })
  }

  return {
    contract_version: JEV_CONTRACT_VERSION,
    model: JEV_MODEL_ID,
    generated_at: now.toISOString(),
    mode: 'shadow',
    cases: results.length,
    jev_calls_ok: ok,
    jev_blocked_by_reason: blocked,
    latency_ms: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: latencies.length ? Math.max(...latencies) : null },
    cost_usd_total: Number(cost.toFixed(10)),
    input_tokens_total: tokens,
    by_use_case,
    status: by_use_case.length > 0 && by_use_case.every((u) => u.verdict !== 'BLOCKED') ? 'JEV_DECISION_LAYER_PHASE_0_COMPLETE' : 'JEV_DECISION_LAYER_BLOCKED',
  }
}
