import { describe, expect, it } from 'vitest'
import { businessMinutesAt, calculateIntradayRhythm } from '@/lib/intraday-rhythm'

const ZONE = 'America/Monterrey'
const START = '05:00:00'

describe('ritmo intradía — mismo corte, no proyección', () => {
  it('compara sólo cobros cerrados hasta la misma hora de días equivalentes', () => {
    const now = new Date('2026-10-01T21:30:00Z') // 15:30 Monterrey
    const ritmo = calculateIntradayRhythm([
      { dia_venta: '2026-10-01', closed_at: '2026-10-01T18:00:00Z', total: 100 }, // 12:00
      { dia_venta: '2026-10-01', closed_at: '2026-10-01T22:00:00Z', total: 999 }, // futuro: fuera
      { dia_venta: '2026-09-24', closed_at: '2026-09-24T18:00:00Z', total: 200 },
      { dia_venta: '2026-09-24', closed_at: '2026-09-24T22:00:00Z', total: 999 }, // después del corte: fuera
      { dia_venta: '2026-09-17', closed_at: '2026-09-17T19:00:00Z', total: 300 },
    ], now, ZONE, START, '2026-10-01')
    expect(ritmo).toMatchObject({ currentTotal: 100, expectedTotal: 250, comparableDays: 2, cutOffTime: '15:30' })
  })

  it('no emite ritmo si no hay dos días comparables reales', () => {
    const ritmo = calculateIntradayRhythm([
      { dia_venta: '2026-10-01', closed_at: '2026-10-01T18:00:00Z', total: 100 },
      { dia_venta: '2026-09-24', closed_at: '2026-09-24T18:00:00Z', total: 200 },
    ], new Date('2026-10-01T21:30:00Z'), ZONE, START, '2026-10-01')
    expect(ritmo).toBeNull()
  })

  it('mantiene el corte del día de negocio al cruzar medianoche', () => {
    // 02:30 local todavía es parte del día de negocio que inició a las 05:00 previas.
    expect(businessMinutesAt(new Date('2026-10-02T08:30:00Z'), ZONE, START)).toBe(1290)
  })
})
