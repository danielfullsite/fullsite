/**
 * ¿Se puede confiar en lo que el servidor contesto sobre las mesas ocupadas?
 *
 * INCIDENTE 2026-08-31, AMALAY. La caja tenia 5 mesas con cuenta abierta y la
 * terminal Entrada las mostraba TODAS vacias. La causa era una sola linea:
 *
 *   const orders = ordersRes.ok ? await ordersRes.json() : []
 *
 * Ante un 401 la lista quedaba vacia, el plano pintaba todo libre, y esa lista
 * vacia se le pasaba a `reconcileCachedActiveOrders`, que entonces BORRABA del
 * cache local todas las ordenes activas. Una peticion fallida destruia el
 * registro de mesas ocupadas.
 *
 * Un plano de mesas no es un dato mas: es el que decide si se sienta gente. Una
 * lista vacia que NO se pudo verificar y una lista vacia CONFIRMADA por el
 * servidor significan cosas opuestas, y hay que poder distinguirlas.
 */
import { esFalloDeRed, esFalloDeAutenticacion } from '@/lib/clasificar-fallo'

export type LecturaDelPlano =
  /** El servidor contesto. La lista es la verdad: se puede pintar y reconciliar. */
  | { confiable: true }
  /** No se pudo confirmar. Sirve cache, avisa, y NUNCA reconcilies. */
  | { confiable: false; motivo: string }

export function evaluarRespuestaDeMesas(
  res: { ok: boolean; status: number; headers?: { get(n: string): string | null } },
): LecturaDelPlano {
  /**
   * Un 200 del Service Worker puede ser una respuesta GUARDADA, no fresca.
   *
   * CORRECCION: NO fue esto lo que le paso a Entrada. `pos_orders` esta en
   * NEVER_CACHE_PATTERNS del SW, asi que el plano nunca se sirve de ese cache. Lo de
   * Entrada fue el timeout del fetch cayendo a IndexedDB (T-26 en TEST-MATRIX.md).
   *
   * La marca sigue valiendo por otras consultas que el SW SI cachea —`pos_turnos`
   * entre ellas— y porque este guard debe seguir siendo correcto si mañana alguien
   * mueve una tabla de una lista a la otra. Es barato y falla del lado seguro.
   *
   * Se pinta igual —tener el dato viejo es mejor que no tener nada— pero NO se
   * reconcilia contra el cache local y se avisa en pantalla.
   */
  if (res.headers?.get('X-Fullsite-Stale') === '1') {
    return { confiable: false, motivo: 'Mostrando datos guardados, sin confirmar' }
  }
  if (res.ok) return { confiable: true }
  if (esFalloDeAutenticacion(res.status)) return { confiable: false, motivo: 'Tu sesion vencio' }
  if (esFalloDeRed(res.status)) return { confiable: false, motivo: 'Sin conexion con el servidor' }
  return { confiable: false, motivo: `El servidor rechazo la consulta (HTTP ${res.status})` }
}

/**
 * ¿Se puede reconciliar (o sea, BORRAR del cache lo que no venga en la lista)?
 *
 * Solo con una lectura confiable. Reconciliar con datos no confirmados es lo que
 * borraba las mesas ocupadas.
 */
export function sePuedeReconciliar(lectura: LecturaDelPlano): boolean {
  return lectura.confiable === true
}
