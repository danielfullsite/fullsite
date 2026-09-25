import type { FetchLike } from '@/lib/jev/adapter'

export const FAKE_CREDENTIAL = 'vck_TEST_ONLY_not_a_real_key_0123456789'

export interface JevCall {
  url: string
  headers: Record<string, string>
  body: { state: unknown; questions: Record<string, { type: string; criteria?: unknown }> } & Record<string, unknown>
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Respuesta válida de Jev que elige `label` con probabilidad `p` y reparte el resto. */
export function validAnswers(
  criteria: Record<string, unknown>,
  label: string,
  p = 0.9,
  opts: { risk?: number; review?: number; tokens?: number; meta?: unknown } = {},
) {
  const keys = Object.keys(criteria)
  const rest = keys.length > 1 ? (1 - p) / (keys.length - 1) : 0
  const probabilities = Object.fromEntries(keys.map((k) => [k, k === label ? p : rest]))
  return {
    answers: {
      decision: { type: 'choice', choice: label, probabilities },
      risk: { type: 'score', score: opts.risk ?? 2 },
      needs_human_review: { type: 'boolean', probability: opts.review ?? 0.1 },
    },
    usage: { inputTokens: opts.tokens ?? 400, outputTokens: 0 },
    warnings: [],
    ...(opts.meta ? { providerMetadata: opts.meta } : {}),
  }
}

/** Transporte simulado. `respond` recibe la llamada ya parseada. Registra todas las llamadas. */
export function mockFetch(respond: (call: JevCall) => Response | Promise<Response>) {
  const calls: JevCall[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
    const call: JevCall = { url, headers, body: JSON.parse(String(init.body)) }
    calls.push(call)
    return respond(call)
  }
  return { fetchImpl, calls }
}

/** Jev simulado que siempre elige `pick(criteria)`. */
export function mockJev(pick: (labels: string[]) => string, p = 0.9, opts: Parameters<typeof validAnswers>[3] = {}) {
  return mockFetch((call) => {
    const criteria = call.body.questions.decision.criteria as Record<string, unknown>
    return jsonResponse(200, validAnswers(criteria, pick(Object.keys(criteria)), p, opts))
  })
}
