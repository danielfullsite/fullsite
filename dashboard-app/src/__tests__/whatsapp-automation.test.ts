import { describe, expect, it } from 'vitest'
import {
  cadenceMeter, DEFAULT_WHATSAPP_CADENCE, isInsideSendWindow,
  mayRunAutomation, normalizeCadence, planAutomationBatch,
} from '@/lib/whatsapp-automation'

describe('WhatsApp automation cadence', () => {
  it('normalizes unsafe limits and duplicate days', () => {
    const cadence = normalizeCadence({ dailyLimit: 5000, batchSize: 0, cooldownDays: -2, sendDays: [4, 2, 4, 9] })
    expect(cadence.dailyLimit).toBe(250)
    expect(cadence.batchSize).toBe(1)
    expect(cadence.cooldownDays).toBe(1)
    expect(cadence.sendDays).toEqual([2, 4])
  })

  it('observes the configured quiet hours in Monterrey', () => {
    const cadence = { ...DEFAULT_WHATSAPP_CADENCE, sendDays: [2], windowStart: '11:00', windowEnd: '18:00' }
    expect(isInsideSendWindow(cadence, new Date('2026-09-15T17:30:00.000Z'))).toBe(true)
    expect(isInsideSendWindow(cadence, new Date('2026-09-15T23:59:00.000Z'))).toBe(true)
    expect(isInsideSendWindow(cadence, new Date('2026-09-16T00:00:00.000Z'))).toBe(false)
  })

  it('requires human approval before an automatic run', () => {
    const result = mayRunAutomation(DEFAULT_WHATSAPP_CADENCE, { sentToday: 0 }, new Date('2026-09-15T18:00:00.000Z'))
    expect(result).toEqual({ allowed: false, reason: 'approval_required' })
  })

  it('blocks approved runs during cooldown between campaign runs', () => {
    const result = mayRunAutomation(
      { ...DEFAULT_WHATSAPP_CADENCE, status: 'approved', frequencyDays: 7 },
      { sentToday: 0, lastRunAt: '2026-09-12T18:00:00.000Z' },
      new Date('2026-09-15T18:00:00.000Z'),
    )
    expect(result).toEqual({ allowed: false, reason: 'frequency' })
  })

  it('stops at the daily limit and reports saturation', () => {
    const cadence = { ...DEFAULT_WHATSAPP_CADENCE, status: 'approved' as const, dailyLimit: 80 }
    expect(mayRunAutomation(cadence, { sentToday: 80 }, new Date('2026-09-15T18:00:00.000Z')).reason).toBe('daily_limit')
    expect(cadenceMeter(cadence, 64)).toMatchObject({ percent: 80, remaining: 16, level: 'high' })
  })

  it('selects only opted-in contacts outside their contact cooldown', () => {
    const plan = planAutomationBatch(
      { ...DEFAULT_WHATSAPP_CADENCE, batchSize: 3, dailyLimit: 5, cooldownDays: 30 },
      [
        { id: 1, hasOptIn: true, lastOutboundAt: null },
        { id: 2, hasOptIn: false, lastOutboundAt: null },
        { id: 3, hasOptIn: true, lastOutboundAt: '2026-08-01T12:00:00.000Z' },
        { id: 4, hasOptIn: true, lastOutboundAt: '2026-09-01T12:00:00.000Z' },
      ],
      3,
      new Date('2026-09-15T18:00:00.000Z'),
    )
    expect(plan.contactIds).toEqual([1, 3])
    expect(plan.capacity).toBe(2)
    expect(plan.blockedByConsent).toBe(1)
    expect(plan.blockedByCooldown).toBe(1)
  })
})
