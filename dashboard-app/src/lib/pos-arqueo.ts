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
//
// `methodTypeMap` (de `pos_payment_methods`) NO es un lujo opcional: sin él las
// formas se adivinan por el nombre y `Dólares` —efectivo físico— cae en tarjeta.
// El wizard lo pasaba vacío y ahí se cerraba la caja. Hoy lo pasa siempre, con
// `getPaymentMethodsFromDB()`, que ya trae su propio caché offline.

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
  /**
   * Plataformas (Rappi/Uber/DiDi) y "otros" del catálogo: cortesías, vales,
   * venta a terceros. No es efectivo ni se concilia contra la terminal bancaria;
   * vivía sumado dentro de `tarjeta` y ahí no lo podía explicar nadie.
   */
  otros: number
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

/**
 * A QUÉ CAJÓN PERTENECE CADA FORMA DE PAGO.
 *
 * El catálogo `pos_payment_methods` YA sabe el tipo de cada forma. Cuando llega
 * el mapa se usa el mapa; adivinar por el nombre es el último recurso, no el
 * primero. AMALAY tiene 18 formas activas heredadas de Wansoft y sólo tres se
 * pueden adivinar por el nombre: "Efectivo", "Transferencia" y las que digan
 * "tarjeta". Las otras quince —Dólares, Cortesía, Vale Amalay, Rappi, Ubereats,
 * DiDi, Venta Terceros, Mercadotecnia, Influencer…— no se parecen a nada.
 *
 * `Dólares` es el caso que cuesta dinero: está catalogado como `cash`, o sea
 * billetes FÍSICOS en el cajón, y el nombre no contiene "efectivo" ni "cash".
 * Sin mapa cae en `card`, el efectivo esperado sale corto por ese monto, y el
 * conteo aparece con SOBRANTE — que además tapa un faltante del mismo tamaño.
 */
type TipoDeForma = 'cash' | 'transfer' | 'card' | 'otros'

function tipoDeForma(name: string, methodTypeMap?: Record<string, string>): TipoDeForma {
  const t = methodTypeMap?.[name.toLowerCase()]
  if (t) {
    if (t === 'cash') return 'cash'
    if (t === 'transfer') return 'transfer'
    // `terminal` (Clip) es tarjeta: cobra la terminal bancaria y se concilia con ella.
    if (t === 'card' || t === 'terminal') return 'card'
    // `platform` (Rappi/Uber/DiDi) y `other` (cortesías, vales, venta a terceros) no
    // son tarjeta. Meterlos ahí ensucia justo el número que se concilia contra la
    // terminal, y la diferencia queda sin dueño.
    return 'otros'
  }
  // Sin mapa: heurística por nombre, idéntica a la de antes. Se conserva porque un
  // nombre suelto que el catálogo no tiene tiene que caer en algún lado, y cambiarle
  // el destino movería cierres viejos de bucket sin ninguna razón.
  const lower = name.toLowerCase()
  if (lower.includes('efectivo') || lower.includes('cash')) return 'cash'
  if (lower.includes('transferencia')) return 'transfer'
  return 'card'
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
  let efectivo = 0, tarjeta = 0, transferencias = 0, otros = 0
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

      const tipo = tipoDeForma(p.metodo, methodTypeMap)
      if (tipo === 'cash') {
        efectivo += ventaFrac
        propinaEfectivo += propinaFrac
      } else {
        if (tipo === 'transfer') transferencias += ventaFrac
        else if (tipo === 'card') tarjeta += ventaFrac
        else otros += ventaFrac
        // La propina de todo lo que NO es efectivo sale del cajón igual: se le paga
        // al mesero en billetes. El reparto de la venta cambió; éste no.
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
    efectivo, tarjeta, transferencias, otros,
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
