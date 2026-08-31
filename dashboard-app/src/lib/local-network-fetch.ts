/**
 * Fetch hacia el bridge local desde la pagina HTTPS del POS.
 *
 * Chromium Local Network Access exige declarar el espacio de direcciones antes
 * de resolver el destino. Sin esta opcion, incluso 127.0.0.1 puede bloquearse
 * antes de que el request salga del navegador.
 *
 * Chromium ya implementa esta opcion, aunque algunas versiones de TypeScript
 * todavia no la incluyen en RequestInit.
 */
type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: 'local'
}

export function localNetworkFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const localInit: LocalNetworkRequestInit = {
    ...init,
    targetAddressSpace: 'local',
  }
  return fetch(input, localInit)
}
