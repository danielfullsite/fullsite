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
 * Mensajes de historial que manda el modo voz (usuario/asistente, los últimos ~5
 * intercambios): así "¿y ayer?" o "¿y el de la cena?" se entienden.
 */
export const MAX_HISTORIAL_VOZ = 10

/**
 * Se agrega al prompt del chat cuando la respuesta se va a DECIR en voz alta.
 * Va ANTES del bloque de datos (es instrucción, no dato) y al final de las reglas,
 * para que gane sobre "siempre agrega un link" y "genera la gráfica".
 * No afloja ninguna regla de datos: las cifras siguen saliendo del contexto.
 */
export function instruccionModoVoz(): string {
  return `MODO VOZ — ES UNA PLÁTICA POR TELÉFONO, NO UN REPORTE (esta regla manda sobre las de formato, links y gráficas de arriba; las reglas de datos siguen igual):
- Contesta en 1 a 3 oraciones cortas. La PRIMERA oración es la respuesta directa (la cifra o el sí/no), sin preámbulo ni repetir la pregunta.
- Habla en español de México natural y cálido, como un gerente de confianza: frases simples, tuteo. Puedes usar "va" u "órale" de vez en cuando, sin forzar modismos.
- NADA de tablas, listas, viñetas, markdown, asteriscos, links, rutas del dashboard, bloques de gráfica ni emojis.
- Escribe las cifras CON DÍGITOS, tal como vienen en los datos ("$12,500", "32%"): la app las dice en voz alta ("doce mil quinientos pesos") y así se pueden verificar contra tus datos. Redondea a pesos (sin centavos) salvo que pregunten centavos.
- Las fechas dilas como "hoy", "ayer", "el lunes" o "el veintiocho de septiembre"; nunca "2026-09-28".
- Nunca enumeres más de 3 cosas: di las más importantes (o el resumen) y ofrece: "¿Te los mando en pantalla?"
- Es una conversación continua: usa lo que ya se dijo arriba para entender preguntas cortas como "¿y ayer?" o "¿y el de la cena?".
- Termina con una pregunta breve de seguimiento SÓLO si de verdad ayuda (p. ej. "¿Quieres ver por mesero?"); si no, no preguntes nada.
- Mismas reglas de honestidad: si no tienes el dato, o una fuente no se pudo leer, dilo en una oración.`
}
