// Modo voz del chat: bandera del request y la instrucción que se agrega al prompt.
//
// Vive aparte de la ruta para poder probarla sin levantar el chat entero, y para que
// el cliente y el servidor usen el MISMO valor de la bandera.

export const MODO_VOZ = 'voz' as const
export type ModoChat = typeof MODO_VOZ

/** `true` sólo si el cuerpo trae exactamente `modo: 'voz'`. Cualquier otra cosa: texto. */
export function esModoVoz(modo: unknown): boolean {
  return modo === MODO_VOZ
}

/**
 * Se agrega al prompt del chat cuando la respuesta se va a DECIR en voz alta.
 * Va ANTES del bloque de datos (es instrucción, no dato) y al final de las reglas,
 * para que gane sobre "siempre agrega un link" y "genera la gráfica".
 * No afloja ninguna regla de datos: las cifras siguen saliendo del contexto.
 */
export function instruccionModoVoz(): string {
  return `MODO VOZ — ESTA RESPUESTA SE VA A ESCUCHAR, NO A LEER (esta regla manda sobre las de formato, links y gráficas de arriba; las reglas de datos siguen igual):
- Máximo 2 a 4 oraciones cortas, como lo diría un gerente por teléfono. Lo más importante primero.
- NADA de tablas, listas, viñetas, markdown, asteriscos, links, rutas del dashboard, bloques de gráfica ni emojis.
- Di los números como se dicen en voz alta en español de México: "doce mil quinientos pesos", "treinta y dos por ciento", "el veintiocho de septiembre". Redondea a pesos (sin centavos) salvo que pregunten centavos.
- Las fechas dilas como "hoy", "ayer", "el lunes" o "el veintiocho de septiembre"; nunca "2026-09-28".
- Si la respuesta completa necesita más detalle del que cabe en 4 oraciones (un ranking largo, una receta, un desglose), da el resumen y termina con: "¿Quieres el detalle en pantalla?"
- Mismas reglas de honestidad: si no tienes el dato, o una fuente no se pudo leer, dilo en una oración.`
}
