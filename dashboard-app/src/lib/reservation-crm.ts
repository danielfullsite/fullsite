export type ReservationStatus = 'created' | 'completed' | 'cancelled' | 'no_show'

export interface ReservationRecord {
  id: string
  codigo_reserva?: string | null
  nombre?: string | null
  telefono?: string | null
  fecha?: string | null
  espacio?: string | null
  horario_inicio?: string | null
  guests?: number | null
  total?: number | string | null
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ReservationMetrics {
  reservations: number
  guests: number
  averageParty: number
  completed: number
  completedGuests: number
  future: number
  futureGuests: number
  cancelled: number
  cancelledGuests: number
  noShow: number
  noShowGuests: number
  modified: number
}

const COMPLETED = new Set(['completed', 'complete', 'completada', 'confirmada', 'confirmed', 'seated'])
const CANCELLED = new Set(['cancelled', 'canceled', 'cancelada', 'cancelado'])
const NO_SHOW = new Set(['no_show', 'no-show', 'noshow'])

export function normalizeReservationStatus(status?: string | null): ReservationStatus {
  const normalized = (status || 'pending').trim().toLowerCase()
  if (COMPLETED.has(normalized)) return 'completed'
  if (CANCELLED.has(normalized)) return 'cancelled'
  if (NO_SHOW.has(normalized)) return 'no_show'
  return 'created'
}

export function reservationMetrics(rows: ReservationRecord[]): ReservationMetrics {
  const metrics: ReservationMetrics = {
    reservations: rows.length,
    guests: 0,
    averageParty: 0,
    completed: 0,
    completedGuests: 0,
    future: 0,
    futureGuests: 0,
    cancelled: 0,
    cancelledGuests: 0,
    noShow: 0,
    noShowGuests: 0,
    modified: 0,
  }

  for (const row of rows) {
    const guests = Number(row.guests) || 0
    const status = normalizeReservationStatus(row.status)
    metrics.guests += guests
    if (status === 'completed') {
      metrics.completed += 1
      metrics.completedGuests += guests
    } else if (status === 'cancelled') {
      metrics.cancelled += 1
      metrics.cancelledGuests += guests
    } else if (status === 'no_show') {
      metrics.noShow += 1
      metrics.noShowGuests += guests
    } else {
      metrics.future += 1
      metrics.futureGuests += guests
    }

    if (row.created_at && row.updated_at) {
      const created = new Date(row.created_at).getTime()
      const updated = new Date(row.updated_at).getTime()
      if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) metrics.modified += 1
    }
  }

  metrics.averageParty = metrics.reservations ? metrics.guests / metrics.reservations : 0
  return metrics
}

export function requestedWithinDays(row: ReservationRecord, days: number, now = new Date()): boolean {
  const requested = row.created_at ? new Date(row.created_at) : row.fecha ? new Date(`${row.fecha}T12:00:00`) : null
  if (!requested || Number.isNaN(requested.getTime())) return false
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - Math.max(0, days - 1))
  return requested >= start && requested <= now
}

export function revenueProjection(rows: ReservationRecord[], averageTicket: number) {
  let completedGuests = 0
  let futureGuests = 0
  for (const row of rows) {
    const guests = Number(row.guests) || 0
    const status = normalizeReservationStatus(row.status)
    if (status === 'completed') completedGuests += guests
    if (status === 'created') futureGuests += guests
  }
  return {
    generated: completedGuests * averageTicket,
    projected: futureGuests * averageTicket,
    potential: (completedGuests + futureGuests) * averageTicket,
    completedGuests,
    futureGuests,
  }
}

export type ReactivationSegment = 'recent' | 'active' | 'warm' | 'inactive'

export function segmentFromLastVisit(lastVisit: string | null, now = new Date()): ReactivationSegment {
  if (!lastVisit) return 'inactive'
  const visit = new Date(lastVisit)
  if (Number.isNaN(visit.getTime())) return 'inactive'
  const days = Math.max(0, Math.floor((now.getTime() - visit.getTime()) / 86_400_000))
  if (days <= 30) return 'recent'
  if (days <= 90) return 'active'
  if (days <= 179) return 'warm'
  return 'inactive'
}

export interface CampaignEconomicsInput {
  contacts: number
  responses: number
  reservations: number
  attended: number
  averageTicket: number
  foodCostRate: number
  monthlyFee: number
  seatedFee: number
  courtesyUnits: number
  courtesyUnitCost: number
}

export function campaignEconomics(input: CampaignEconomicsInput) {
  const revenue = input.attended * input.averageTicket
  const foodCost = revenue * input.foodCostRate
  const courtesyCost = input.courtesyUnits * input.courtesyUnitCost
  const campaignInvestment = input.monthlyFee + input.seatedFee + courtesyCost
  const totalCost = foodCost + campaignInvestment
  const incrementalProfit = revenue - totalCost
  return {
    revenue,
    foodCost,
    courtesyCost,
    campaignInvestment,
    totalCost,
    incrementalProfit,
    margin: revenue ? incrementalProfit / revenue : 0,
    roi: campaignInvestment ? incrementalProfit / campaignInvestment : 0,
    acquisitionCost: input.attended ? campaignInvestment / input.attended : 0,
    grossMarginPerGuest: input.attended ? (revenue - foodCost) / input.attended : 0,
    responseRate: input.contacts ? input.responses / input.contacts : 0,
    reservationRate: input.contacts ? input.reservations / input.contacts : 0,
    attendanceRate: input.contacts ? input.attended / input.contacts : 0,
  }
}
