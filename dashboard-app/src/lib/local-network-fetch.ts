/**
 * Fetch hacia el bridge local desde la pagina HTTPS del POS.
 *
 * Chromium Local Network Access exige declarar el espacio de direcciones antes
 * de resolver el destino. Sin esta opcion, incluso 127.0.0.1 puede bloquearse
 * antes de que el request salga del navegador.
 *
 * Chromium ya implementa esta opcion, aunque algunas versiones de TypeScript
 * todavia no la incluyen en RequestInit.
 *
 * EL ESPACIO SE DERIVA DEL DESTINO, NO ES FIJO
 *
 * Antes se declaraba `'local'` siempre. Chromium lo rechaza cuando el destino es
 * loopback, con este error exacto — capturado en la consola de Chrome en la
 * terminal Entrada de AMALAY el 2026-08-31:
 *
 *   Access to fetch at 'http://127.0.0.1:7717/health' from origin
 *   'https://app.fullsite.mx' has been blocked by CORS policy: Request had a
 *   target IP address space of `local` yet the resource is in address space
 *   `loopback`.
 *
 * O sea que el request se bloqueaba ANTES de salir del navegador: el bridge
 * quedaba inalcanzable —sin impresion y sin comanda a cocina— desde cualquier
 * pagina que no corriera bajo el switch de Electron.
 *
 * En las terminales no se noto porque el build 1.3.9 desactiva las tres puertas
 * de PNA (`main.js`, `disable-features=BlockInsecurePrivateNetworkRequests,...`),
 * asi que ahi el valor equivocado daba igual. El switch estaba tapando el bug,
 * no arreglandolo: en un navegador normal, o en una terminal sin ese build, el
 * puente estaba muerto.
 *
 * Los dos espacios se usan de verdad, por eso se deriva en vez de fijarse:
 *   - POS secundario  -> `http://127.0.0.1:7717`  (loopback)
 *   - `pos_bridge_host` apuntando a la caja -> `http://192.168.1.71:7717` (local)
 */

type TargetAddressSpace = 'loopback' | 'local'

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: TargetAddressSpace
}

/** Extrae el host del destino, sea string, URL o Request. */
function hostOf(input: RequestInfo | URL): string {
  const href =
    typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : input.url
  return new URL(href).hostname.toLowerCase()
}

/**
 * `loopback` para 127.0.0.0/8, ::1 y localhost; `local` para el resto de la LAN.
 * Ante cualquier duda devuelve `local`, que es el comportamiento previo.
 */
export function targetAddressSpaceFor(input: RequestInfo | URL): TargetAddressSpace {
  let host: string
  try {
    host = hostOf(input)
  } catch {
    return 'local'
  }
  // Las URL con IPv6 llegan entre corchetes: [::1]
  const bare = host.replace(/^\[|\]$/g, '')
  if (bare === 'localhost' || bare.endsWith('.localhost')) return 'loopback'
  if (bare === '::1' || bare === '0:0:0:0:0:0:0:1') return 'loopback'
  // 127.0.0.0/8 completo, no solo 127.0.0.1
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return 'loopback'
  return 'local'
}

export function localNetworkFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const localInit: LocalNetworkRequestInit = {
    ...init,
    targetAddressSpace: targetAddressSpaceFor(input),
  }
  return fetch(input, localInit)
}
