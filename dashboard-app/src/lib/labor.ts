// ── Tacómetro de mano de obra ───────────────────────────────────────────────
// Contrato: el % de mano de obra sobre venta es el semáforo operativo que un
// operador de fast food revisa en tiempo real (verde/amarillo/rojo). La verdad
// de costo vive en el servidor (/api/labor lee pos_staff_shifts × pos_staff.
// hourly_rate con service key — los sueldos son sensibles). Aquí viven las
// piezas PURAS y testeables: umbrales, zona del semáforo, y el cruce labor↔venta
// por día. La venta se reusa de getDashboardFromPosOrders (no se recalcula acá).
//
// Roles NO operativos (fuera del cálculo, criterio de Billy Newell 2026-09-01:
// "solo entra lo indispensable de operación; corporativo/oficina/mantenimiento no"):
export const NON_OPERATIONAL_ROLES = new Set([
  'admin', 'administrador', 'dueño', 'dueno', 'owner', 'corporativo', 'corporate',
  'oficina', 'office', 'mantenimiento', 'maintenance', 'chofer', 'contador', 'rh',
])

export function isOperationalRole(role: string | null | undefined): boolean {
  if (!role) return true // sin rol → se asume operativo (mejor sobre-contar que ocultar)
  return !NON_OPERATIONAL_ROLES.has(role.trim().toLowerCase())
}

// Umbrales por defecto del % labor/venta. Mezcla fast-food (verde ~14-18%) y
// full-service (verde ~25%). Son overridables por tenant (client_config) más
// adelante; hoy son constantes documentadas.
export interface LaborThresholds { green: number; yellow: number } // rojo = > yellow
export const DEFAULT_THRESHOLDS: LaborThresholds = { green: 0.22, yellow: 0.30 }

export type LaborZone = 'verde' | 'amarillo' | 'rojo' | 'sin-dato'

export function zoneFor(pct: number | null, t: LaborThresholds = DEFAULT_THRESHOLDS): LaborZone {
  if (pct == null || !isFinite(pct) || pct < 0) return 'sin-dato'
  if (pct <= t.green) return 'verde'
  if (pct <= t.yellow) return 'amarillo'
  return 'rojo'
}

// ── Tipos del payload de /api/labor ─────────────────────────────────────────
export interface LaborDay { fecha: string; cost: number; hours: number; headcount: number }
export interface LaborEmployee { staff_id: string; name: string; role: string; hours: number; cost: number }
export interface LaborPayload {
  days: number
  laborByDay: LaborDay[]
  employees: LaborEmployee[]
  totalCost: number
  totalHours: number
  hasWageData: boolean // false si todos los sueldos son 0 → el % no es confiable
}

// ── Cruce labor ↔ venta por día ──────────────────────────────────────────────
export interface DailyLabor {
  fecha: string
  cost: number
  hours: number
  headcount: number
  sales: number
  pct: number | null // labor/venta; null si venta 0
  zone: LaborZone
}

export interface TacometroSummary {
  totalCost: number
  totalSales: number
  totalHours: number
  pct: number | null
  zone: LaborZone
  days: DailyLabor[]
  employees: LaborEmployee[]
  hasWageData: boolean
}

/** Une el costo de labor (servidor) con la venta por día (getDashboardFromPosOrders). */
export function buildTacometro(
  labor: LaborPayload,
  salesByDay: Array<{ fecha: string; ventas_dia: number }>,
  thresholds: LaborThresholds = DEFAULT_THRESHOLDS,
): TacometroSummary {
  const salesMap = new Map<string, number>()
  for (const s of salesByDay) salesMap.set(s.fecha, (salesMap.get(s.fecha) || 0) + (Number(s.ventas_dia) || 0))

  const days: DailyLabor[] = labor.laborByDay.map(d => {
    const sales = salesMap.get(d.fecha) || 0
    const pct = sales > 0 ? d.cost / sales : null
    return { fecha: d.fecha, cost: d.cost, hours: d.hours, headcount: d.headcount, sales, pct, zone: zoneFor(pct, thresholds) }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha))

  const totalCost = labor.totalCost
  const totalSales = days.reduce((s, d) => s + d.sales, 0)
  const pct = totalSales > 0 ? totalCost / totalSales : null

  return {
    totalCost,
    totalSales,
    totalHours: labor.totalHours,
    pct,
    zone: zoneFor(pct, thresholds),
    days,
    employees: labor.employees,
    hasWageData: labor.hasWageData,
  }
}
