import { createHmac, timingSafeEqual } from 'node:crypto'

// Verificación HMAC-SHA256 del webhook de Rappi.
// Contrato (Integrations Manager → pestaña HMAC):
//   Header:  Rappi-Signature: t=<timestamp>,sign=<hex>
//   Regla:   firma sobre `<timestamp>.<payload normalizado>`. El normalizador
//            es el del verificador oficial de Integrations Manager: conserva el
//            orden/espacios, pero convierte valores JSON boolean/number/null a
//            strings antes de calcular HMAC-SHA256.
//
// Seguridad (cert RAPPI-003):
//   - Único secret: RAPPI_WEBHOOK_SECRET (dedicado, lo entrega Rappi al registrar
//     el webhook). NO se usa el client_secret de OAuth como llave de firma.
//   - Chequeo de frescura del timestamp (anti-replay): fuera de la ventana → rechaza.
//   - En prod la firma se valida con UN solo formato (determinístico). En DEV se
//     permiten formatos candidatos SOLO para fijar el contrato con el primer evento
//     real; una vez confirmado, se bloquea a la combinación ganadora.

export interface RappiSigResult {
  ok: boolean
  matchedFormat?: string
  reason?: string
}

export interface VerifyOpts {
  nowMs?: number
  toleranceMs?: number
  /** DEV: probar formatos históricos. Prod: sólo el formato oficial 't.normalized'. */
  allowFormatDiscovery?: boolean
}

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000

function parseHeader(header: string): { t: string; sign: string } | null {
  let t = ''
  let sign = ''
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim().toLowerCase()
    const v = part.slice(idx + 1).trim()
    if (k === 't' || k === 'ts' || k === 'timestamp') t = v
    else if (k === 'sign' || k === 'signature' || k === 'v1' || k === 'hash') sign = v
  }
  return sign ? { t, sign } : null
}

function hexEq(a: string, b: string): boolean {
  let ab: Buffer
  let bb: Buffer
  try {
    ab = Buffer.from(a, 'hex')
    bb = Buffer.from(b, 'hex')
  } catch {
    return false
  }
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Timestamp en ms (13 díg) o s (10 díg). Devuelve ms, o null si no parsea.
function tsToMs(t: string): number | null {
  if (!/^\d{9,14}$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return n < 1e12 ? n * 1000 : n
}

function normalizeRappiPayload(rawBody: string): string {
  let normalized = rawBody
  if (normalized.length > 1 && normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1)
  }
  return normalized
    .replace(/\\"/g, '"')
    .replace(/:(\s*)(true|false)/g, ':"$2"')
    .replace(/:(\s*)(-?\d+\.?\d*)([,}\]])/g, ':"$2"$3')
    .replace(/:(\s*)null/g, ':"null"')
}

export function verifyRappiSignature(rawBody: string, header: string | null, opts: VerifyOpts = {}): RappiSigResult {
  const secret = process.env.RAPPI_WEBHOOK_SECRET
  if (!secret) return { ok: false, reason: 'NO_SECRET_CONFIGURED' }

  if (!header) return { ok: false, reason: 'MISSING_SIGNATURE' }
  const parsed = parseHeader(header)
  if (!parsed) return { ok: false, reason: 'BAD_SIGNATURE_HEADER' }
  const { t, sign } = parsed

  // Anti-replay: el timestamp debe estar dentro de la ventana de tolerancia.
  const nowMs = opts.nowMs ?? Date.now()
  const toleranceMs = opts.toleranceMs ?? DEFAULT_TOLERANCE_MS
  const tMs = tsToMs(t)
  if (tMs === null) return { ok: false, reason: 'BAD_TIMESTAMP' }
  if (Math.abs(nowMs - tMs) > toleranceMs) return { ok: false, reason: 'STALE_TIMESTAMP' }

  const normalizedBody = normalizeRappiPayload(rawBody)
  const formats: Array<{ name: string; msg: string }> = opts.allowFormatDiscovery
    ? [
        { name: 't.normalized', msg: `${t}.${normalizedBody}` },
        { name: 't.body', msg: `${t}.${rawBody}` },
        { name: 'body', msg: rawBody },
        { name: 't+body', msg: `${t}${rawBody}` },
      ]
    : [{ name: 't.normalized', msg: `${t}.${normalizedBody}` }]

  for (const f of formats) {
    const computed = createHmac('sha256', secret).update(f.msg, 'utf8').digest('hex')
    if (hexEq(computed, sign)) return { ok: true, matchedFormat: f.name }
  }
  return { ok: false, reason: 'SIGNATURE_MISMATCH' }
}
