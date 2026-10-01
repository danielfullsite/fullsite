/**
 * Estado operativo que viene del servidor para decidir si un día admite una
 * conclusión final. No se deriva del reloj del navegador.
 */
export interface DashboardOperationStatus {
  businessDate: string
  turnoAbierto: DashboardOpenTurn | null
}

export interface DashboardOpenTurn {
  id: string
  numero: number | null
  abiertoPor: string | null
  abiertoAt: string | null
  fondoInicial: number | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/

function partsAt(now: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  return Object.fromEntries(parts.map(p => [p.type, p.value]))
}

/** Día de negocio calculado en servidor con la zona y hora de arranque del cliente. */
export function businessDateAt(now: Date, timeZone: string, businessDayStart: string | null | undefined): string {
  const p = partsAt(now, timeZone)
  const start = TIME_RE.exec(businessDayStart || '00:00')
  if (!start) throw new Error('invalid business day start')
  const startMinutes = Number(start[1]) * 60 + Number(start[2])
  const currentMinutes = Number(p.hour) * 60 + Number(p.minute)
  const utcCalendar = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - (currentMinutes < startMinutes ? 1 : 0))
  return new Date(utcCalendar).toISOString().slice(0, 10)
}

/**
 * Un resultado final sólo se permite para un día anterior al día de negocio
 * confirmado por el servidor. Si Caja mantiene abierto el último día visible,
 * también se inhibe: puede ser un turno que cruzó medianoche.
 */
export function dayIsOpenForFinalDetection(
  viewDate: string | null | undefined,
  status: DashboardOperationStatus | null,
  isLatestVisibleDay: boolean,
): boolean {
  if (!viewDate || !DATE_RE.test(viewDate) || !status || !DATE_RE.test(status.businessDate)) return true
  return viewDate >= status.businessDate || (isLatestVisibleDay && status.turnoAbierto !== null)
}
