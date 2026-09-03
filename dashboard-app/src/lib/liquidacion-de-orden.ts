// Cuándo una orden está REALMENTE liquidada, y cuándo se avisa a cocina.
//
// ── EL DEFECTO QUE ESTO CIERRA ───────────────────────────────────────────────
//
// Campo, 2026-09-02 (Eduardo Esquivel, AMALAY): «siguen apareciendo platillos en
// órdenes que están ya cerradas». Se emitió `ORDER_CLOSED` al cobrar. Con cuenta
// dividida no funciona, y las dos salidas obvias son peores que el problema:
//
//   · Emitir el id del cobro (`{orden}-C1`): cocina guarda el id de la MADRE, no
//     coincide, y el tablero no se limpia nunca.
//   · Emitir el id de la madre en el primer pago: se borra de cocina la comida de
//     los otros comensales, que todavía no ha salido. Peor: es pérdida operativa
//     real en la mesa que más deja.
//
// Y la causa de fondo, medida: el estado del split vivía SÓLO en React, en UNA
// terminal (`splitPayingCuenta`, `page.tsx:3580`, un contador que se incrementa).
// Si esa terminal se reinicia o cobra otra caja, nadie sabe quién ya pagó.
//
// ── EL MODELO ────────────────────────────────────────────────────────────────
//
//   order_id     La orden madre. ESTABLE. Nunca cambia, nunca lleva sufijo. Es lo
//                que conoce cocina y lo único que puede cerrar su tablero.
//   account_id   Una cuenta a cobrar. ESTABLE y derivada, no inventada al vuelo.
//                Sin split hay exactamente una: la cuenta `full`.
//   payment_id   Un INTENTO de pago. Único. Un rechazo y su reintento son dos
//                intentos distintos; un reenvío del mismo cobro es el mismo.
//
// Se numeran las cuentas desde que el split se define, no conforme se van
// cobrando. Es la diferencia entre «faltan cuentas» y «no sé cuántas faltan».
//
// ── LA REGLA ─────────────────────────────────────────────────────────────────
//
// Una cuenta se liquida cuando lo ACEPTADO cubre su total (permite abonos).
// La orden se liquida cuando TODAS sus cuentas están liquidadas.
// `ORDER_CLOSED` se emite EXACTAMENTE UNA VEZ, con el `order_id` de la madre, en
// la transición a liquidada — nunca antes, nunca dos veces.
//
// Esto es dominio puro a propósito: sin red, sin React, sin base de datos. La
// decisión de cerrar cocina es de dinero, y tiene que poder probarse sin levantar
// nada. Quien lo use decide DÓNDE vive el estado; este módulo sólo dice qué
// significa.

/** Tolerancia en pesos. Flotantes: 0.1 + 0.2 !== 0.3, y un centavo no debe dejar una mesa abierta. */
const CENTAVO = 0.005

export type EstadoDePago = 'aceptado' | 'rechazado' | 'pendiente'

export interface Pago {
  /** Único por INTENTO. Un reintento tras rechazo es otro payment_id. */
  payment_id: string
  account_id: string
  monto: number
  estado: EstadoDePago
}

export interface Cuenta {
  account_id: string
  /** Lo que esa cuenta debe pagar. */
  total: number
}

export interface OrdenParaLiquidar {
  order_id: string
  /** Todas las cuentas, conocidas desde que se definió el split. */
  cuentas: Cuenta[]
  pagos: Pago[]
  /** Si ya se emitió el cierre. Lo aporta quien guarda el estado. */
  cierre_ya_emitido?: boolean
}

export interface EstadoDeCuenta {
  account_id: string
  total: number
  pagado: number
  liquidada: boolean
  /** Lo que falta. 0 si ya está cubierta (nunca negativo). */
  restante: number
}

export interface Liquidacion {
  order_id: string
  cuentas: EstadoDeCuenta[]
  totalDeLaOrden: number
  totalPagado: number
  /** Todas las cuentas cubiertas. */
  liquidada: boolean
  /**
   * La única señal que debe disparar `ORDER_CLOSED`. Verdadera SÓLO en la
   * transición: si el cierre ya se emitió, es falsa aunque siga liquidada.
   */
  debeEmitirCierre: boolean
  /** Para la UI: «faltan 2 de 4». */
  cuentasPendientes: string[]
}

/** Suma sólo lo ACEPTADO. Un pago pendiente o rechazado no cubre nada. */
function pagadoDe(accountId: string, pagos: Pago[]): number {
  let suma = 0
  const vistos = new Set<string>()
  for (const p of pagos) {
    if (p.account_id !== accountId || p.estado !== 'aceptado') continue
    // Un mismo payment_id repetido es EL MISMO pago llegando dos veces (reenvío,
    // doble tap, replay de la cola offline). Contarlo dos veces liquidaría una
    // cuenta a medio pagar — que es exactamente cómo se pierde dinero.
    if (vistos.has(p.payment_id)) continue
    vistos.add(p.payment_id)
    const monto = Number(p.monto)
    if (Number.isFinite(monto)) suma += monto
  }
  return suma
}

/**
 * El estado agregado de una orden. Función pura: mismas entradas, mismo veredicto.
 *
 * No decide si un pago es válido — eso es `puedeCobrar`. Aquí sólo se lee lo que
 * ya pasó.
 */
