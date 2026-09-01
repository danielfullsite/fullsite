// GUARD-08 — pure logic for open-order guard during shift close.
// Extracted for testability and re-use in CierreCajaWizard.

export const OPEN_ORDER_STATUSES = ['enviada', 'preparando', 'lista'] as const
export type OpenOrderStatus = (typeof OPEN_ORDER_STATUSES)[number]

export interface OpenOrder {
  id: string
  mesa: number
  mesero: string
  status: OpenOrderStatus
  total: number
}

/** Returns orders that block a clean shift close. */
export function filterOpenOrders(
  orders: Array<{ id: string; mesa: number; mesero: string; status: string; total: number }>
): OpenOrder[] {
  return orders.filter((o) =>
    OPEN_ORDER_STATUSES.includes(o.status as OpenOrderStatus)
  ) as OpenOrder[]
}

export interface EscalationValidation {
  valid: boolean
  error?: string
}

const MIN_NOTA_LENGTH = 10

/** Validates the manager's override note. */
export function validateEscalationNota(nota: string): EscalationValidation {
  const trimmed = nota.trim()
  if (!trimmed) return { valid: false, error: 'La nota de autorización es obligatoria' }
  if (trimmed.length < MIN_NOTA_LENGTH) {
    return {
      valid: false,
      error: `Mínimo ${MIN_NOTA_LENGTH} caracteres (${trimmed.length}/${MIN_NOTA_LENGTH})`,
    }
  }
  return { valid: true }
}

/**
 * Merges GUARD-08 escalation fields into any cierre payload.
 * Fields are always present so the sync queue has full context even offline.
 * Requires DB migration: see docs/playbooks/SQL-MIGRATION.md (GUARD-08).
 */
export function withEscalationPayload<T extends Record<string, unknown>>(
  payload: T,
  openOrders: OpenOrder[],
  authorizedBy: string | null,
  nota: string | null
): T & {
  cierre_con_ordenes_abiertas: boolean
  ordenes_pendientes: string[]
  cierre_autorizado_por: string | null
  cierre_nota: string | null
} {
  return {
    ...payload,
    cierre_con_ordenes_abiertas: openOrders.length > 0,
    ordenes_pendientes: openOrders.map((o) => o.id),
    cierre_autorizado_por: authorizedBy,
    cierre_nota: nota,
  }
}

const STATUS_LABELS: Record<OpenOrderStatus, string> = {
  enviada: 'Enviada a cocina',
  preparando: 'En preparación',
  lista: 'Lista — sin cobrar',
}

/** Human-readable status label for the guard screen order list. */
export function openOrderStatusLabel(status: OpenOrderStatus): string {
  return STATUS_LABELS[status] ?? status
}

// ─── Guarda al ABRIR turno (regla de Eduardo) ────────────────────────────────
//
// Eduardo Esquivel, AMALAY:
//   "No puedes abrir un turno si sigues teniendo cuentas abiertas del turno
//    anterior… hay que matarlas todas."
//   "No puede haber cuentas abiertas de un día para otro."
//
// El módulo ya tenía la guarda al CERRAR (GUARD-08). La de ABRIR no existía:
// `filterOpenOrders` sólo lo consumía `CierreCajaWizard`. Ésta es la simétrica.
//
// DOS REGLAS QUE CHOCAN, Y CÓMO SE RESUELVEN
//
// Eduardo dice BLOQUEAR. El protocolo de offline dice que abrir el día NUNCA se
// bloquea por red (regla dura #3 de OFFLINE-LAN-FIELD-PROVEN §4). Las dos son
// correctas y no se contradicen si se separa el caso:
//
//   - La consulta SÍ se pudo hacer y hay cuentas  -> BLOQUEA (Eduardo).
//   - La consulta SÍ se pudo hacer y no hay nada  -> abre normal.
//   - La consulta NO se pudo hacer (401, sin red) -> ABRE, con aviso.
//
// Bloquear el arranque del día por un fetch fallido sería repetir el error del
// 2026-08-31: un fallo leído como si fuera un hecho. Ver `clasificar-fallo.ts`.

/** Resultado de buscar cuentas abiertas antes de abrir turno. */
export type LecturaDeCuentas =
  /** El servidor contestó. `cuentas` es la verdad. */
  | { determinado: true; cuentas: OpenOrder[] }
  /** No se pudo saber. NO es lo mismo que "no hay". */
  | { determinado: false; motivo: string }

export interface VeredictoApertura {
  /** ¿Se puede abrir turno? */
  permitido: boolean
  /** Cuentas que hay que cerrar antes. Vacío si no bloquean. */
  bloqueantes: OpenOrder[]
  /** Aviso a mostrar aunque se permita abrir. `null` si no hay nada que decir. */
  aviso: string | null
}

/**
 * ¿Se puede abrir turno con lo que se sabe?
 *
 * Pura: no toca red ni almacenamiento. Toda la política vive aquí para poder
 * probarla sin montar el componente.
 */
export function evaluarAperturaDeTurno(lectura: LecturaDeCuentas): VeredictoApertura {
  if (!lectura.determinado) {
    // Nunca se bloquea el día por no haber podido comprobar. Se avisa.
    return {
      permitido: true,
      bloqueantes: [],
      aviso: `No se pudieron revisar las cuentas del turno anterior (${lectura.motivo}). ` +
             `Revisa en la caja que no quede ninguna abierta.`,
    }
  }
  const bloqueantes = filterOpenOrders(lectura.cuentas)
  if (bloqueantes.length === 0) return { permitido: true, bloqueantes: [], aviso: null }
  return {
    permitido: false,
    bloqueantes,
    aviso: `Hay ${bloqueantes.length} ${bloqueantes.length === 1 ? 'cuenta abierta' : 'cuentas abiertas'} ` +
           `del turno anterior. Ciérralas antes de abrir turno.`,
  }
}

/** Suma de lo que está colgando, para enseñarlo antes de matar nada. */
export function totalDeCuentas(cuentas: OpenOrder[]): number {
  return cuentas.reduce((acc, c) => acc + (Number(c.total) || 0), 0)
}
