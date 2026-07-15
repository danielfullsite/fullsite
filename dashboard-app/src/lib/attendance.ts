/**
 * Canonical ACTIVE_ON_SHIFT derivation from pos_attendance.
 *
 * Uses staff_id (UUID) — NOT staff_name.
 * Uses registered_at (server-generated) — NOT client clock.
 * Does NOT use pos_sessions, pos_orders.mesero, or terminal activity.
 *
 * Attendance status:
 * - ACTIVE_ON_SHIFT: open entrada < 18 hours old
 * - STALE_ENTRADA: open entrada >= 18 hours old (likely forgotten clock-out)
 * - NOT_ON_SHIFT: latest event is salida, or no events today
 */

const STALE_HOURS = 18

export type AttendanceStatus = 'ACTIVE_ON_SHIFT' | 'STALE_ENTRADA' | 'NOT_ON_SHIFT'

export interface StaffAttendance {
  staff_id: string
  staff_name: string
  role?: string
  active_since: string | null   // entrada timestamp if active
  attendance_status: AttendanceStatus
}

interface AttendanceEvent {
  staff_id: string
  staff_name: string
  type: 'entrada' | 'salida'
  registered_at: string
}

/**
 * Derive canonical active labor presence from pos_attendance events.
 *
 * @param events - Today's attendance events, ordered by registered_at ASC
 * @param staffRoles - Optional map of staff_id → role from pos_staff
 * @param now - Current timestamp (default: Date.now())
 * @returns Array of StaffAttendance for all staff with events today
 */
export function deriveActiveStaff(
  events: AttendanceEvent[],
  staffRoles?: Map<string, string>,
  now?: number
): StaffAttendance[] {
  const nowMs = now ?? Date.now()
  // Process events in chronological order per staff_id
  const state = new Map<string, { name: string; activeSince: string | null }>()

  for (const e of events) {
    if (e.type === 'entrada') {
      state.set(e.staff_id, { name: e.staff_name, activeSince: e.registered_at })
    } else if (e.type === 'salida') {
      const current = state.get(e.staff_id)
      if (current) {
        current.activeSince = null
      } else {
        state.set(e.staff_id, { name: e.staff_name, activeSince: null })
      }
    }
  }

  const result: StaffAttendance[] = []
  for (const [staffId, s] of state) {
    let status: AttendanceStatus = 'NOT_ON_SHIFT'
    if (s.activeSince) {
      const hoursOpen = (nowMs - new Date(s.activeSince).getTime()) / 3600000
      status = hoursOpen >= STALE_HOURS ? 'STALE_ENTRADA' : 'ACTIVE_ON_SHIFT'
    }
    result.push({
      staff_id: staffId,
      staff_name: s.name,
      role: staffRoles?.get(staffId),
      active_since: s.activeSince,
      attendance_status: status,
    })
  }

  return result
}

/**
 * Get current active staff count by role.
 * Only counts ACTIVE_ON_SHIFT (excludes STALE_ENTRADA).
 */
export function getActiveCountByRole(staff: StaffAttendance[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of staff) {
    if (s.attendance_status === 'ACTIVE_ON_SHIFT' && s.role) {
      counts.set(s.role, (counts.get(s.role) || 0) + 1)
    }
  }
  return counts
}
