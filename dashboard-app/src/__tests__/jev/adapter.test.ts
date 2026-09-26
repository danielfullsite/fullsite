import { describe, expect, it } from 'vitest'
import { createJevAdapter, estimateCostUsd, sanitizeDetail } from '@/lib/jev/adapter'
import type { FetchLike, JevAdapterOptions } from '@/lib/jev/adapter'
import { JEV_GATEWAY_URL, JEV_MODEL_ID, JEV_PRICE_PER_INPUT_TOKEN_USD } from '@/lib/jev/contract'
import { USE_CASE_SPECS, buildJevQuestions } from '@/lib/jev/use-cases'
import { FAKE_CREDENTIAL, jsonResponse, mockFetch, validAnswers } from './helpers'

const spec = USE_CASE_SPECS.alert_priority
const state = { alert_kind: 'pos_offline', minutes_active: 3, affected_terminals: 1, open_orders: 2, service_hours: true, repeats_24h: 0 }
const criteria = buildJevQuestions(spec).decision.criteria as Record<string, string>

function adapter(fetchImpl: FetchLike, extra: JevAdapterOptions = {}) {
  return createJevAdapter({ enabled: true, getCredential: () => FAKE_CREDENTIAL, fetchImpl, timeoutMs: 200, ...extra })
}

describe('adaptador Jev — bloqueo sin red', () => {
  it('apagado por defecto: no toca la red', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}))
    const prev = process.env.JEV_SHADOW_ENABLED
    delete process.env.JEV_SHADOW_ENABLED
    const out = await createJevAdapter({ fetchImpl, getCredential: () => FAKE_CREDENTIAL }).evaluate(state, spec)
    if (prev !== undefined) process.env.JEV_SHADOW_ENABLED = prev
    expect(out).toMatchObject({ status: 'blocked', block_reason: 'jev_disabled', decision: null })
    expect(calls).toHaveLength(0)
  })

  it('sin credencial: bloquea y no llama', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}))
    const out = await adapter(fetchImpl, { getCredential: () => undefined }).evaluate(state, spec)
    expect(out.block_reason).toBe('credential_missing')
    expect(calls).toHaveLength(0)
  })

  it('credencial vacía cuenta como ausente', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, {}))
    const out = await adapter(fetchImpl, { getCredential: () => '' }).evaluate(state, spec)
    expect(out.block_reason).toBe('credential_missing')
    expect(calls).toHaveLength(0)
  })
})

describe('adaptador Jev — timeout y red', () => {
  it('timeout: aborta y bloquea dentro del plazo', async () => {
    const fetchImpl = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    const t0 = Date.now()
    const out = await adapter(fetchImpl, { timeoutMs: 50 }).evaluate(state, spec)
    expect(out.block_reason).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it('timeout también cubre un cuerpo que nunca termina de llegar', async () => {
    const fetchImpl = async (_u: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            init.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          },
        }),
        { status: 200 },
      )
    const out = await adapter(fetchImpl, { timeoutMs: 50 }).evaluate(state, spec)
    expect(out.block_reason).toBe('timeout')
  })

  it('error de red: bloquea y el detalle no filtra la credencial', async () => {
    const fetchImpl = async () => {
      throw new Error(`connect failed with Bearer ${FAKE_CREDENTIAL}`)
    }
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.block_reason).toBe('network_error')
    expect(JSON.stringify(out)).not.toContain(FAKE_CREDENTIAL)
  })

  it('HTTP 403 del gateway (el caso real de 2026-09-25): bloquea con el tipo, sin el mensaje', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(403, {
        error: { message: 'AI Gateway requires a valid credit card on file… https://vercel.com/d?to=x', type: 'customer_verification_required' },
      }),
    )
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out).toMatchObject({ status: 'blocked', block_reason: 'http_error', detail: 'HTTP 403 customer_verification_required' })
    expect(out.detail).not.toContain('http')
  })

  it.each([401, 429, 500, 502, 503])('HTTP %i: bloquea', async (status) => {
    const { fetchImpl } = mockFetch(() => jsonResponse(status, 'upstream error'))
    const out = await adapter(fetchImpl, { maxRateLimitRetries: 0 }).evaluate(state, spec)
    expect(out.block_reason).toBe('http_error')
  })

  it('HTTP 429: espera y reintenta de forma acotada hasta obtener respuesta válida', async () => {
    let attempt = 0
    const sleeps: number[] = []
    const { fetchImpl, calls } = mockFetch(() => {
      attempt++
      return attempt < 3
        ? new Response(JSON.stringify({ error: { type: 'rate_limit_exceeded' } }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0.01' },
          })
        : jsonResponse(200, { ...validAnswers(criteria, 'P0'), model: JEV_MODEL_ID })
    })
    const out = await adapter(fetchImpl, {
      maxRateLimitRetries: 2,
      retryBaseDelayMs: 1,
      sleep: async (ms) => { sleeps.push(ms) },
    }).evaluate(state, spec)
    expect(out.status).toBe('ok')
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([10, 10])
  })

  it('HTTP 503 no se reintenta: se diagnostica separado de rate limit', async () => {
    const sleeps: number[] = []
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(503, { error: { type: 'service_unavailable_error' } }))
    const out = await adapter(fetchImpl, { sleep: async (ms) => { sleeps.push(ms) } }).evaluate(state, spec)
    expect(out).toMatchObject({ block_reason: 'http_error', detail: 'HTTP 503 service_unavailable_error' })
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })
})

