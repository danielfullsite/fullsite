/**
 * pos-arqueo — single source of truth for cash-drawer reconciliation.
 *
 * Use calcEfectivoEsperado() in every context that shows the operator
 * how much cash should be in the drawer: wizard, Corte X, Corte Z, print
 * tickets, and any future FEOS financial summary.
 *
 * Never inline this formula again.
 */

// ── Canonical input type ──────────────────────────────────────────────────────

export interface ArqueoInput {
  fondoInicial: number
  ventasEfectivo: number
  /** Propinas collected in cash — they stay in the drawer. */
  propinaEfectivo: number
  /**
   * Propinas collected via card/transfer that must be paid to staff from the
   * cash drawer. These reduce the expected cash balance.
   */
  propinasNoEfectivo: number
  depositos: number
  retiros: number
}

// ── Canonical result ──────────────────────────────────────────────────────────

export interface ArqueoResult {
  efectivoEsperado: number
  diferencia: number          // totalContado - efectivoEsperado (positive = surplus)
  totalContado: number | null
  breakdown: Readonly<ArqueoInput>
}

// ── THE formula ──────────────────────────────────────────────────────────────

export function calcEfectivoEsperado(
  input: ArqueoInput,
  totalContado?: number,
): ArqueoResult {
  const {
    fondoInicial,
    ventasEfectivo,
    propinaEfectivo,
    propinasNoEfectivo,
    depositos,
    retiros,
  } = input

  const efectivoEsperado =
    fondoInicial
    + ventasEfectivo
    + propinaEfectivo
    + depositos
    - retiros
    - propinasNoEfectivo

  return {
    efectivoEsperado,
    diferencia: totalContado !== undefined ? totalContado - efectivoEsperado : 0,
    totalContado: totalContado ?? null,
    breakdown: { ...input },
  }
}

// ── Order + movement summary ──────────────────────────────────────────────────
// Shared computation from raw DB rows → ArqueoInput + OrderSummary.
// Both the Wizard and the Corte page call this; the only difference is whether
// they pass a methodTypeMap from pos_payment_methods (richer) or rely on
// name-heuristics (acceptable for the wizard's local-first flow).

export interface PagoFormaLike {
  metodo: string
  monto: number
}

export interface OrderLike {
  status: string
  total: number
  descuento?: number | null
  propina?: number | null
  metodo_pago?: string | null
  pagos?: PagoFormaLike[] | null
}

export interface CashMovLike {
  type: string
  amount: number
}

export interface OrderSummary {
  efectivo: number
  tarjeta: number
  transferencias: number
  totalVentas: number
  ticketsCount: number
  cancelaciones: number
  descuentos: number
  propinas: number
  propinaEfectivo: number
  propinasNoEfectivo: number
  depositos: number
  retiros: number
}

function isEfectivoMethod(name: string, methodTypeMap?: Record<string, string>): boolean {
  if (methodTypeMap) {
    const t = methodTypeMap[name.toLowerCase()]
    if (t) return t === 'cash'
  }
  const lower = name.toLowerCase()
  return lower.includes('efectivo') || lower.includes('cash')
}

function isTransferenciaMethod(name: string, methodTypeMap?: Record<string, string>): boolean {
  if (methodTypeMap) {
    const t = methodTypeMap[name.toLowerCase()]
    if (t) return t === 'transfer'
  }
  return name.toLowerCase().includes('transferencia')
}

/**
 * Compute order totals and propina breakdown from a raw list of orders and
 * cash movements. Pass methodTypeMap from pos_payment_methods when available
 * for exact type matching; otherwise name heuristics are used.
 */
export function computeOrderSummary(
  orders: OrderLike[],
  cashMovements: CashMovLike[],
  methodTypeMap?: Record<string, string>,
): OrderSummary {
  let efectivo = 0, tarjeta = 0, transferencias = 0
  let totalVentas = 0, ticketsCount = 0, cancelaciones = 0, descuentos = 0
  let propinas = 0, propinaEfectivo = 0, propinasNoEfectivo = 0

  for (const o of orders) {
    if (o.status === 'cancelada') { cancelaciones++; continue }
    if (o.status !== 'cerrada') continue

    ticketsCount++
    const total = Number(o.total) || 0
    const propina = Number(o.propina) || 0
    const descuento = Number(o.descuento) || 0

    totalVentas += total
    descuentos += descuento
    propinas += propina

    // Split-payment support: use pagos[] if present, fall back to single metodo_pago
    const cobrado = total + propina
    const pagos: PagoFormaLike[] =
      Array.isArray(o.pagos) && o.pagos.length > 0
        ? o.pagos
        : [{ metodo: o.metodo_pago || 'sin metodo', monto: cobrado }]

    const sumPagos = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0) || 1

    for (const p of pagos) {
      const frac = (Number(p.monto) || 0) / sumPagos
      const ventaFrac = total * frac
      const propinaFrac = propina * frac

      if (isEfectivoMethod(p.metodo, methodTypeMap)) {
        efectivo += ventaFrac
        propinaEfectivo += propinaFrac
      } else if (isTransferenciaMethod(p.metodo, methodTypeMap)) {
        transferencias += ventaFrac
        propinasNoEfectivo += propinaFrac
      } else {
        tarjeta += ventaFrac
        propinasNoEfectivo += propinaFrac
      }
    }
  }

  let depositos = 0, retiros = 0
  for (const m of cashMovements) {
    if (m.type === 'deposito') depositos += Number(m.amount) || 0
    else if (m.type === 'retiro') retiros += Number(m.amount) || 0
  }

  return {
    efectivo, tarjeta, transferencias,
    totalVentas, ticketsCount, cancelaciones, descuentos,
    propinas, propinaEfectivo, propinasNoEfectivo,
    depositos, retiros,
  }
}

/**
 * Shorthand: given an OrderSummary (from computeOrderSummary) and fondoInicial,
 * return a ready-to-use ArqueoInput.
 */
export function summaryToArqueoInput(
  summary: OrderSummary,
  fondoInicial: number,
): ArqueoInput {
  return {
    fondoInicial,
    ventasEfectivo: summary.efectivo,
    propinaEfectivo: summary.propinaEfectivo,
    propinasNoEfectivo: summary.propinasNoEfectivo,
    depositos: summary.depositos,
    retiros: summary.retiros,
  }
}
