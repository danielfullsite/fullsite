import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { isRappiProvisioningEvent, verifyRappiOnboardingSignature } from '@/lib/integrations/rappi/onboarding-signature'

const SECRET = 'fullsite-rappi-onboarding-test-secret'
const NOW = 1_787_844_800_000
const TIMESTAMP = String(Math.floor(NOW / 1000))

function signature(rawBody: string) {
  const digest = createHmac('sha256', SECRET).update(`${TIMESTAMP}.${rawBody}`, 'utf8').digest('hex')
  return `t=${TIMESTAMP},sign=${digest}`
}

const payload = {
  batchId: '550e8400-e29b-41d4-a716-446655440000',
  integrationId: 'fullsite-dev',
  operation: 'PROVISION',
  results: [{ storeId: '900173586', integrationId: 'fullsite-dev', brand: 'AMALAY', status: 'ACTIVE', httpCode: 201 }],
  timestamp: '2026-08-27T12:00:00Z',
}

afterEach(() => {
  delete process.env.RAPPI_ONBOARDING_WEBHOOK_SECRET
})

describe('Rappi self-onboarding callback', () => {
  it('verifies the documented timestamp plus unmodified raw body contract', () => {
    process.env.RAPPI_ONBOARDING_WEBHOOK_SECRET = SECRET
    const rawBody = JSON.stringify(payload)
    expect(verifyRappiOnboardingSignature(rawBody, signature(rawBody), { nowMs: NOW })).toEqual({ ok: true })
  })

  it('rejects tampering and replay', () => {
    process.env.RAPPI_ONBOARDING_WEBHOOK_SECRET = SECRET
    const rawBody = JSON.stringify(payload)
    expect(verifyRappiOnboardingSignature(`${rawBody} `, signature(rawBody), { nowMs: NOW })).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' })
    expect(verifyRappiOnboardingSignature(rawBody, signature(rawBody), { nowMs: NOW + 10 * 60 * 1000 })).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' })
  })

  it('accepts the documented STORE_PROVISIONING_STATUS schema', () => {
    expect(isRappiProvisioningEvent(payload)).toBe(true)
  })

  it('rejects unrelated and malformed events', () => {
    expect(isRappiProvisioningEvent({ event: 'NEW_ORDER' })).toBe(false)
    expect(isRappiProvisioningEvent({ ...payload, results: [{ ...payload.results[0], status: 'UNKNOWN' }] })).toBe(false)
  })
})
