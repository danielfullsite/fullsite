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

/**
 * `loopback` NO existe en todos los Chromium.
 *
 * INCIDENTE 2026-08-31, caja de AMALAY: el POS guardaba la orden pero la comanda no
 * llegaba a cocina, con el modal "no hay conexion con la caja". Pedro estaba vivo y
 * aceptaba POST desde fuera — el request moria dentro del navegador.
 *
 * Local Network Access renombro los espacios de direcciones: lo que antes era `local`
 * paso a `loopback`, y `private` paso a `local`. Ese renombre es reciente. Las
 * terminales corren Electron 33 = **Chromium 130**, donde `targetAddressSpace` YA
 * existe pero sus valores validos son `local`/`private`/`public`. Un valor invalido en
 * un campo CONOCIDO de RequestInit lanza TypeError — no se ignora — y el fetch nunca
 * sale.
 *
 * El error que motivo el cambio a `loopback` se capturo en **Chrome** (que se
 * autoactualiza y ya conoce el nombre nuevo). Arreglarlo para el navegador rompio las
 * terminales, donde justamente vive el POS.
 *
 * Por eso el valor se DEGRADA en vez de fijarse: si el motor no acepta la declaracion,
 * se reintenta sin ella. En las terminales eso es inocuo — el build 1.3.9 desactiva las
 * tres puertas de PNA (`main.js`), asi que ahi la declaracion nunca hizo falta.
 */
export async function localNetworkFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const localInit: LocalNetworkRequestInit = {
    ...init,
    targetAddressSpace: targetAddressSpaceFor(input),
  }

  // Un init invalido puede llegar de DOS formas segun el motor: como throw sincrono del
  // constructor de Request, o como promesa rechazada. Se cubren las dos — atrapar solo
  // una deja el arreglo sin efecto justo en el motor que se quiere rescatar.
  try {
    return await fetch(input, localInit)
  } catch (e) {
    if (!esEnumNoSoportado(e)) throw e
    console.warn('[lna] targetAddressSpace no soportado por este motor; reintento sin declararlo')
    return fetch(input, init)
  }
}

/**
 * ¿El motor rechazó el VALOR del enum, o de verdad no hay red?
 *
 * Los dos casos llegan como TypeError, así que hay que mirar el mensaje. Un fallo de red
 * real dice "Failed to fetch" / "NetworkError"; el rechazo del enum nombra el campo o el
 * valor. Ante la duda se trata como fallo de red y NO se reintenta: reintentar sin la
 * declaracion en un navegador que si la exige seria pedirle al bloqueo que nos deje pasar
 * por la puerta de atras, y ademas escondería el problema real.
 */
function esEnumNoSoportado(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false
  const msg = e.message.toLowerCase()
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
    return false
  }
  return msg.includes('targetaddressspace')
    || msg.includes('address space')
    || msg.includes('loopback')
    || msg.includes('not a valid value')
    || msg.includes('enum')
}
