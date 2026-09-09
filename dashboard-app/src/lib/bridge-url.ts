// DÓNDE ESTÁ LA CAJA. Una sola respuesta para todo el POS.
//
// ── EL DEFECTO QUE ESTO CIERRA ───────────────────────────────────────────────
//
// Campo, reportado por Daniel el 2026-09-08 como el bug mayor: «una mesa ocupada
// no se reflejaba en otro punto de venta que no fuera el punto de venta con el
// que ocupé la mesa; no estaba todo en sintonía».
//
// Hay DOS llaves para decir dónde vive la caja, y no todos los consumidores
// leían las mismas:
//
//   FULLSITE_BRIDGE_URL   la URL completa. La pone el laboratorio y la config manual.
//   pos_bridge_host       sólo la IP. La pone `setPosServerHost()` desde el
//                         parámetro `?bridge=`, que es la vía real de instalación
//                         de una terminal secundaria (bridge-client.ts:45).
//
//   consumidor                                    URL   host
//   bridge-client.ts:31-34   (WebSocket)          sí    sí
//   server-discovery.ts:357  (descubrimiento)     —     sí
//   pedro-cliente.ts:28      (requiereCaja)       sí    sí
//   getBridgeUrl()           (ESTE archivo)       sí    NO   ← el hueco
//
// `leerSalon()` —la que llena el MAPA DE MESAS— pasa por aquí. Así que en una
// terminal instalada con `?bridge=`:
//
//   · su WebSocket SÍ se conectaba a la caja,
//   · `requiereCaja()` SÍ devolvía true,
//   · pero el estado del salón se pedía a `http://127.0.0.1:7717` — A SÍ MISMA.
//
// Con Electron, esa terminal levanta su propio servidor local, que contesta 200
// con SU salón —vacío, porque las órdenes se abrieron en la caja—. El mapa lo
// trata como autoritativo (`debeUsarPedro`) y pinta las mesas LIBRES. Dos
// terminales, dos verdades, y la mesa ocupada invisible en la otra: una mesa se
// puede sentar dos veces.
//
// Sin Electron el síntoma es el opuesto y también malo: nadie contesta en
// loopback, `requiereCaja()` es true, y la terminal se queda en «Sin conexión
// con la caja — mesas sin confirmar» aunque la caja esté sana y su WebSocket
// conectado.
//
// El arreglo es que esta función derive el destino igual que
// `server-discovery.ts:357`, que ya lo hacía bien: `http://${host}:7717`.

const DEFAULT = 'http://127.0.0.1:7717'
const STORAGE_KEY = 'FULLSITE_BRIDGE_URL'
const HOST_KEY = 'pos_bridge_host'
const LOCAL_PORT = 7717

/**
 * La dirección HTTP de la caja para ESTA terminal.
 *
 * Precedencia: la URL completa gana sobre la IP, porque es la más específica —
 * lleva puerto y esquema, y es la que usa el laboratorio multi-terminal para
 * levantar dos Pedros en la misma máquina con puertos distintos.
 */
export function getBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const url = localStorage.getItem(STORAGE_KEY)
    if (url && url.trim()) return url.trim()

    const host = localStorage.getItem(HOST_KEY)?.trim()
    if (host) {
      // El host puede venir con puerto ya puesto ("192.168.1.71:7717") o sin él.
      // Se respeta el que traiga: una instalación con el puerto cambiado no debe
      // quedar apuntando al 7717 por una suposición nuestra.
      if (/^https?:\/\//i.test(host)) return host.replace(/\/$/, '')
      return host.includes(':') ? `http://${host}` : `http://${host}:${LOCAL_PORT}`
    }
  } catch { /* almacenamiento bloqueado — se cae al loopback, que es lo de antes */ }
  return DEFAULT
}

export function setBridgeUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed || trimmed === DEFAULT) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, trimmed)
  }
}

export { DEFAULT as DEFAULT_BRIDGE_URL }
