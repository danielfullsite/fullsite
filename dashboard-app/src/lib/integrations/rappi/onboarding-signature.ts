import { createHmac, timingSafeEqual } from 'node:crypto'

export type RappiOnboardingSignatureResult =
  | { ok: true }
  | { ok: false; reason: 'NO_SECRET_CONFIGURED' | 'MISSING_SIGNATURE' | 'BAD_SIGNATURE_HEADER' | 'BAD_TIMESTAMP' | 'STALE_TIMESTAMP' | 'SIGNATURE_MISMATCH' }

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000

export type RappiProvisioningResult = {
  storeId: string
  integrationId: string
  brand?: string
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED'
  httpCode: number
  errorMessage?: string
}

export type RappiProvisioningEvent = {
  batchId: string
  integrationId: string
  operation: 'PROVISION' | 'DEPROVISION'
  results: RappiProvisioningResult[]
  timestamp: string
}

export function isRappiProvisioningEvent(value: unknown): value is RappiProvisioningEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (typeof event.batchId !== 'string' || typeof event.integrationId !== 'string') return false
  if (event.operation !== 'PROVISION' && event.operation !== 'DEPROVISION') return false
  if (typeof event.timestamp !== 'string' || !Array.isArray(event.results)) return false

  return event.results.every((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false
    const result = candidate as Record<string, unknown>
    return typeof result.storeId === 'string'
      && typeof result.integrationId === 'string'
      && (result.status === 'ACTIVE' || result.status === 'INACTIVE' || result.status === 'FAILED')
      && typeof result.httpCode === 'number'
  })
}

function parseSignature(header: string): { timestamp: string; signature: string } | null {
  const fields = new Map<string, string>()
  for (const entry of header.split(',')) {
    const separator = entry.indexOf('=')
    if (separator < 1) continue
    fields.set(entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim())
  }

  const timestamp = fields.get('t')
  const signature = fields.get('sign')
  return timestamp && signature ? { timestamp, signature } : null
}

function timestampToMs(value: string): number | null {
  if (!/^\d{9,14}$/.test(value)) return null
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return null
  return timestamp < 1e12 ? timestamp * 1000 : timestamp
}

function safeHexEqual(expected: string, received: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(received)) return false
  const expectedBytes = Buffer.from(expected, 'hex')
  const receivedBytes = Buffer.from(received, 'hex')
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

/**
 * Verifies STORE_PROVISIONING_STATUS using Rappi's documented contract:
 * HMAC-SHA256(secret, `<timestamp>.<raw request body>`).
 */
export function verifyRappiOnboardingSignature(
  rawBody: string,
  header: string | null,
  options: { nowMs?: number; toleranceMs?: number } = {},
): RappiOnboardingSignatureResult {
  const secret = process.env.RAPPI_ONBOARDING_WEBHOOK_SECRET?.trim()
  if (!secret) return { ok: false, reason: 'NO_SECRET_CONFIGURED' }
  if (!header) return { ok: false, reason: 'MISSING_SIGNATURE' }

  const parsed = parseSignature(header)
  if (!parsed) return { ok: false, reason: 'BAD_SIGNATURE_HEADER' }

  const timestampMs = timestampToMs(parsed.timestamp)
  if (timestampMs === null) return { ok: false, reason: 'BAD_TIMESTAMP' }

  const nowMs = options.nowMs ?? Date.now()
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS
  if (Math.abs(nowMs - timestampMs) > toleranceMs) return { ok: false, reason: 'STALE_TIMESTAMP' }

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`, 'utf8')
    .digest('hex')

  return safeHexEqual(expected, parsed.signature)
    ? { ok: true }
    : { ok: false, reason: 'SIGNATURE_MISMATCH' }
}
