/**
 * Anular una orden completa: qué pasa con la mercancía de cada renglón.
 *
 * ── CONTRATO ─────────────────────────────────────────────────────────────────
 *
 * `r1_reconcile_order` (20260910060000) exige, para una orden
 * `cancelada`, una disposición explícita por renglón:
 *
 *   retain_consumption  se preparó: la mercancía se consumió, es merma; el stock
 *                       NO regresa aunque el renglón salga del ticket.
 *   return_stock        no se preparó: el consumo fijado se revierte.
 *
 * Sin disposición la conciliación falla y conserva stock y revisión; eso evita
 * devolver existencias ficticias, pero deja inventario pendiente. Este módulo es
 * la captura que faltaba (H08): quien autoriza la anulación decide renglón por
 * renglón, y el POS manda esos renglones con la anulación.
 *
 * ── LA PROPUESTA POR DEFECTO ES CONSERVADORA ─────────────────────────────────
 *
 * Lo que ya se envió a cocina se propone como `retain_consumption`: devolver
 * stock por suposición es exactamente lo que se corrigió. Lo que nunca se envió
 * no pudo consumirse: `return_stock`. El gerente cambia lo que haga falta.
 */

export type Disposicion = 'retain_consumption' | 'return_stock'

export interface RenglonAnulable {
  id: string
  nombre: string
  cantidad: number
  subtotal: number
  cancelled?: boolean
  inventory_disposition?: string
}

export const DISPOSICIONES: readonly Disposicion[] = ['retain_consumption', 'return_stock']

/** Renglones que todavía cuentan: no cancelados antes. */
export function renglonesVivos<T extends RenglonAnulable>(items: readonly T[]): T[] {
  return items.filter(i => i && typeof i.id === 'string' && !i.cancelled)
}

/** Propuesta inicial: enviado a cocina → merma; no enviado → regresa. */
export function disposicionPropuesta(items: readonly RenglonAnulable[], enviados: ReadonlySet<string>): Record<string, Disposicion> {
  const propuesta: Record<string, Disposicion> = {}
  for (const r of renglonesVivos(items)) propuesta[r.id] = enviados.has(r.id) ? 'retain_consumption' : 'return_stock'
  return propuesta
}

/**
 * Los renglones tal como viajan en la anulación: todos cancelados, cada uno con
 * su disposición y el motivo. Lanza si a algún renglón vivo le falta la
 * disposición: una anulación sin decisión no se manda, se pregunta.
 */
export function renglonesAnulados<T extends RenglonAnulable>(
  items: readonly T[],
  disposiciones: Readonly<Record<string, Disposicion>>,
  motivo: string,
): Array<T & { cancelled: true; inventory_disposition: Disposicion; cancellation_reason: string }> {
  const sinDecision = renglonesVivos(items).filter(r => !DISPOSICIONES.includes(disposiciones[r.id]))
  if (sinDecision.length > 0) {
    throw new Error(`CANCELLATION_DISPOSITION_REQUIRED: ${sinDecision.map(r => r.nombre || r.id).join(', ')}`)
  }
  return items.map(r => {
    // Un renglón cancelado antes conserva la disposición que ya tenía; si no la
    // tenía, se le exige ahora igual que a los vivos.
    const previa = DISPOSICIONES.includes(r.inventory_disposition as Disposicion) ? r.inventory_disposition as Disposicion : undefined
    const disposicion = r.cancelled ? (previa ?? disposiciones[r.id]) : disposiciones[r.id]
    if (!DISPOSICIONES.includes(disposicion)) {
      throw new Error(`CANCELLATION_DISPOSITION_REQUIRED: ${r.nombre || r.id}`)
    }
    return { ...r, cancelled: true as const, inventory_disposition: disposicion, cancellation_reason: motivo }
  })
}

/** Resumen para el ticket de auditoría: cuánta mercancía regresa y cuánta es merma. */
export function resumenDeDisposicion(items: readonly RenglonAnulable[], disposiciones: Readonly<Record<string, Disposicion>>) {
  let merma = 0, regresa = 0
  for (const r of renglonesVivos(items)) {
    if (disposiciones[r.id] === 'return_stock') regresa += Number(r.subtotal) || 0
    else if (disposiciones[r.id] === 'retain_consumption') merma += Number(r.subtotal) || 0
  }
  return { merma, regresa }
}
