import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRappiSignature } from '@/lib/integrations/rappi/signature'

const SECRET = 'rappi-test-secret'
const NOW = 1_787_265_250_584
const TIMESTAMP = String(NOW)

function sign(message: string): string {
  return createHmac('sha256', SECRET).update(message, 'utf8').digest('hex')
}

afterEach(() => {
  delete process.env.RAPPI_WEBHOOK_SECRET
})

describe('Rappi Integrations Manager signature contract', () => {
  it('verifies the normalized JSON string used by the official webhook tester', () => {
    process.env.RAPPI_WEBHOOK_SECRET = SECRET
    const raw = '{"total":1500,"status":"OPEN","order_id":"SAMPLE-ORDER-0001","store_id":"900173586","created_at":"2024-01-01 12:00:00"}'
    const normalized = '{"total":"1500","status":"OPEN","order_id":"SAMPLE-ORDER-0001","store_id":"900173586","created_at":"2024-01-01 12:00:00"}'
    const header = `t=${TIMESTAMP},sign=${sign(`${TIMESTAMP}.${normalized}`)}`

    expect(verifyRappiSignature(raw, header, { nowMs: NOW })).toEqual({
      ok: true,
      matchedFormat: 't.normalized',
    })
  })

  it('normalizes booleans, numbers, and null recursively without reordering keys', () => {
    process.env.RAPPI_WEBHOOK_SECRET = SECRET
    const raw = '{"active":true,"items":[{"quantity":2,"price":10.5}],"note":null}'
    const normalized = '{"active":"true","items":[{"quantity":"2","price":"10.5"}],"note":"null"}'
    const header = `t=${TIMESTAMP},sign=${sign(`${TIMESTAMP}.${normalized}`)}`

    expect(verifyRappiSignature(raw, header, { nowMs: NOW }).ok).toBe(true)
  })
})
