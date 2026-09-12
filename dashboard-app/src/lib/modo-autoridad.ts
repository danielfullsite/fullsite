/**
 * ¿Esta instalación exige un permiso firmado por Caja para operar?
 *
 * El guard de la huella preguntaba `requiereCaja()`, que responde por el
 * userAgent: bajo Electron es SIEMPRE verdadero. O sea, preguntaba «¿soy una
 * aplicación de escritorio?» cuando lo que necesita saber es «¿esta instalación
 * exige un permiso firmado?». Con eso, la huella quedó rechazada en las tres
 * terminales de un restaurante que la usa a diario.
 *
 * El dato real ya viaja: Pedro publica `write_authority` en su estado, que vale
 * 'caja' sólo cuando la autoridad local está encendida. Este módulo es puro para
 * poder probarlo sin navegador: en este proyecto las pruebas corren en Node y
 * jsdom sólo está disponible para las que llevan el sufijo `.dom.test.ts`.
 *
 * La huella IDENTIFICA; nunca AUTORIZA. Aquí no se emite ni se falsifica ningún
 * permiso: sólo se decide si con la huella basta para desbloquear la pantalla, o
 * si además hay que pedir el PIN porque quien firma es Caja y el lector no trae
 * con qué firmar.
 */

export type ModoDeAutoridad = 'caja' | 'legacy' | 'desconocido'
export type DecisionDeHuella = 'identificar-y-pedir-pin'
export type CausaDeFalloDeHuella =
  | 'servicio-apagado'
  | 'sin-lectura'
  | 'terminal-sin-configurar'
  | 'no-reconocida'
  | 'sin-vinculo-con-red'
  | 'sin-vinculo-sin-red'

/** Sólo 'caja' y 'legacy' cuentan como respuesta. Todo lo demás es silencio. */
export function normalizarAutoridad(valor: unknown): 'caja' | 'legacy' | null {
  return valor === 'caja' ? 'caja' : valor === 'legacy' ? 'legacy' : null
}

/**
 * La huella local identifica; el PIN crea la sesión firmada. Se aplica en todos
 * los modos porque el servidor todavía no verifica la assertion biométrica.
 */
export function decidirHuella(modo: ModoDeAutoridad): DecisionDeHuella {
  void modo
  return 'identificar-y-pedir-pin'
}

/**
 * Traduce el fallo del lector a algo accionable. Nunca se muestra el error crudo
 * del servidor: hoy filtra cosas como «falta la credencial de la red local» a la
 * cara de un mesero, que no puede hacer nada con eso.
 */
export function causaDeFalloDeHuella(
  { status, ok, errorDeRed, enLinea }:
  { status?: number; ok?: boolean; errorDeRed?: boolean; enLinea?: boolean },
): CausaDeFalloDeHuella {
  if (errorDeRed) return 'terminal-sin-configurar'
  if (status === 503) return 'servicio-apagado'
  if (status === 504) return 'sin-lectura'
  if (status === 401 || status === 403) return 'terminal-sin-configurar'
  if (ok === false) return 'no-reconocida'
  return enLinea ? 'sin-vinculo-con-red' : 'sin-vinculo-sin-red'
}

const MENSAJES: Record<CausaDeFalloDeHuella, string> = {
  'servicio-apagado': 'El lector no está encendido en esta terminal. Entra con tu PIN y avisa a soporte.',
  'sin-lectura': 'No leí tu huella. Vuelve a poner el dedo, o entra con tu PIN.',
  'terminal-sin-configurar': 'Esta terminal no terminó de configurarse. Entra con tu PIN y avisa a soporte.',
  'no-reconocida': 'No reconocí esa huella. Entra con tu PIN y pide que la registren.',
  'sin-vinculo-con-red': 'Reconocí tu huella, pero todavía no sé quién eres en el sistema. Entra con tu PIN una vez y queda ligada.',
  'sin-vinculo-sin-red': 'Reconocí tu huella. Sin internet esta terminal todavía no la conoce: entra con tu PIN una vez y queda lista aunque se caiga la red.',
}

export function mensajeDeFalloDeHuella(causa: CausaDeFalloDeHuella): string {
  return MENSAJES[causa]
}

export function mensajeDeIdentificado(nombre: string): string {
  return `Hola, ${nombre}. Confirma tu PIN para abrir tu turno.`
}

// ── Lo único que toca almacenamiento ─────────────────────────────────────────
// Es una comodidad para no dejar al mesero esperando la primera lectura del
// estado. Nunca es autoridad: lo que gobierna cada escritura se verifica del
// otro lado, en Caja.
const CLAVE = 'FULLSITE_MODO_AUTORIDAD'
let recordado: 'caja' | 'legacy' | null = null

/** Una lectura fallida NUNCA degrada lo que ya se sabía. */
export function recordarAutoridad(valor: unknown): void {
  const modo = normalizarAutoridad(valor)
  if (!modo) return
  recordado = modo
  try { localStorage.setItem(CLAVE, modo) } catch {}
}

export function modoDeAutoridadRecordado(): ModoDeAutoridad {
  if (recordado) return recordado
  try { return normalizarAutoridad(localStorage.getItem(CLAVE)) ?? 'desconocido' }
  catch { return 'desconocido' }
}

/** Sólo para pruebas: vacía la memoria del proceso. */
export function olvidarAutoridadRecordada(): void { recordado = null }
