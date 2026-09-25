/**
 * Adaptador Jev — habla directamente el protocolo del AI Gateway para modelos
 * de evaluación, sin dependencia del AI SDK (API `experimental_*` que puede
 * cambiar en un patch, y que metería peso en un bundle que el POS no necesita).
 *
 * Garantías:
 *  - Un solo modelo: `typesafe-ai/jev`. No se manda `models`/fallbacks; si el
 *    gateway reporta otro modelo, la respuesta se descarta (`model_mismatch`).
 *  - Timeout duro. Timeout, error HTTP, error de red, respuesta inválida o falta
 *    de credencial → `blocked`, nunca excepción hacia el llamador.
 *  - La credencial se lee en el momento de la llamada y sólo viaja en el header.
 *    Nunca se registra, ni se incluye en `detail`.
 */
import type { Decision, JevOutcome } from './contract'
import { JEV_GATEWAY_URL, JEV_MODEL_ID, JEV_PRICE_PER_INPUT_TOKEN_USD } from './contract'
import type { JevQuestion, UseCaseSpec } from './use-cases'
import { Q_DECISION, Q_REVIEW, Q_RISK, buildJevQuestions, riskFromScore } from './use-cases'
import { validateJevResponse } from './validate-response'

/** Timeout por defecto. El plan de shadow fija 2 s: Jev no está en ninguna ruta crítica. */
export const JEV_DEFAULT_TIMEOUT_MS = 2_000

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface JevAdapterOptions {
  /** Interruptor. Por defecto lee JEV_SHADOW_ENABLED === '1'. Apagado = bloqueado sin red. */
  enabled?: boolean
  fetchImpl?: FetchLike
  /** Devuelve la credencial o undefined. Por defecto: process.env.AI_GATEWAY_API_KEY. */
  getCredential?: () => string | undefined
  timeoutMs?: number
  now?: () => number
}

export interface JevAdapter {
  evaluate(state: unknown, spec: UseCaseSpec): Promise<JevOutcome>
}

const SECRETISH = /(bearer\s+\S+|vck_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)/gi

/** Detalle apto para log: sin credenciales, sin cuerpo completo, corto. */
export function sanitizeDetail(s: string): string {
  return s.replace(SECRETISH, '***REDACTED***').replace(/\s+/g, ' ').slice(0, 200)
}

export function estimateCostUsd(inputTokens: number | null): number | null {
  return inputTokens === null ? null : Number((inputTokens * JEV_PRICE_PER_INPUT_TOKEN_USD).toFixed(10))
}

export function createJevAdapter(opts: JevAdapterOptions = {}): JevAdapter {
  const enabled = opts.enabled ?? process.env.JEV_SHADOW_ENABLED === '1'
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const getCredential = opts.getCredential ?? (() => process.env.AI_GATEWAY_API_KEY)
  const timeoutMs = opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS
  const now = opts.now ?? (() => Date.now())

  const blocked = (
    reason: NonNullable<JevOutcome['block_reason']>,
    detail: string | null,
    latency: number | null,
    extra: Partial<JevOutcome> = {},
  ): JevOutcome => ({
    status: 'blocked',
    decision: null,
    distribution: null,
    block_reason: reason,
    detail: detail === null ? null : sanitizeDetail(detail),
    latency_ms: latency,
    input_tokens: null,
    cost_usd: null,
    provider: null,
    model: JEV_MODEL_ID,
    ...extra,
  })

  return {
    async evaluate(state, spec) {
      if (!enabled) return blocked('jev_disabled', null, null)
      let credential: string | undefined
      try {
        credential = getCredential()
      } catch {
        credential = undefined
      }
      if (!credential) return blocked('credential_missing', null, null)

      const questions: Record<string, JevQuestion> = buildJevQuestions(spec)
      const controller = new AbortController()
      const started = now()
      let timer: ReturnType<typeof setTimeout> | undefined
      // El timeout no depende de que el transporte respete `signal`: se corre en carrera.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(Object.assign(new Error('timeout'), { name: 'AbortError' }))
        }, timeoutMs)
      })
      let res: Response
      let raw: string
      try {
        const call = (async () => {
          const r = await fetchImpl(JEV_GATEWAY_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${credential}`,
              'ai-gateway-protocol-version': '0.0.1',
              'ai-gateway-auth-method': 'api-key',
              'ai-evaluation-model-specification-version': '4',
              'ai-model-id': JEV_MODEL_ID,
            },
            // Sin providerOptions.gateway.models: prohibido el fallback a otro modelo.
            body: JSON.stringify({ state, questions }),
          })
          return { r, text: await r.text() }
        })()
        call.catch(() => {}) // si pierde la carrera, su rechazo tardío no queda sin manejar
        const done = await Promise.race([call, deadline])
        res = done.r
        raw = done.text
      } catch (e) {
        const latency = now() - started
        const aborted = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')
        return aborted
          ? blocked('timeout', `sin respuesta en ${timeoutMs} ms`, latency)
          : blocked('network_error', e instanceof Error ? e.message : 'error de red', latency)
      } finally {
        clearTimeout(timer)
      }
      const latency = now() - started

      if (!res.ok) {
        // Sólo el tipo de error del gateway; el mensaje puede traer URLs o ids de cuenta.
        let type = ''
        try {
          const j = JSON.parse(raw) as { error?: { type?: unknown } }
          if (typeof j?.error?.type === 'string') type = j.error.type
        } catch { /* cuerpo no JSON */ }
        return blocked('http_error', `HTTP ${res.status}${type ? ` ${type}` : ''}`, latency)
      }

      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return blocked('invalid_response', 'cuerpo no es JSON', latency)
      }
      const v = validateJevResponse(body, questions)
      if (!v.ok) return blocked('invalid_response', v.error, latency)
      const other = v.value.reportedModels.find((m) => m !== JEV_MODEL_ID)
      if (other !== undefined) {
        return blocked('model_mismatch', `el gateway reportó '${other.slice(0, 80)}'`, latency)
      }

      const choice = v.value.answers[Q_DECISION]
      const risk = v.value.answers[Q_RISK]
      const review = v.value.answers[Q_REVIEW]
      if (choice.type !== 'choice' || risk.type !== 'score' || review.type !== 'boolean') {
        return blocked('invalid_response', 'tipos de respuesta inesperados', latency)
      }
      // Sin distribución no hay confianza medible: se registra como 0 y el gate escala a humano.
      const confidence = choice.probabilities ? choice.probabilities[choice.choice] : 0
      const decision: Decision = {
        label: choice.choice,
        confidence,
        risk: riskFromScore(risk.score),
        needs_human_review: review.probability >= 0.5,
      }
      return {
        status: 'ok',
        decision,
        distribution: choice.probabilities ?? null,
        block_reason: null,
        detail: choice.probabilities ? null : 'sin distribución de probabilidad: confianza = 0',
        latency_ms: latency,
        input_tokens: v.value.inputTokens,
        cost_usd: estimateCostUsd(v.value.inputTokens),
        provider: v.value.provider,
        model: JEV_MODEL_ID,
      }
    },
  }
}
