import { describe, expect, it } from 'vitest'
import {
  normalizeReservationStatus,
  campaignEconomics,
  requestedWithinDays,
  reservationMetrics,
  revenueProjection,
  segmentFromLastVisit,
  type ReservationRecord,
} from '@/lib/reservation-crm'

const rows: ReservationRecord[] = [
  { id: '1', guests: 4, status: 'completed', created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z' },
  { id: '2', guests: 2, status: 'pending', created_at: '2026-09-11T10:00:00Z', updated_at: '2026-09-11T12:00:00Z' },
  { id: '3', guests: 3, status: 'no_show', created_at: '2026-09-12T10:00:00Z' },
]

describe('reservation CRM analytics', () => {
  it('normalizes the statuses used by both reservation systems', () => {
    expect(normalizeReservationStatus('confirmada')).toBe('completed')
    expect(normalizeReservationStatus('cancelada')).toBe('cancelled')
    expect(normalizeReservationStatus('no-show')).toBe('no_show')
    expect(normalizeReservationStatus('pending')).toBe('created')
  })

  it('calculates reservations and guest totals', () => {
    expect(reservationMetrics(rows)).toMatchObject({
      reservations: 3, guests: 9, completed: 1, future: 1, noShow: 1, modified: 1,
    })
  })

  it('filters by request date', () => {
    expect(requestedWithinDays(rows[0], 7, new Date('2026-09-12T23:00:00Z'))).toBe(true)
    expect(requestedWithinDays(rows[0], 1, new Date('2026-09-12T23:00:00Z'))).toBe(false)
  })

  it('projects revenue from completed and future guests', () => {
    expect(revenueProjection(rows, 500)).toEqual({
      generated: 2000, projected: 1000, potential: 3000, completedGuests: 4, futureGuests: 2,
    })
  })

  it('segments guests by recency', () => {
    const now = new Date('2026-09-12T12:00:00Z')
    expect(segmentFromLastVisit('2026-09-01T12:00:00Z', now)).toBe('recent')
    expect(segmentFromLastVisit('2026-07-01T12:00:00Z', now)).toBe('active')
    expect(segmentFromLastVisit('2026-05-01T12:00:00Z', now)).toBe('warm')
    expect(segmentFromLastVisit('2025-01-01T12:00:00Z', now)).toBe('inactive')
  })

  it('reproduces the AMALAY monthly campaign model', () => {
    const result = campaignEconomics({
      contacts: 1000, responses: 150, reservations: 40, attended: 25,
      averageTicket: 480, foodCostRate: 0.30, monthlyFee: 1500,
      seatedFee: 320, courtesyUnits: 4, courtesyUnitCost: 160.33,
    })
    expect(result.revenue).toBe(12000)
    expect(result.totalCost).toBeCloseTo(6061.32)
    expect(result.incrementalProfit).toBeCloseTo(5938.68)
    expect(result.margin).toBeCloseTo(0.49489)
    expect(result.roi).toBeCloseTo(2.4128)
  })
})
