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
   * Cuando la red tarda mas del limite, el SW cae a su cache y devuelve la copia
   * con su 200 original. Antes eso era indistinguible de un dato fresco: asi fue
   * como Entrada mostro las mesas 1 a 5 con la 7 abierta, refrescando cada 3 s.
   * El SW (v43) ahora marca esas respuestas con `X-Fullsite-Stale`.
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
