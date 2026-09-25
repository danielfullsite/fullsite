/**
 * Cómo se lee una respuesta de `/api/pos/pin`.
 *
 * El principio, que es todo el módulo en una línea:
 *
 *   > **Sólo un 401 es un veredicto sobre el PIN que la persona tecleó.**
 *   > Todo lo demás habla del servidor, de la terminal o de la red — no del PIN.
 *
 * Existe porque el navegador no hacía esa distinción. `pos/layout.tsx` ramificaba sobre
 * `403`, `400` y `res.ok`, y nada más: un `429` o un `5xx` se caía del `try` **sin lanzar**,
 * así que el `catch` con el respaldo offline nunca corría y la ejecución aterrizaba en el
 * contador de intentos fallidos. Quien tecleaba su PIN correcto veía *"PIN incorrecto"* y a
 * los 5 intentos la terminal se bloqueaba, **sin haber consultado jamás el almacén local de
 * credenciales**.
 *
 * Y el 429 es el que de verdad muerde: `pin-throttle.ts` limita por *(restaurante, IP)*, y en
 * un restaurante las tres terminales comparten la IP pública. Tres meseros tecleando a la vez
 * podían tumbarse el login entre ellos.
 *
 * Pedro ya había tropezado con esto y lo arregló **sólo para sí mismo** — ver el comentario de
 * `electron-app/local-server/core/actor-authority.js:159-164`, que lo cuenta completo:
 * *"Un 429 NO es un veredicto sobre este PIN… Tratarlo como rechazo le decía 'PIN rechazado' a
 * quien tecleó el correcto, y encima era peor que estar sin internet, porque con la nube caída
 * ese mismo empleado sí entraba con su credencial preparada."* El navegador nunca recibió ese
 * arreglo. Este módulo es ese mismo arreglo, del lado del navegador, y en un solo lugar para
 * que la próxima superficie no lo vuelva a re-descubrir en campo.
 *
 * Levantado el 2026-09-14 auditando `pos_staff` para el plan de hasheo de PIN
 * (`docs/security/PLAN-PIN-HASH.md` §7, C6). Es prerrequisito de ese plan: una pimienta mal
 * puesta en Vercel devuelve 503, y sin este arreglo eso significa que el restaurante no abre.
 */

export type VeredictoDeLaAutoridad =
  /** 2xx — el servidor confirmó al empleado. */
  | 'aceptado'
  /** 401 — la autoridad juzgó ESTE PIN y lo negó. Es el único que cuenta como intento. */
  | 'pin-rechazado'
  /** 403 + `terminal_not_enrolled` — la terminal no está dada de alta. No es el PIN. */
  | 'terminal-no-enrolada'
  /** 400 — la terminal no sabe a qué restaurante pertenece. No es el PIN. */
  | 'sin-tenant'
  /** 429, 5xx y cualquier respuesta que no entendamos. No es veredicto: cae al respaldo local. */
  | 'autoridad-no-disponible'

/**
 * Clasifica una respuesta de `/api/pos/pin`.
 *
 * `codigo` es el campo `code` del cuerpo cuando lo hay (`terminal_not_enrolled`,
 * `authority_unavailable`); puede faltar y la clasificación sigue siendo correcta.
 *
 * **Falla del lado seguro a propósito:** cualquier status que no reconocemos —un 418, un 302
 * de un portal cautivo, un 503 con HTML de Vercel— cae en `autoridad-no-disponible`. Preferimos
 * mandar a alguien al respaldo local (que exige una credencial aprovisionada en un login online
 * previo, vigente y no revocada) antes que acusarlo de teclear mal y bloquearle la terminal.
 */
export function clasificarRespuestaDePin(status: number, codigo?: string): VeredictoDeLaAutoridad {
  if (status >= 200 && status < 300) return 'aceptado'
  if (status === 400) return 'sin-tenant'
  if (status === 403 && codigo === 'terminal_not_enrolled') return 'terminal-no-enrolada'
  // Un 403 sin ese código no lo emite `/api/pos/pin` — sale de un proxy, un WAF o Vercel.
  // Hablar del PIN sería inventar. Cae al respaldo, como todo lo que no entendemos.
  if (status === 401) return 'pin-rechazado'
  return 'autoridad-no-disponible'
}

/**
 * ¿Este veredicto cuenta como intento fallido?
 *
 * Sólo `pin-rechazado`. Contar de más bloquea la terminal a los 5 intentos, y el día que eso
 * pasa es justo el día que el servidor anda mal — o sea, el peor día para además no poder
 * entrar.
 *
 * No debilita la defensa contra adivinar PINs: el rechazo real (401) sigue contando, el 429 ya
 * ES el candado del servidor (`pin-throttle.ts`, por restaurante e IP) haciendo su trabajo, y
 * el camino offline conserva su propio contador cuando hay credenciales con qué juzgar
 * (`pos/layout.tsx`, estado `utilizable`).
 */
export function cuentaComoIntentoFallido(veredicto: VeredictoDeLaAutoridad): boolean {
  return veredicto === 'pin-rechazado'
}

/**
 * Cuánto espera el navegador a `/api/pos/pin` antes de tratarlo como autoridad que no contestó.
 *
 * El login por PIN ya usaba 4 s (`pos/layout.tsx`). Las aprobaciones de gerente
 * (`verifyManagerPin*` en pos-data.ts) no tenían tope: con la LAN degradada el navegador espera
 * 30–90 s antes de rendirse, y el respaldo local sólo corre DESPUÉS. Un timeout no es un
 * veredicto sobre el PIN — es el mismo caso que un 5xx, y cae al mismo respaldo.
 */
export const TIMEOUT_AUTORIDAD_PIN_MS = 4000

/**
 * Qué hace el login por HUELLA con la respuesta de la autoridad (C6, la cuarta superficie).
 *
 * El defecto que cierra es el INVERSO del de 2ed3c1d5: el login por huella caía al mapa local
 * (`pos_fingerprint_staff`) ante CUALQUIER respuesta no-2xx — incluido el 401 con el que el
 * servidor dice «este empleado no existe o está desactivado». Así, con la red arriba, un
 * empleado dado de baja seguía entrando con su huella desde el caché. Un rechazo real se
 * trataba como caída.
 *
 * `status === null` significa que no hubo respuesta: sin red, timeout o fetch que lanzó.
 * `hayEmpleado` dice si un 2xx trajo de verdad a la persona.
 */
export type DecisionDeHuella =
  | 'entrar-con-servidor'
  | 'rechazar'
  | 'terminal-no-enrolada'
  | 'sin-tenant'
  | 'usar-respaldo-local'

export function decidirHuellaTrasAutoridad(status: number | null, codigo?: string, hayEmpleado = false): DecisionDeHuella {
  if (status === null) return 'usar-respaldo-local'
  const veredicto = clasificarRespuestaDePin(status, codigo)
  switch (veredicto) {
    // Un 2xx sin empleado no es una negación: la nube contestó algo que no entendemos.
    case 'aceptado': return hayEmpleado ? 'entrar-con-servidor' : 'usar-respaldo-local'
    case 'pin-rechazado': return 'rechazar'
    case 'terminal-no-enrolada': return 'terminal-no-enrolada'
    case 'sin-tenant': return 'sin-tenant'
    case 'autoridad-no-disponible': return 'usar-respaldo-local'
  }
}
