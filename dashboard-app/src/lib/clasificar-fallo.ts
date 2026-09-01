/**
 * ¿Este fallo significa "no hay red" o significa "la peticion estaba mal"?
 *
 * LOS CUATRO BUGS DEL 2026-08-31 SON EL MISMO ERROR
 *
 * Todos fueron un fallo leido como si fuera otro:
 *
 *   1. save-order pedia `location_id` a pos_turnos, que no la tiene. PostgREST
 *      devolvia 400. El codigo lo leyo como "no hay turno" y respondia 409.
 *      El POS no pudo enviar NINGUNA comanda en toda la noche.
 *   2. getActiveTurnos tenia `if (!res.ok) return fromCache()`. Un 401 de sesion
 *      vencida servia un turno viejo del cache, que salia como "Turno del dia
 *      anterior - Corte Z", que no cerraba nada, que devolvia al PIN. En bucle.
 *   3. sendOrderToKitchen declaraba un enum que Chromium 130 no conoce. El
 *      TypeError llegaba a la UI como "no hay conexion con la caja".
 *   4. El webhook de Uber leia `ONLINE` como distinto de `ACTIVE` y persistia la
 *      tienda como cerrada.
 *
 * Confundir un error de contrato con un corte de red es peor que no manejarlo:
 * el sistema sigue operando con datos viejos y nadie se entera. Un 503 del
 * Service Worker SI es "no hay red". Un 400 o un 401 NO lo son, nunca.
 */

/** El servidor no se pudo alcanzar, o no pudo responder. Aqui SI vale el cache. */
const SIN_ALCANCE = new Set([
  0,   // fetch abortado / opaque
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests — reintentar, no invalidar
  500, 502, 503, 504, // el 503 es el que sintetiza el Service Worker sin red
  522, 523, 524, // timeouts de Cloudflare
])

/** El servidor SI respondio, y dijo que la peticion o la credencial estan mal. */
export function esFalloDeContrato(status: number): boolean {
  return !esFalloDeRed(status) && status >= 400
}

/** ¿Se puede servir cache ante este status sin mentirle al operador? */
export function esFalloDeRed(status: number): boolean {
  return SIN_ALCANCE.has(status)
}

/** La credencial vencio o no alcanza. Hay que volver a autenticar, no seguir. */
export function esFalloDeAutenticacion(status: number): boolean {
  return status === 401 || status === 403
}

/**
 * Error tipado para que la UI distinga "vuelve a entrar" de "no hay turno".
 *
 * Sin esto, un 401 caia en el mismo camino que "no hay turno abierto", y la
 * terminal ofrecia ABRIR OTRO TURNO con uno ya abierto en el servidor —
 * duplicando turnos, que es justo lo que hoy dejo 11 turnos basura en AMALAY.
 */
export class ErrorDeSesion extends Error {
  readonly status: number
  constructor(status: number, detalle = '') {
    super(`Sesion invalida (HTTP ${status})${detalle ? `: ${detalle}` : ''}`)
    this.name = 'ErrorDeSesion'
    this.status = status
  }
}

/** Error tipado para un fallo de contrato que NO es de sesion (400, 404, 409, 422). */
export class ErrorDeContrato extends Error {
  readonly status: number
  constructor(status: number, detalle = '') {
    super(`La peticion fue rechazada (HTTP ${status})${detalle ? `: ${detalle}` : ''}`)
    this.name = 'ErrorDeContrato'
    this.status = status
  }
}
