import { describe, expect, it } from 'vitest'
import { classifyFreshness, deriveSalesActions, stateLabel, type CanonicalMetric } from '@/lib/operational-model'

describe('operational model', () => {
  it('classifies freshness without pretending missing timestamps are fresh', () => {
    const now = new Date('2026-08-27T12:00:00-06:00')
    expect(classifyFreshness(null, now)).toBe('unknown')
    expect(classifyFreshness('2026-08-27T11:50:00-06:00', now)).toBe('live')
    expect(classifyFreshness('2026-08-26T12:00:00-06:00', now)).toBe('recent')
    expect(classifyFreshness('2026-08-24T12:00:00-06:00', now)).toBe('stale')
  })

  it('creates an action when sales are materially below comparison', () => {
    const metrics: CanonicalMetric[] = [{
      id: 'net_sales_today', label: 'Ventas', value: 1000, unit: 'mxn', source: 'pos_orders',
      observedAt: '2026-08-27T10:00:00-06:00', freshness: 'recent', comparison: { value: -22, label: 'vs. semana anterior' },
    }]
    expect(deriveSalesActions(metrics)[0]).toMatchObject({ area: 'ventas', priority: 'medium' })
  })

  it('uses explicit operational language', () => {
    expect(stateLabel('degraded')).toBe('Degradado, pero vendiendo')
  })
})
