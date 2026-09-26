/**
 * Validación estricta de la respuesta de `POST /v4/ai/evaluation-model`.
 *
 * Forma tomada del código fuente de @ai-sdk/gateway@4.0.92 (gateway-evaluation-model.ts)
 * y de @ai-sdk/provider@4.0.18 (EvaluationModelV4Answer). Además de la forma se
 * verifican las invariantes que el core del AI SDK exige: una respuesta por
 * pregunta, opciones dentro del conjunto, distribuciones que suman 1, choice =
 * argmax, score dentro de rango y coherente con su distribución.
 *
 * Cualquier desviación → inválida. No se "rescata" una respuesta parcial.
 */
import type { JevQuestion } from './use-cases'

export type JevAnswer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number }

export interface JevWireResult {
  answers: Record<string, JevAnswer>
  inputTokens: number | null
  provider: string | null
  /** Todo identificador de modelo que el gateway reporte, en cualquiera de las rutas conocidas. */
  reportedModels: string[]
}

export type ValidationOutcome = { ok: true; value: JevWireResult } | { ok: false; error: string }

const TOP_KEYS = new Set(['answers', 'rounding', 'usage', 'warnings', 'providerMetadata', 'model'])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isProb = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((k) => s.has(k))
}

function tolerance(count: number, decimals: number | undefined): number {
  const unit = decimals === undefined ? 1e-6 : 0.5 * 10 ** -decimals
  return Math.max(1e-6, unit * count)
}

function checkDistribution(
  where: string,
  probs: unknown,
  expectedKeys: string[],
  decimals: number | undefined,
): string | null {
  if (!isObj(probs)) return `${where}: probabilities no es objeto`
  if (!sameKeys(Object.keys(probs), expectedKeys)) return `${where}: probabilities con claves distintas a las opciones`
  let sum = 0
  for (const k of expectedKeys) {
    if (!isProb(probs[k])) return `${where}: probabilidad inválida en '${k}'`
    sum += probs[k] as number
  }
  if (Math.abs(sum - 1) > tolerance(expectedKeys.length, decimals)) return `${where}: probabilities suman ${sum}`
  return null
}

/** Recorre rutas de providerMetadata sin asumir su forma (no está documentada para evaluación). */
function pickAll(meta: unknown, paths: string[][]): unknown[] {
  const out: unknown[] = []
  for (const path of paths) {
    let cur: unknown = meta
    for (const p of path) cur = isObj(cur) ? cur[p] : undefined
    if (cur !== undefined && cur !== null) out.push(cur)
  }
  return out
}