describe('adaptador Jev — petición', () => {
  it('manda un solo modelo, sin fallbacks, con los headers del protocolo v4', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, validAnswers(criteria, 'P0')))
    await adapter(fetchImpl).evaluate(state, spec)
    expect(calls).toHaveLength(1)
    const [c] = calls
    expect(c.url).toBe(JEV_GATEWAY_URL)
    expect(c.headers['ai-model-id']).toBe(JEV_MODEL_ID)
    expect(c.headers['ai-evaluation-model-specification-version']).toBe('4')
    expect(c.headers.authorization).toBe(`Bearer ${FAKE_CREDENTIAL}`)
    expect(Object.keys(c.body).sort()).toEqual(['questions', 'state'])
    expect(JSON.stringify(c.body)).not.toContain(FAKE_CREDENTIAL)
    expect(JSON.stringify(c.body)).not.toMatch(/"models"|providerOptions/)
    expect(Object.keys(c.body.questions).sort()).toEqual(['decision', 'needs_human_review', 'risk'])
  })
})

describe('adaptador Jev — respuesta válida', () => {
  it('mapea choice, probabilidad, riesgo, revisión, tokens y costo', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(200, validAnswers(criteria, 'P1', 0.82, { risk: 2.4, review: 0.7, tokens: 1_000 })))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.status).toBe('ok')
    expect(out.decision).toEqual({ label: 'P1', confidence: 0.82, risk: 'high', needs_human_review: true })
    expect(out.input_tokens).toBe(1_000)
    expect(out.cost_usd).toBeCloseTo(1_000 * JEV_PRICE_PER_INPUT_TOKEN_USD, 12)
    expect(out.model).toBe(JEV_MODEL_ID)
    expect(out.distribution).not.toBeNull()
  })

  it('sin distribución: confianza 0 (el gate la manda a humano)', async () => {
    const body = validAnswers(criteria, 'P2') as { answers: { decision: Record<string, unknown> } }
    delete body.answers.decision.probabilities
    const { fetchImpl } = mockFetch(() => jsonResponse(200, body))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.decision?.confidence).toBe(0)
  })

  it('el gateway reporta otro modelo: se descarta (no hay sustitución silenciosa)', async () => {
    const meta = { gateway: { routing: { resolvedModel: 'otro-proveedor/otro-modelo', finalProvider: 'x' } } }
    const { fetchImpl } = mockFetch(() => jsonResponse(200, validAnswers(criteria, 'P0', 0.9, { meta })))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.block_reason).toBe('model_mismatch')
    expect(out.decision).toBeNull()
  })

  it('acepta el modelo correcto reportado en la raíz por el protocolo vivo', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(200, { ...validAnswers(criteria, 'P0'), model: JEV_MODEL_ID }))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.status).toBe('ok')
  })

  it('rechaza sustitución de modelo reportada en la raíz', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(200, { ...validAnswers(criteria, 'P0'), model: 'otro/modelo' }))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.block_reason).toBe('model_mismatch')
  })

  it('registra el proveedor si el gateway lo reporta', async () => {
    const meta = { gateway: { routing: { resolvedModel: JEV_MODEL_ID, finalProvider: 'digitalocean' } } }
    const { fetchImpl } = mockFetch(() => jsonResponse(200, validAnswers(criteria, 'P0', 0.9, { meta })))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.provider).toBe('digitalocean')
  })
})

