import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileAuditSink, createMemoryAuditSink, verifyAuditChain } from '@/lib/jev/audit'
import type { AuditEntry } from '@/lib/jev/audit'
import type { Decision } from '@/lib/jev/contract'
import { SYNTHETIC_CASES } from '@/lib/jev/fixtures/synthetic-cases'
import { postGate, preGate } from '@/lib/jev/policy-gate'
import { checkInput, scanString } from '@/lib/jev/redaction'
import type { FieldSpec } from '@/lib/jev/use-cases'
import { USE_CASE_SPECS } from '@/lib/jev/use-cases'

describe('reglas deterministas', () => {
  it('cubren todos los casos no difíciles del oráculo', () => {
    const misses = SYNTHETIC_CASES.filter((c) => !c.hard)
      .map((c) => ({ id: c.case_id, got: USE_CASE_SPECS[c.input.use_case].rules(c.input.state).label, want: c.expected }))
      .filter((r) => r.got !== r.want)
    expect(misses).toEqual([])
  })

  it('siempre devuelven una etiqueta del conjunto cerrado, confianza en [0,1]', () => {
    for (const c of SYNTHETIC_CASES) {
      const spec = USE_CASE_SPECS[c.input.use_case]
      const d = spec.rules(c.input.state)
      expect(Object.keys(spec.labels)).toContain(d.label)
      expect(d.confidence).toBeGreaterThanOrEqual(0)
      expect(d.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('contradicciones: cifras distintas, "sin limitaciones" con limitaciones, verde en vacío', () => {
    const r = (id: string) => {
      const c = SYNTHETIC_CASES.find((x) => x.case_id === id)!
      return USE_CASE_SPECS.contradiction_check.rules(c.input.state).label
    }
    expect(r('cc-02')).toBe('contradiction')
    expect(r('cc-03')).toBe('contradiction')
    expect(r('cc-04')).toBe('contradiction')
    expect(r('cc-05')).toBe('insufficient_evidence')
  })
})

describe('política de redacción', () => {
  it('todos los fixtures sintéticos pasan', () => {
    for (const c of SYNTHETIC_CASES) expect(checkInput(c.input), c.case_id).toEqual({ ok: true, violations: [] })
  })

  it('ninguna clave de ningún esquema choca con el denylist (sin excepciones ocultas)', () => {
    const keys: string[] = []
    const walk = (fields: Record<string, FieldSpec>) => {
      for (const [k, f] of Object.entries(fields)) {
        keys.push(k)
        if (f.kind === 'object') walk(f.fields)
      }
    }
    for (const spec of Object.values(USE_CASE_SPECS)) walk(spec.schema)
    for (const k of keys) {
      const input = { ...SYNTHETIC_CASES[0].input, state: { ...SYNTHETIC_CASES[0].input.state, [k]: 1 } }
      const hits = checkInput(input).violations.filter((v) => v.includes('nombre de clave prohibido'))
      expect(hits, k).toEqual([])
    }
  })

  it.each([
    ['email', 'persona@ejemplo.test'],
    ['phone', '+52 81 1234 5678'],
    ['card_pan', '4111 1111 1111 1111'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig'],
    ['api_key', 'sk-live_abcdefghijklmnop'],
    ['api_key', 'vck_abcdefghijklmnop'],
    ['bearer', 'Bearer abc.def'],
    ['rfc', 'XAXX010101000'],
    ['curp', 'XEXX010101HNEXXXA4'],
    ['pin_like', '1234'],
    ['url', 'https://ejemplo.test/x'],
  ])('detecta %s', (id, value) => {
    expect(scanString(value)).toContain(id)
  })

  it('checkInput nombra el patrón detectado aunque el esquema ya lo rechace (defensa en profundidad visible)', () => {
    const c = SYNTHETIC_CASES[0].input
    const v = checkInput({ ...c, state: { ...c.state, owner: 'persona@ejemplo.test', ref: '4111 1111 1111 1111' } }).violations
    expect(v).toContain('state.owner: patrón prohibido (email)')
    expect(v).toContain('state.ref: patrón prohibido (card_pan)')
  })

  it('un número de 16 dígitos que no pasa Luhn no se marca como tarjeta', () => {
    expect(scanString('1234 5678 9012 3456')).not.toContain('card_pan')
  })

  it.each(['pin', 'userPin', 'customer_name', 'email', 'totalAmount', 'order_items', 'propina', 'rfc', 'api_token'])(
    'rechaza la clave %s a cualquier profundidad',
    (key) => {
      const c = SYNTHETIC_CASES.find((x) => x.case_id === 'cc-01')!.input
      const nested = { ...c, state: { ...c.state, report: { ...(c.state.report as object), [key]: true } } }
      expect(checkInput(nested).violations.some((v) => v.includes('nombre de clave prohibido'))).toBe(true)
    },
  )

  it('rechaza estados demasiado grandes y claves de nivel superior extra', () => {
    const c = SYNTHETIC_CASES[0].input
    expect(checkInput({ ...c, raw_order: {} }).ok).toBe(false)
    expect(checkInput({ ...c, state: { ...c.state, pad: 'x'.repeat(5_000) } }).violations.join()).toMatch(/caracteres/)
  })

  it('rechaza enteros fuera de rango, flotantes y tipos cambiados', () => {
    const c = SYNTHETIC_CASES[0].input
    expect(checkInput({ ...c, state: { ...c.state, minutes_active: -1 } }).ok).toBe(false)
    expect(checkInput({ ...c, state: { ...c.state, minutes_active: 1.5 } }).ok).toBe(false)
    expect(checkInput({ ...c, state: { ...c.state, service_hours: 'yes' } }).ok).toBe(false)
    expect(checkInput(null).ok).toBe(false)
  })
})

describe('policy gate', () => {
  const dec = (over: Partial<Decision> = {}): Decision => ({ label: 'x', confidence: 0.9, risk: 'low', needs_human_review: false, ...over })
  const input = SYNTHETIC_CASES.find((c) => c.case_id === 'ar-01')!.input

  it('la autoridad sólo sube, nunca baja', () => {
    const pre = preGate({ ...input, effect_domains: ['operational'] })
    expect(pre.authority).toBe('HUMAN_REQUIRED')
    expect(postGate(pre, dec()).authority).toBe('HUMAN_REQUIRED')
  })

  it('FORBIDDEN es absorbente', () => {
    const pre = preGate({ ...input, effect_domains: ['deploy'] })
    expect(postGate(pre, dec()).authority).toBe('FORBIDDEN')
  })

  it('sin decisión de reglas → humano', () => {
    expect(postGate(preGate(input), null).authority).toBe('HUMAN_REQUIRED')
  })
})

describe('auditoría append-only', () => {
  const entry = (i: number): AuditEntry => ({
    contract_version: 'jev-decision/0.1.0',
    use_case: 'alert_priority',
    tenant_ref: 't_00000000000000a1',
    input_hash: String(i).padStart(64, '0'),
    authority: 'AUTO',
    policy_applied: ['auto:no_external_effect'],
    model: 'typesafe-ai/jev',
    provider: null,
    latency_ms: null,
    input_tokens: null,
    cost_usd: null,
    jev_status: 'blocked',
    jev_block_reason: 'jev_disabled',
    jev_decision: null,
    rules_decision: null,
    effective_source: 'rules',
    agreement: 'not_compared',
    shadow_notes: [],
  })

  it('la cadena verifica y detecta edición, borrado y reordenamiento', () => {
    const sink = createMemoryAuditSink()
    for (let i = 0; i < 4; i++) sink.append(entry(i))
    const rows = sink.readAll()
    expect(verifyAuditChain(rows).ok).toBe(true)
    const edited = rows.map((r, i) => (i === 1 ? { ...r, authority: 'FORBIDDEN' as const } : r))
    expect(verifyAuditChain(edited).ok).toBe(false)
    expect(verifyAuditChain([rows[0], rows[2], rows[3]]).ok).toBe(false)
    expect(verifyAuditChain([rows[1], rows[0], rows[2], rows[3]]).ok).toBe(false)
  })

  it('readAll devuelve copias: mutarlas no altera el registro', () => {
    const sink = createMemoryAuditSink()
    sink.append(entry(0))
    sink.readAll()[0].authority = 'FORBIDDEN'
    expect(sink.readAll()[0].authority).toBe('AUTO')
  })

  it('el sink de archivo agrega, continúa la cadena entre instancias y nunca trunca', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-audit-'))
    const path = join(dir, 'audit.jsonl')
    const a = createFileAuditSink(path)
    a.append(entry(0))
    a.append(entry(1))
    const b = createFileAuditSink(path)
    b.append(entry(2))
    const rows = b.readAll()
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(verifyAuditChain(rows).ok).toBe(true)
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('el sink de archivo se niega a continuar sobre un archivo alterado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-audit-'))
    const path = join(dir, 'audit.jsonl')
    const a = createFileAuditSink(path)
    a.append(entry(0))
    a.append(entry(1))
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    writeFileSync(path, `${lines[1]}\n`)
    expect(() => createFileAuditSink(path)).toThrow(/corrupta/)
  })
})