export function validateJevResponse(body: unknown, questions: Record<string, JevQuestion>): ValidationOutcome {
  const fail = (error: string): ValidationOutcome => ({ ok: false, error })
  if (!isObj(body)) return fail('cuerpo no es objeto')
  for (const k of Object.keys(body)) if (!TOP_KEYS.has(k)) return fail(`clave inesperada '${k}'`)
  const { answers, rounding, usage, warnings, model } = body
  if (!isObj(answers)) return fail('answers ausente')
  if (!sameKeys(Object.keys(answers), Object.keys(questions))) return fail('answers no corresponde 1:1 con las preguntas')
  if (rounding !== undefined && !isObj(rounding)) return fail('rounding inválido')
  if (warnings !== undefined && !Array.isArray(warnings)) return fail('warnings inválido')
  if (model !== undefined && (typeof model !== 'string' || model.length === 0 || model.length > 120))
    return fail('model inválido')
  // `rounding` viene del modelo y ensancha tolerancias: sólo se acepta si es entero en [0,10].
  // Un valor negativo o fraccionario desactivaría las invariantes de suma y argmax.
  const decimals = (k: 'probabilityDecimals' | 'scoreDecimals'): number | undefined | 'bad' => {
    if (!isObj(rounding) || rounding[k] === undefined) return undefined
    const x = rounding[k]
    return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 10 ? x : 'bad'
  }
  if (isObj(rounding) && Object.keys(rounding).some((k) => k !== 'probabilityDecimals' && k !== 'scoreDecimals'))
    return fail('rounding con claves inesperadas')
  const pDecRaw = decimals('probabilityDecimals')
  const sDecRaw = decimals('scoreDecimals')
  if (pDecRaw === 'bad' || sDecRaw === 'bad') return fail('rounding fuera de [0,10] o no entero')
  const pDec = pDecRaw
  const sDec = sDecRaw

  const out: Record<string, JevAnswer> = {}
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id]
    if (!isObj(a)) return fail(`${id}: respuesta no es objeto`)
    if (a.type !== q.type) return fail(`${id}: tipo '${String(a.type)}' ≠ '${q.type}'`)
    if (q.type === 'choice') {
      const opts = Object.keys(q.criteria)
      if (!sameKeys(Object.keys(a).filter((k) => k !== 'probabilities'), ['type', 'choice'])) return fail(`${id}: claves inesperadas`)
      if (typeof a.choice !== 'string' || !opts.includes(a.choice)) return fail(`${id}: choice fuera del conjunto`)
      if (a.probabilities !== undefined) {
        const e = checkDistribution(id, a.probabilities, opts, pDec)
        if (e) return fail(e)
        const p = a.probabilities as Record<string, number>
        const max = Math.max(...opts.map((o) => p[o]))
        if (p[a.choice] + tolerance(1, pDec) < max) return fail(`${id}: choice no es la opción más probable`)
      }
      out[id] = { type: 'choice', choice: a.choice, probabilities: a.probabilities as Record<string, number> | undefined }
    } else if (q.type === 'score') {
      const levels = q.criteria.length
      if (!sameKeys(Object.keys(a).filter((k) => k !== 'probabilities'), ['type', 'score'])) return fail(`${id}: claves inesperadas`)
      if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > levels - 1)
        return fail(`${id}: score fuera de [0, ${levels - 1}]`)
      if (a.probabilities !== undefined) {
        const keys = Array.from({ length: levels }, (_, i) => String(i))
        const e = checkDistribution(id, a.probabilities, keys, pDec)
        if (e) return fail(e)
        const p = a.probabilities as Record<string, number>
        const mean = keys.reduce((acc, k) => acc + Number(k) * p[k], 0)
        const tol = tolerance(levels, pDec) * (levels - 1) + (sDec === undefined ? 1e-6 : 0.5 * 10 ** -sDec)
        if (Math.abs(mean - a.score) > tol) return fail(`${id}: score no es la media de su distribución`)
      }
      out[id] = { type: 'score', score: a.score, probabilities: a.probabilities as Record<string, number> | undefined }
    } else {
      if (!sameKeys(Object.keys(a), ['type', 'probability'])) return fail(`${id}: claves inesperadas`)
      if (!isProb(a.probability)) return fail(`${id}: probability fuera de [0,1]`)
      out[id] = { type: 'boolean', probability: a.probability }
    }
  }

  let inputTokens: number | null = null
  if (usage !== undefined) {
    if (!isObj(usage)) return fail('usage inválido')
    if (usage.inputTokens !== undefined) {
      if (typeof usage.inputTokens !== 'number' || !Number.isFinite(usage.inputTokens) || usage.inputTokens < 0)
        return fail('usage.inputTokens inválido')
      inputTokens = usage.inputTokens
    }
  }

  const meta = body.providerMetadata
  return {
    ok: true,
    value: {
      answers: out,
      inputTokens,
      provider:
        (pickAll(meta, [
          ['gateway', 'routing', 'finalProvider'],
          ['gateway', 'routing', 'resolvedProvider'],
          ['gateway', 'provider'],
        ]).find((x): x is string => typeof x === 'string' && x.length > 0) ?? null)?.slice(0, 80) ?? null,
      // Cualquier valor (incluso no-string o muy largo) cuenta: el adaptador exige que TODOS sean Jev.
      reportedModels: [
        ...(model === undefined ? [] : [model]),
        ...pickAll(meta, [
        ['gateway', 'routing', 'resolvedModel'],
        ['gateway', 'routing', 'resolvedModelId'],
        ['gateway', 'routing', 'originalModelId'],
        ['gateway', 'modelId'],
        ['gateway', 'model'],
        ]).map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))),
      ],
    },
  }
}
