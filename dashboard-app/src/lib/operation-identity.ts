/**
 * Identidad de operación para escrituras que se pueden reproducir.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * Un append sin identidad no se puede reintentar: si la petición llegó y la
 * respuesta se perdió, el replay inserta una fila nueva. Auditado el 2026-09-17:
 * `pos_cash_movements`, `pos_audit_log` y `pos_market_movements` tienen PK por
 * secuencia y ninguna clave de negocio, así que hoy duplican.
 *
 * ── LA DISTINCIÓN QUE IMPORTA ───────────────────────────────────────────────
 * Un UUID aleatorio sirve para reintentar EL MISMO item. NO sirve para
 * deduplicar dos escritores independientes del MISMO evento lógico, salvo que
 * compartan el valor. Por eso hay dos familias, y elegir mal rompe justo el caso
 * que el arreglo pretendía cubrir:
 *
 *   ALEATORIA      la acción humana ES el evento. Dos retiros de $500 en el
 *                  mismo minuto son dos eventos, y un determinista los
 *                  colapsaría — borrando dinero declarado.
 *   DETERMINISTA   el evento pertenece a otra cosa (una orden, una recepción de
 *                  compra) y cualquier terminal que la procese debe producir la
 *                  MISMA identidad. Aquí un aleatorio duplicaría el efecto.
 */

/** ¿Hay `crypto.randomUUID` en este runtime? Node 24 y los navegadores del POS sí. */
function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Sin crypto no se inventa una identidad débil: se dice que no hay.
  throw new Error('crypto.randomUUID no disponible: no se puede generar identidad de operación')
}

/**
 * Identidad ALEATORIA, para acciones humanas.
 *
 * Se genera UNA vez, en el momento en que la persona confirma, y el MISMO valor
 * viaja en la escritura online y en el item encolado. Generarla al enviar —y no
 * al confirmar— la volvería distinta en cada intento, que es exactamente no
 * tener identidad.
 */
export function nuevaIdentidadDeAccion(): string {
  return uuid()
}

/** Identidad DETERMINISTA de un movimiento de inventario derivado de otra operación. */
export interface IdentidadDeMovimiento {
  movement_operation_key: string
  movement_operation_line: string
}

/**
 * Recepción de una orden de compra.
 *
 * `poId` es el id de la orden de compra y `poItemId` el del renglón: los dos los
 * asigna el servidor ANTES de la recepción, así que dos terminales que reciban
 * la misma OC producen la misma identidad, y un replay produce la misma que el
 * intento original. No se usa el índice del arreglo: el orden de un arreglo no
 * es identidad — depende de cómo se cargó la lista.
 */
export function identidadDeRecepcionDeCompra(poId: string, poItemId: number | string): IdentidadDeMovimiento {
  const key = String(poId ?? '').trim()
  const line = String(poItemId ?? '').trim()
  if (!key || !line) {
    throw new Error('identidadDeRecepcionDeCompra exige orden de compra y renglón')
  }
  return { movement_operation_key: `po:${key}`, movement_operation_line: line }
}

/** Cómo terminó una escritura que puede caer a la cola. El audit registra ESTO. */
export type ResultadoDeEscritura = 'saved' | 'queued' | 'failed'

/**
 * LA IDENTIDAD LÓGICA DE UN MOVIMIENTO DE CAJA, venga de donde venga.
 *
 * Un mismo retiro aparece hasta en tres formas mientras vive:
 *   · caché local  — la clave técnica del store IDB
 *   · cola durable — el payload que se reproducirá
 *   · nube         — la fila, con su `id` bigint del servidor
 *
 * El arqueo los fusiona, y si los compara por la llave equivocada cuenta dos
 * veces un movimiento o esconde uno. Ninguna de las dos es aceptable: es dinero.
 *
 * `client_op_id` es la única identidad que sobrevive a los tres estados. El `id`
 * del servidor NO sirve —no existe hasta que la fila se escribe— y el `id` local
 * sólo existe en registros viejos, de antes de que hubiera identidad. De ahí el
 * respaldo: los registros legacy se siguen leyendo por su `id`.
 */
export function claveLogicaDeCaja(m: { client_op_id?: unknown; id?: unknown } | null | undefined): string {
  if (!m) return ''
  const op = typeof m.client_op_id === 'string' ? m.client_op_id.trim() : ''
  if (op) return op
  // Legacy: registros anteriores a P0A, que sólo tienen `id` de cliente.
  const id = m.id === null || m.id === undefined ? '' : String(m.id).trim()
  return id
}
