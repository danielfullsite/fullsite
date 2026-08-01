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