export function evaluarLiquidacion(orden: OrdenParaLiquidar): Liquidacion {
  const pagos = Array.isArray(orden?.pagos) ? orden.pagos : []
  const cuentas = Array.isArray(orden?.cuentas) ? orden.cuentas : []

  const estados: EstadoDeCuenta[] = cuentas.map((c) => {
    const total = Number.isFinite(Number(c.total)) ? Number(c.total) : 0
    const pagado = pagadoDe(c.account_id, pagos)
    const liquidada = pagado + CENTAVO >= total
    return {
      account_id: c.account_id,
      total,
      pagado,
      liquidada,
      restante: liquidada ? 0 : total - pagado,
    }
  })

  // Una orden SIN cuentas no está liquidada. Podría parecer trivialmente cierto
  // ("no falta nada"), y sería la forma exacta del bug de esta semana: un dato
  // ausente leído como un hecho. Sin cuentas no se sabe, y no saber no cierra
  // cocina.
  const liquidada = estados.length > 0 && estados.every((e) => e.liquidada)

  return {
    order_id: orden.order_id,
    cuentas: estados,
    totalDeLaOrden: estados.reduce((a, e) => a + e.total, 0),
    totalPagado: estados.reduce((a, e) => a + e.pagado, 0),
    liquidada,
    debeEmitirCierre: liquidada && !orden.cierre_ya_emitido,
    cuentasPendientes: estados.filter((e) => !e.liquidada).map((e) => e.account_id),
  }
}

export type MotivoDeRechazo =
  | 'cuenta_desconocida'
  | 'cuenta_ya_liquidada'
  | 'pago_duplicado'
  | 'monto_invalido'

export interface VeredictoDeCobro {
  permitido: boolean
  motivo?: MotivoDeRechazo
  /** Para el cajero, en su idioma. */
  mensaje?: string
  /**
   * Verdadero cuando este `payment_id` YA fue aceptado antes: no es un error, es
   * el mismo cobro llegando otra vez. Quien llama debe devolver el resultado
   * original SIN volver a cobrar.
   */
  esRepeticion?: boolean
}

/**
 * ¿Se puede cobrar esto? Es la guarda del doble cobro.
 *
 * Distingue dos casos que se ven iguales y NO lo son:
 *   · el MISMO intento llegando dos veces  → repetición: se devuelve lo de antes
 *   · OTRO intento sobre una cuenta ya pagada → doble cobro: se rechaza
 *
 * Confundirlos cobra dos veces al cliente, o pierde un cobro legítimo.
 */
export function puedeCobrar(
  orden: OrdenParaLiquidar,
  intento: { payment_id: string; account_id: string; monto: number },
): VeredictoDeCobro {
  const pagos = Array.isArray(orden?.pagos) ? orden.pagos : []

  const yaAceptado = pagos.find(
    (p) => p.payment_id === intento.payment_id && p.estado === 'aceptado',
  )
  if (yaAceptado) {
    return {
      permitido: false,
      motivo: 'pago_duplicado',
      esRepeticion: true,
      mensaje: 'Este cobro ya se había registrado.',
    }
  }

  const cuenta = (orden.cuentas || []).find((c) => c.account_id === intento.account_id)
  if (!cuenta) {
    // Falla CERRADA: cobrar contra una cuenta que no existe deja dinero sin
    // dueño y una orden que jamás liquida.
    return {
      permitido: false,
      motivo: 'cuenta_desconocida',
      mensaje: 'Esa cuenta no pertenece a esta orden.',
    }
  }

  const monto = Number(intento.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { permitido: false, motivo: 'monto_invalido', mensaje: 'El monto no es válido.' }
  }

  const pagado = pagadoDe(intento.account_id, pagos)
  if (pagado + CENTAVO >= cuenta.total) {
    // Es el escenario de dos terminales cobrando la misma cuenta. La segunda se
    // rechaza en vez de aceptarse y "cuadrarse después": un cobro de más ya salió
    // de la tarjeta del cliente.
    return {
      permitido: false,
      motivo: 'cuenta_ya_liquidada',
      mensaje: `La cuenta ${intento.account_id} ya está pagada.`,
    }
  }

  return { permitido: true }
}

// ── Construcción de ids ─────────────────────────────────────────────────────
//
// Se centraliza aquí para que NADIE vuelva a inventar un id con sufijo en el
// lugar del cobro. La forma vieja (`${orderId}-C${n}`) se usaba como id de ORDEN,
// y por eso cocina no la reconocía: parecía otra orden.

/** La cuenta única de una orden sin split. */
export function cuentaCompleta(orderId: string): string {
  return `${orderId}:full`
}

/** La cuenta n de un split. `n` empieza en 1, como la ve el mesero. */
export function cuentaDeSplit(orderId: string, n: number): string {
  return `${orderId}:c${n}`
}

/**
 * Un intento de pago. `opId` es el identificador de la operación de cobro, que ya
 * existe y ya es idempotente: así un doble tap produce el MISMO payment_id y se
 * detecta como repetición, no como cobro nuevo.
 */
export function intentoDePago(accountId: string, opId: string): string {
  return `${accountId}#${opId}`
}

/** El order_id de la madre a partir de cualquier account_id. Nunca lleva sufijo. */
export function ordenMadreDe(accountId: string): string {
  const i = accountId.lastIndexOf(':')
  return i === -1 ? accountId : accountId.slice(0, i)
}

/** Las cuentas de una orden: una si no hay split, n si lo hay. */
export function cuentasDe(
  orderId: string,
  totales: number[] | null,
  totalCompleto: number,
): Cuenta[] {
  if (!Array.isArray(totales) || totales.length === 0) {
    return [{ account_id: cuentaCompleta(orderId), total: totalCompleto }]
  }
  return totales.map((t, i) => ({ account_id: cuentaDeSplit(orderId, i + 1), total: t }))
}
