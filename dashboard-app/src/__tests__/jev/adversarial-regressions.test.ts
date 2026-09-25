/**
 * Regresiones de la revisión adversarial independiente del 2026-09-25.
 * Cada prueba reproduce el escenario que el revisor confirmó; el nombre lleva su id.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJevAdapter } from '@/lib/jev/adapter'
import type { FetchLike } from '@/lib/jev/adapter'
import { createFileAuditSink, createMemoryAuditSink, verifyAuditChain } from '@/lib/jev/audit'
import type { AuditEntry } from '@/lib/jev/audit'
import { compare } from '@/lib/jev/compare'
import { JEV_CONTRACT_VERSION, JEV_MODEL_ID } from '@/lib/jev/contract'
import { evaluateDecision } from '@/lib/jev/engine'
import { SYNTHETIC_CASES, SYN_TENANT_A } from '@/lib/jev/fixtures/synthetic-cases'
import { checkInput } from '@/lib/jev/redaction'
import { USE_CASE_SPECS, buildJevQuestions } from '@/lib/jev/use-cases'
import { FAKE_CREDENTIAL, jsonResponse, mockFetch, mockJev, validAnswers } from './helpers'

const base = () => JSON.parse(JSON.stringify(SYNTHETIC_CASES.find((c) => c.case_id === 'ap-05')!.input))
const deps = (fetchImpl: FetchLike) => ({
  jev: createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl, timeoutMs: 100 }),
  audit: createMemoryAuditSink(),
})

describe('H1 — claves del prototipo no pasan el esquema', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])('%s con PII se rechaza y no sale a la red', async (key) => {
    const raw = `{"contract_version":"${JEV_CONTRACT_VERSION}","use_case":"alert_priority","tenant_ref":"${SYN_TENANT_A}","effect_domains":["none"],"state":{"alert_kind":"low_stock","minutes_active":0,"affected_terminals":0,"open_orders":0,"service_hours":true,"repeats_24h":0,"${key}":{"customer_name":"Juan Perez","pin":4821,"card":4111111111111111}}}`
    const input = JSON.parse(raw)
    expect(checkInput(input).ok).toBe(false)
    const { fetchImpl, calls } = mockJev((l) => l[0])
    const rec = await evaluateDecision(input, deps(fetchImpl))
    expect(rec.jev.block_reason).toBe('input_rejected')
    expect(calls).toHaveLength(0)
  })

  it('también en objetos anidados (contradiction_check.report)', () => {
    const c = JSON.parse(JSON.stringify(SYNTHETIC_CASES.find((x) => x.case_id === 'cc-01')!.input))
    c.state.report = JSON.parse(`{"claimed_status":"implemented","claimed_tests_passed":120,"claimed_tests_failed":0,"claims_no_limitations":false,"constructor":"Maria Lopez 4821"}`)
    expect(checkInput(c).ok).toBe(false)
  })
})

describe('H2 — evaluateDecision no lanza', () => {
  it('estado circular → rechazo FORBIDDEN por ilegible, sin excepción', async () => {
    const input = base()
    input.state.self = input.state
    const { fetchImpl, calls } = mockJev((l) => l[0])
    const rec = await evaluateDecision(input, deps(fetchImpl))
    expect(rec.authority).toBe('FORBIDDEN')
    expect(rec.policy_applied).toContain('forbidden:unreadable_input')
    expect(calls).toHaveLength(0)
  })

  it('getter que lanza → rechazo, sin excepción', async () => {
    const input = base()
    Object.defineProperty(input, 'tenant_ref', { enumerable: true, get() { throw new Error('boom') } })
    const rec = await evaluateDecision(input, deps(mockJev((l) => l[0]).fetchImpl))
    expect(rec.jev.block_reason).toBe('input_rejected')
  })

  it('un adaptador con bug que resuelve null no hace lanzar al motor', async () => {
    const jev = { evaluate: async () => null as never }
    const rec = await evaluateDecision(base(), { jev, audit: createMemoryAuditSink() })
    expect(rec.executable).toBe(false)
    expect(rec.policy_applied).toContain('reject:internal_error')
  })

  it('entrada null / número / string no lanza', async () => {
    for (const x of [null, undefined, 42, 'x', []]) {
      const rec = await evaluateDecision(x, deps(mockJev((l) => l[0]).fetchImpl))
      expect(rec.executable).toBe(false)
      expect(rec.effective).toBeNull()
    }
  })
})

describe('H3 — lo que se valida es lo que se envía (sin TOCTOU)', () => {
  it('un getter que cambia tras varias lecturas no logra enviar otro valor', async () => {
    const input = base()
    let reads = 0
    Object.defineProperty(input.state, 'alert_kind', {
      enumerable: true,
      get() { reads++; return reads > 3 ? 'Juan Perez PIN 4821' : 'print_queue_stuck' },
    })
    const { fetchImpl, calls } = mockJev((l) => l[0])
    await evaluateDecision(input, deps(fetchImpl))
    for (const c of calls) expect(JSON.stringify(c.body)).not.toContain('Juan')
  })

  it('toJSON en el prototipo: se valida la salida de toJSON, así que se rechaza', async () => {
    const input = base()
    const proto = { toJSON: () => ({ customer: 'Maria Lopez', pin: '4821' }) }
    input.state = Object.assign(Object.create(proto), input.state)
    const { fetchImpl, calls } = mockJev((l) => l[0])
    const rec = await evaluateDecision(input, deps(fetchImpl))
    expect(rec.jev.block_reason).toBe('input_rejected')
    expect(calls).toHaveLength(0)
  })
})

describe('M1 — un rechazo no baja FORBIDDEN', () => {
  it('money + campo extra → FORBIDDEN, no HUMAN_REQUIRED', async () => {
    const input = { ...base(), effect_domains: ['money'] }
    input.state.extra = 1
    const rec = await evaluateDecision(input, deps(mockJev((l) => l[0]).fetchImpl))
    expect(rec.authority).toBe('FORBIDDEN')
    expect(rec.policy_applied).toContain('forbidden:money')
  })
})

describe("M2 — use_case 'constructor' sale como invalid y compare no truena", () => {
  it('se registra como invalid', async () => {
    const rec = await evaluateDecision({ ...base(), use_case: 'constructor' }, deps(mockJev((l) => l[0]).fetchImpl))
    expect(rec.use_case).toBe('invalid')
    expect(() => compare([{ case_id: 'x', expected: 'P0', hard: false, rec }])).not.toThrow()
  })
})

describe('M3 — rounding hostil no desactiva las invariantes', () => {
  const spec = USE_CASE_SPECS.alert_priority
  const criteria = buildJevQuestions(spec).decision.criteria as Record<string, string>
  it.each([
    [{ probabilityDecimals: -2 }],
    [{ probabilityDecimals: 1.5 }],
    [{ scoreDecimals: -3 }],
    [{ probabilityDecimals: 11 }],
    [{ other: 1 }],
  ])('rounding %j → invalid_response', async (rounding) => {
    const body = { ...validAnswers(criteria, 'P0'), rounding }
    const out = await createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl: mockFetch(() => jsonResponse(200, body)).fetchImpl }).evaluate(base().state, spec)
    expect(out.block_reason).toBe('invalid_response')
  })

  it('el ejemplo del revisor (todas las probabilidades en 1) se rechaza', async () => {
    const body = validAnswers(criteria, 'P3') as { answers: Record<string, Record<string, unknown>> } & Record<string, unknown>
    body.answers.decision.probabilities = { P0: 1, P1: 1, P2: 1, P3: 1 }
    body.rounding = { probabilityDecimals: -2 }
    const out = await createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl: mockFetch(() => jsonResponse(200, body)).fetchImpl }).evaluate(base().state, spec)
    expect(out.status).toBe('blocked')
  })
})

describe('M5 — auditoría', () => {
  const entry = (i: number): AuditEntry => ({
    contract_version: JEV_CONTRACT_VERSION, use_case: 'alert_priority', tenant_ref: SYN_TENANT_A, input_hash: String(i).padStart(64, '0'),
    authority: 'AUTO', policy_applied: [], model: JEV_MODEL_ID, provider: null, latency_ms: null, input_tokens: null, cost_usd: null,
    jev_status: 'blocked', jev_block_reason: 'jev_disabled', jev_decision: null, rules_decision: null, effective_source: 'rules',
    agreement: 'not_compared', shadow_notes: [],
  })
  const tmp = () => join(mkdtempSync(join(tmpdir(), 'jev-adv-')), 'audit.jsonl')

  it('cola truncada: el ancla lo detecta', () => {
    const path = tmp()
    const a = createFileAuditSink(path)
    for (let i = 0; i < 3; i++) a.append(entry(i))
    const first = readFileSync(path, 'utf8').split('\n')[0]
    writeFileSync(path, `${first}\n`)
    expect(verifyAuditChain(a.readAll()).ok).toBe(true) // la cadena sola no lo ve…
    expect(() => createFileAuditSink(path)).toThrow(/truncada/) // …el ancla sí
  })

  it('un campo undefined no deja el archivo inservible', () => {
    const path = tmp()
    const a = createFileAuditSink(path)
    a.append({ ...entry(0), provider: undefined as unknown as null })
    expect(() => createFileAuditSink(path)).not.toThrow()
    expect(verifyAuditChain(a.readAll()).ok).toBe(true)
  })

  it('dos sinks del mismo proceso sobre el mismo archivo no bifurcan la cadena', () => {
    const path = tmp()
    const a = createFileAuditSink(path)
    const b = createFileAuditSink(path)
    a.append(entry(0))
    b.append(entry(1))
    a.append(entry(2))
    expect(verifyAuditChain(createFileAuditSink(path).readAll()).ok).toBe(true)
  })

  it('una línea a medio escribir da un error claro, no un SyntaxError crudo', () => {
    const path = tmp()
    createFileAuditSink(path).append(entry(0))
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"seq":2,"ts":`, { flag: 'w' })
    expect(() => createFileAuditSink(path)).toThrow(/línea 2 no es JSON/)
  })
})

describe('L1 — cualquier modelo reportado distinto se detecta', () => {
  const spec = USE_CASE_SPECS.alert_priority
  const criteria = buildJevQuestions(spec).decision.criteria as Record<string, string>
  it.each([
    [{ gateway: { routing: { resolvedModel: `x/${'y'.repeat(200)}` } } }],
    [{ gateway: { modelId: 'otro/modelo' } }],
    [{ gateway: { model: { id: 'otro/modelo' } } }],
    [{ gateway: { routing: { resolvedModel: JEV_MODEL_ID, originalModelId: 'otro/modelo' } } }],
  ])('%j → model_mismatch', async (meta) => {
    const body = validAnswers(criteria, 'P0', 0.9, { meta })
    const out = await createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl: mockFetch(() => jsonResponse(200, body)).fetchImpl }).evaluate(base().state, spec)
    expect(out.block_reason).toBe('model_mismatch')
  })
})

describe('L2 — el timeout no depende de que el transporte respete abort', () => {
  it('un transporte que ignora signal no cuelga la llamada', async () => {
    const fetchImpl: FetchLike = () => new Promise<Response>(() => {})
    const t0 = Date.now()
    const out = await createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl, timeoutMs: 50 }).evaluate(base().state, USE_CASE_SPECS.alert_priority)
    expect(out.block_reason).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})

describe('L3 — detalle sanitizado aunque el adaptador lance', () => {
  it('el mensaje con una llave no llega a rec.jev.detail', async () => {
    const jev = { evaluate: async () => { throw new Error('bad key vck_FAKE_LEAK_TEST_123456') } }
    const rec = await evaluateDecision(base(), { jev, audit: createMemoryAuditSink() })
    expect(JSON.stringify(rec)).not.toContain('vck_FAKE_LEAK_TEST_123456')
  })

  it('getCredential que lanza → credential_missing, no excepción', async () => {
    const out = await createJevAdapter({ enabled: true, getCredential: () => { throw new Error('keychain locked') }, fetchImpl: mockJev((l) => l[0]).fetchImpl }).evaluate(base().state, USE_CASE_SPECS.alert_priority)
    expect(out.block_reason).toBe('credential_missing')
  })
})

describe('L5/L6 — reglas y pisos por contenido', () => {
  it('limitación que bloquea el estado declarado = contradicción, para cualquier estado', () => {
    const c = JSON.parse(JSON.stringify(SYNTHETIC_CASES.find((x) => x.case_id === 'cc-01')!.input))
    c.state.report.claimed_status = 'deployed'
    c.state.limitations.any_blocks_claimed_status = true
    expect(USE_CASE_SPECS.contradiction_check.rules(c.state).label).toBe('contradiction')
  })

  it.each([
    ['ic-07', 'auth'],
    ['ic-02', 'auth'],
    ['ar-04', 'security'],
  ])('%s declarado como none no sale AUTO (piso %s)', async (id, why) => {
    const input = SYNTHETIC_CASES.find((x) => x.case_id === id)!.input
    const rec = await evaluateDecision(input, deps(mockJev((l) => l[0], 0.99, { review: 0, risk: 0 }).fetchImpl))
    expect(rec.authority).toBe('HUMAN_REQUIRED')
    expect(rec.policy_applied).toContain(`human:sensitive_state:${why}`)
  })
})
