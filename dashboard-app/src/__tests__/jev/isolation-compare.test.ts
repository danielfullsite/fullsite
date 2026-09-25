import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJevAdapter } from '@/lib/jev/adapter'
import { createMemoryAuditSink } from '@/lib/jev/audit'
import { brier, compare, rulesDistribution } from '@/lib/jev/compare'
import type { CaseResult } from '@/lib/jev/compare'
import { evaluateDecision } from '@/lib/jev/engine'
import { SYNTHETIC_CASES } from '@/lib/jev/fixtures/synthetic-cases'
import { FAKE_CREDENTIAL, jsonResponse, mockFetch, mockJev } from './helpers'

const SRC = join(__dirname, '..', '..')
// Cubre `from '…'`, `import '…'`, `import('…')` y `require('…')` (hallazgo L4 de la revisión adversarial).
const IMPORTS_JEV = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:@\/lib\/jev|[./]+(?:lib\/)?jev)(?:\/|['"])/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

function walkNoModules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'dist' || name === 'out') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkNoModules(p, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

describe('aislamiento: POS y KDS funcionan sin Jev', () => {
  // Guardián: el único consumidor permitido de lib/jev es lib/jev mismo y sus pruebas.
  // Si alguien la importa desde una ruta, un componente o el POS, esta prueba falla y
  // obliga a decidir a propósito (y a revisar el threat model).
  it('nadie fuera de lib/jev y __tests__/jev importa la capa', () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !f.startsWith('lib/jev/') && !f.startsWith('__tests__/jev/'))
      .filter((f) => IMPORTS_JEV.test(readFileSync(join(SRC, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('lib/jev no importa nada de POS, KDS, Supabase ni del resto de lib', () => {
    const bad = walk(join(SRC, 'lib', 'jev'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => [relative(SRC, f), m[1]]))
      .filter(([, spec]) => !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('node:'))
      // Única excepción: el runner manual de comparación corre dentro de vitest.
      .filter(([file, spec]) => !(file.startsWith('lib/jev/eval/') && spec === 'vitest'))
    expect(bad).toEqual([])
  })

  it('lib/jev no referencia tablas ni clientes de Supabase ni hace escrituras remotas', () => {
    const text = walk(join(SRC, 'lib', 'jev')).map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(text).not.toMatch(/supabase|\.from\(['"]|\/rest\/v1|SERVICE_ROLE/i)
  })

  it.each([
    "import { evaluateDecision } from '@/lib/jev/engine'",
    "import '@/lib/jev/engine'",
    "const m = await import('@/lib/jev/engine')",
    "const m = require('../lib/jev/engine')",
  ])('el guardián detecta: %s', (sample) => {
    expect(IMPORTS_JEV.test(sample)).toBe(true)
  })

  it('fuera de dashboard-app (Electron, print-bridge) nadie referencia lib/jev', () => {
    const repo = join(SRC, '..', '..')
    const dirs = ['electron-app', 'electron-kds', 'print-bridge'].map((d) => join(repo, d)).filter((d) => existsSync(d))
    const files = dirs.flatMap((d) => walkNoModules(d))
    expect(files.filter((f) => /lib\/jev/.test(readFileSync(f, 'utf8'))).map((f) => relative(repo, f))).toEqual([])
  })
})

async function run(fetchImpl: Parameters<typeof mockFetch>[0] | ReturnType<typeof mockJev>['fetchImpl'], raw = false): Promise<CaseResult[]> {
  const f = raw ? (fetchImpl as ReturnType<typeof mockJev>['fetchImpl']) : mockFetch(fetchImpl as Parameters<typeof mockFetch>[0]).fetchImpl
  const jev = createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl: f, timeoutMs: 200 })
  const out: CaseResult[] = []
  for (const c of SYNTHETIC_CASES) {
    out.push({ case_id: c.case_id, expected: c.expected, hard: !!c.hard, rec: await evaluateDecision(c.input, { jev, audit: createMemoryAuditSink() }) })
  }
  return out
}

describe('comparación Jev vs reglas', () => {
  it('si Jev nunca responde, el estado es BLOCKED y no se inventa precisión', async () => {
    const results = await run(() => jsonResponse(403, { error: { type: 'customer_verification_required' } }))
    const r = compare(results)
    expect(r.status).toBe('JEV_DECISION_LAYER_BLOCKED')
    expect(r.jev_calls_ok).toBe(0)
    expect(r.jev_blocked_by_reason).toEqual({ http_error: SYNTHETIC_CASES.length })
    for (const u of r.by_use_case) {
      expect(u.jev.accuracy).toBeNull()
      expect(u.verdict).toBe('BLOCKED')
      expect(u.rules.accuracy).not.toBeNull()
    }
  })

  it('un Jev simulado que acierta al oráculo pasa; uno que siempre elige la primera opción es rechazado', async () => {
    const oracle = new Map(SYNTHETIC_CASES.map((c) => [JSON.stringify(c.input.state), c.expected]))
    const perfect = mockFetch((call) => {
      const criteria = call.body.questions.decision.criteria as Record<string, unknown>
      const label = oracle.get(JSON.stringify(call.body.state))!
      const keys = Object.keys(criteria)
      const probabilities = Object.fromEntries(keys.map((k) => [k, k === label ? 0.97 : 0.03 / (keys.length - 1)]))
      return jsonResponse(200, {
        answers: { decision: { type: 'choice', choice: label, probabilities }, risk: { type: 'score', score: 1 }, needs_human_review: { type: 'boolean', probability: 0.2 } },
        usage: { inputTokens: 300 },
      })
    })
    const good = compare(await run(perfect.fetchImpl, true))
    expect(good.status).toBe('JEV_DECISION_LAYER_PHASE_0_COMPLETE')
    for (const u of good.by_use_case) expect(u.jev.accuracy).toBe(1)
    expect(good.cost_usd_total).toBeGreaterThan(0)

    const lazy = compare(await run(mockJev((l) => l[0]).fetchImpl, true))
    expect(lazy.by_use_case.some((u) => u.verdict === 'REJECT')).toBe(true)
  })

  it('Brier: distribución perfecta = 0, uniforme sobre 4 = 0.75', () => {
    expect(brier({ a: 1, b: 0 }, ['a', 'b'], 'a')).toBe(0)
    expect(brier(rulesDistribution('a', 0.25, ['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'], 'a')).toBeCloseTo(0.75, 10)
  })
})