describe('adaptador Jev — respuestas inválidas', () => {
  const base = () => validAnswers(criteria, 'P0') as { answers: Record<string, Record<string, unknown>> } & Record<string, unknown>
  const cases: [string, () => unknown][] = [
    ['no JSON', () => '<html>oops</html>'],
    ['arreglo', () => []],
    ['clave inesperada', () => ({ ...base(), text: 'P3 please' })],
    ['model raíz con tipo inválido', () => ({ ...base(), model: { id: JEV_MODEL_ID } })],
    ['falta una respuesta', () => { const b = base(); delete b.answers.risk; return b }],
    ['respuesta de más', () => { const b = base(); b.answers.extra = { type: 'boolean', probability: 1 }; return b }],
    ['choice fuera del conjunto', () => { const b = base(); b.answers.decision.choice = 'P9'; return b }],
    ['choice no es argmax', () => { const b = base(); b.answers.decision.choice = 'P3'; return b }],
    ['distribución no suma 1', () => { const b = base(); (b.answers.decision.probabilities as Record<string, number>).P0 = 0.2; return b }],
    ['distribución con clave faltante', () => { const b = base(); delete (b.answers.decision.probabilities as Record<string, number>).P3; return b }],
    ['probabilidad negativa', () => { const b = base(); b.answers.decision.probabilities = { P0: 1.2, P1: -0.2, P2: 0, P3: 0 }; return b }],
    ['tipo cambiado', () => { const b = base(); b.answers.risk = { type: 'boolean', probability: 0.3 }; return b }],
    ['score fuera de rango', () => { const b = base(); b.answers.risk.score = 7; return b }],
    ['score NaN', () => { const b = base(); b.answers.risk.score = Number.NaN; return b }],
    ['score ≠ media de su distribución', () => { const b = base(); b.answers.risk = { type: 'score', score: 0, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } }; return b }],
    ['booleano > 1', () => { const b = base(); b.answers.needs_human_review.probability = 1.5; return b }],
    ['booleano con campo extra', () => { const b = base(); b.answers.needs_human_review.explanation = 'x'; return b }],
    ['tokens negativos', () => ({ ...base(), usage: { inputTokens: -1 } })],
  ]
  it.each(cases)('%s → invalid_response', async (_name, make) => {
    const { fetchImpl } = mockFetch(() => jsonResponse(200, make()))
    const out = await adapter(fetchImpl).evaluate(state, spec)
    expect(out.status).toBe('blocked')
    expect(out.block_reason).toBe('invalid_response')
    expect(out.decision).toBeNull()
  })
})

describe('utilidades', () => {
  it('sanitizeDetail oculta llaves, bearer y JWT y recorta', () => {
    const s = sanitizeDetail(`Bearer abc ${FAKE_CREDENTIAL} eyJhbGciOiJIUzI1NiJ9.payload.sig ${'x'.repeat(500)}`)
    expect(s).not.toContain(FAKE_CREDENTIAL)
    expect(s).not.toContain('eyJhbGci')
    expect(s.length).toBeLessThanOrEqual(200)
  })
  it('costo = tokens × precio publicado; null si no hay tokens', () => {
    expect(estimateCostUsd(1_000_000)).toBeCloseTo(0.042, 10)
    expect(estimateCostUsd(null)).toBeNull()
  })
})
