/**
 * Corrida de comparación Jev vs reglas sobre fixtures sintéticos.
 *
 * No es una prueba de CI: se corre a mano con `vitest.jev-eval.config.ts`.
 * - Sin JEV_LIVE=1: Jev queda apagado (`jev_disabled`), sin red.
 * - Con JEV_LIVE=1 y JEV_SHADOW_ENABLED=1: llama al gateway, sólo con fixtures sintéticos.
 * Topes del plan §5: USD 1.00 de gasto, 5 req/s, timeout 2 s. Al superar el gasto, aborta.
 *
 * Escribe en JEV_REPORT_DIR (por defecto docs/ai/jev/reports):
 *   jev-shadow-<stamp>.json · jev-shadow-<stamp>.txt · jev-shadow-<stamp>.audit.jsonl
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import type { FetchLike } from '../adapter'
import { JEV_DEFAULT_TIMEOUT_MS, createJevAdapter } from '../adapter'
import { createFileAuditSink, verifyAuditChain } from '../audit'
import type { CaseResult, ComparisonReport } from '../compare'
import { compare } from '../compare'
import { JEV_MODEL_ID, JEV_PRICE_PER_INPUT_TOKEN_USD } from '../contract'
import { evaluateDecision } from '../engine'
import { HOSTILE_INPUTS, SYNTHETIC_CASES } from '../fixtures/synthetic-cases'

const SPEND_CAP_USD = 1.0
const MIN_INTERVAL_MS = 200 // 5 req/s

it('corrida de comparación Jev vs reglas', { timeout: 600_000 }, async () => {
  const live = process.env.JEV_LIVE === '1'
  const outDir = resolve(process.env.JEV_REPORT_DIR ?? join(__dirname, '..', '..', '..', '..', '..', 'docs', 'ai', 'jev', 'reports'))
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = join(outDir, `jev-shadow-${stamp}`)
  const audit = createFileAuditSink(`${base}.audit.jsonl`)

  let networkCalls = 0
  let spent = 0
  let last = 0
  const sentStates: string[] = []
  const guardedFetch: FetchLike = async (url, init) => {
    if (spent >= SPEND_CAP_USD) throw new Error('tope de gasto alcanzado')
    const wait = last + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    networkCalls++
    sentStates.push(JSON.stringify((JSON.parse(String(init.body)) as { state: unknown }).state))
    return fetch(url, init)
  }
  const jev = createJevAdapter({ enabled: live && process.env.JEV_SHADOW_ENABLED === '1', fetchImpl: guardedFetch, timeoutMs: JEV_DEFAULT_TIMEOUT_MS })
  let accountBlocker: string | null = null
  const blockedByAccount = {
    async evaluate() {
      return {
        status: 'blocked' as const,
        decision: null,
        distribution: null,
        block_reason: 'http_error' as const,
        detail: accountBlocker,
        latency_ms: null,
        input_tokens: null,
        cost_usd: null,
        provider: null,
        model: JEV_MODEL_ID,
      }
    },
  }

  const results: CaseResult[] = []
  const seen = new Set<string>() // idempotencia: case_id + modelo
  for (const c of SYNTHETIC_CASES) {
    const key = `${c.case_id}|${JEV_MODEL_ID}`
    if (seen.has(key)) continue
    seen.add(key)
    const rec = await evaluateDecision(c.input, { jev: accountBlocker ? blockedByAccount : jev, audit })
    if (
      rec.jev.block_reason === 'http_error' &&
      rec.jev.detail?.includes('customer_verification_required')
    ) {
      accountBlocker = rec.jev.detail
    }
    spent += rec.jev.cost_usd ?? 0
    results.push({ case_id: c.case_id, expected: c.expected, hard: !!c.hard, rec })
  }

  const callsBeforeHostile = networkCalls
  const hostile = []
  for (const h of HOSTILE_INPUTS) {
    const rec = await evaluateDecision(h.input, { jev, audit })
    hostile.push({ id: h.id, expected: h.expect, got: rec.jev.block_reason, authority: rec.authority })
  }
  const hostileReachedNetwork = networkCalls - callsBeforeHostile

  const report: ComparisonReport = compare(results)
  const chain = verifyAuditChain(audit.readAll())
  const full = {
    ...report,
    run: {
      live,
      spend_cap_usd: SPEND_CAP_USD,
      rate_limit_rps: 1000 / MIN_INTERVAL_MS,
      timeout_ms: JEV_DEFAULT_TIMEOUT_MS,
      price_per_input_token_usd: JEV_PRICE_PER_INPUT_TOKEN_USD,
      network_calls: networkCalls,
      account_blocker: accountBlocker,
      payloads_sent: sentStates.length,
      hostile_inputs: hostile.length,
      hostile_reached_network: hostileReachedNetwork,
      hostile_all_blocked_as_expected: hostile.every((h) => h.got === h.expected),
      audit_file: `${base}.audit.jsonl`.slice(outDir.length + 1),
      audit_records: audit.readAll().length,
      audit_chain_ok: chain.ok,
    },
    hostile,
    per_case: results.map((r) => ({
      case_id: r.case_id,
      hard: r.hard,
      expected: r.expected,
      rules: r.rec.rules?.label ?? null,
      jev: r.rec.jev.decision?.label ?? null,
      jev_status: r.rec.jev.status,
      jev_block_reason: r.rec.jev.block_reason,
      jev_detail: r.rec.jev.detail,
      jev_confidence: r.rec.jev.decision?.confidence ?? null,
      latency_ms: r.rec.jev.latency_ms,
      cost_usd: r.rec.jev.cost_usd,
      authority: r.rec.authority,
      input_hash: r.rec.input_hash,
    })),
    limitations: [
      'Fixtures sintéticos escritos por el mismo autor que las reglas: la precisión de reglas está inflada; ver casos hard.',
      'Tamaño de muestra chico (43 casos); el plan pide 2,000 para decidir. Esta corrida valida la tubería, no la calidad de Jev.',
      'typesafe-ai/jev no es un nombre versionado; sólo se detecta cambio de id reportado, no de pesos.',
      'Proveedor sin ZDR (has_zdr=false); por eso sólo se envían fixtures sintéticos.',
      'El costo es estimado con el precio del catálogo × usage.inputTokens reportado por el gateway.',
    ],
  }
  writeFileSync(`${base}.json`, `${JSON.stringify(full, null, 2)}\n`)
  writeFileSync(`${base}.txt`, renderTxt(full))
  console.log(`REPORTE: ${base}.txt  ESTADO: ${full.status}`)
})

function f(n: number | null, digits = 3): string {
  return n === null ? 'n/a' : n.toFixed(digits)
}

function renderTxt(r: ComparisonReport & { run: Record<string, unknown>; hostile: { id: string; expected: string; got: string | null }[]; limitations: string[] }): string {
  const L: string[] = []
  L.push(`JEV DECISION LAYER — FASE 0 (shadow) — ${r.generated_at}`)
  L.push(`ESTADO: ${r.status}`)
  L.push(`Contrato ${r.contract_version} · modelo ${r.model} · corrida ${r.run.live ? 'VIVA' : 'SIN RED (Jev apagado)'}`)
  L.push('')
  L.push(`Casos: ${r.cases} · llamadas a Jev OK: ${r.jev_calls_ok} · llamadas de red: ${r.run.network_calls}`)
  L.push(`Bloqueos de Jev: ${Object.entries(r.jev_blocked_by_reason).map(([k, v]) => `${k}=${v}`).join(', ') || 'ninguno'}`)
  L.push(`Latencia Jev ms: p50=${r.latency_ms.p50 ?? 'n/a'} p95=${r.latency_ms.p95 ?? 'n/a'} max=${r.latency_ms.max ?? 'n/a'}`)
  L.push(`Costo: USD ${r.cost_usd_total.toFixed(8)} · tokens de entrada: ${r.input_tokens_total} · tope USD ${r.run.spend_cap_usd}`)
  L.push('')
  L.push('Por caso de uso (precisión vs oráculo; Brier: menor es mejor)')
  L.push('caso                      n  reglas  jev    hard(r/j)  brier(r/j)     acuerdo  veredicto')
  for (const u of r.by_use_case) {
    L.push(
      [
        u.use_case.padEnd(24),
        String(u.n).padStart(3),
        f(u.rules.accuracy).padStart(7),
        f(u.jev.accuracy).padStart(6),
        `${u.rules.hard_correct}/${u.jev.hard_correct} de ${u.rules.hard_n}`.padStart(10),
        `${f(u.rules.brier)}/${f(u.jev.brier)}`.padStart(14),
        f(u.agreement_rate).padStart(8),
        `  ${u.verdict}`,
      ].join(' '),
    )
  }
  L.push('')
  L.push(`Entradas hostiles: ${r.run.hostile_inputs} · llegaron a la red: ${r.run.hostile_reached_network} · todas bloqueadas como se esperaba: ${r.run.hostile_all_blocked_as_expected}`)
  L.push(`Auditoría: ${r.run.audit_records} registros · cadena íntegra: ${r.run.audit_chain_ok} · ${r.run.audit_file}`)
  L.push('')
  L.push('Limitaciones:')
  for (const l of r.limitations) L.push(`- ${l}`)
  return `${L.join('\n')}\n`
}
