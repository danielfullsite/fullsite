/**
 * Marco de razonamiento para el copiloto operativo.
 *
 * No es un filtro ni una lista de preguntas permitidas: cualquier pregunta dentro
 * del restaurante llega al modelo. Sólo le da una postura inicial para que una
 * pregunta corta ("¿qué pasa?", "¿me conviene?", "hola") reciba la profundidad
 * adecuada en vez de una respuesta genérica o una conclusión sin evidencia.
 */

export type ModoRazonamientoOperativo =
  | 'saludo'
  | 'estado'
  | 'diagnostico'
  | 'decision'
  | 'accion'
  | 'exploracion'

export interface IntencionOperativa {
  modo: ModoRazonamientoOperativo
  /** Instrucción breve y concreta que se inyecta en el prompt del modelo. */
  instruccion: string
}

const normalizar = (texto: string) => texto
  .toLocaleLowerCase('es-MX')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const marco: Record<ModoRazonamientoOperativo, string> = {
  saludo: 'La persona abrió conversación o hizo una pregunta amplia. Saluda de forma natural y ofrece una lectura breve de la operación actual si hay evidencia; nunca respondas con una negativa genérica ni le exijas formular una pregunta más específica.',
  estado: 'La persona quiere entender el estado presente. Distingue día abierto de día cerrado, usa el corte temporal comparable cuando aplique y di qué periodo cubren los datos.',
  diagnostico: 'La persona quiere explicar un problema. Empieza por el hecho observado, contrasta al menos una segunda señal si está disponible y separa causa demostrada de hipótesis. No conviertas una correlación en causa.',
  decision: 'La persona pide una recomendación o evalúa una alternativa. Da una recomendación clara, el porqué basado en datos, el principal costo o riesgo y qué dato faltaría para decidir con más certeza. Un escenario futuro no es un hecho ni una proyección garantizada.',
  accion: 'La persona necesita actuar ahora. Propón hasta tres pasos concretos y priorizados, indicando qué revisar primero. Sólo recomienda: nunca afirmes que ejecutaste cambios, cobros, mensajes o ajustes.',
  exploracion: 'La persona explora un tema del restaurante. Responde de manera natural y completa; identifica qué datos son relevantes, consulta los que hagan falta y declara límites de cobertura o frescura sin perder utilidad.',
}

/**
 * Clasificador deliberadamente tolerante. Sus patrones son pistas de conversación,
 * no una política de acceso ni una condición para consultar datos: el fallback
 * `exploracion` deja que el modelo interprete cualquier formulación nueva.
 */
export function intencionOperativa(pregunta: string): IntencionOperativa {
  const q = normalizar(pregunta)
  const soloSaludo = /^(hola|buenos dias|buenas tardes|buenas noches|que onda|que tal|como estas|como va)\b[!?., ]*$/.test(q)
  if (soloSaludo) return { modo: 'saludo', instruccion: marco.saludo }

  if (/(que hago|que deberia|dime que hacer|prioriza|por donde empiezo|siguiente paso|plan de accion|urge|urgente)/.test(q)) {
    return { modo: 'accion', instruccion: marco.accion }
  }
  if (/(me conviene|conviene|deberia subir|deberia bajar|que pasa si|vale la pena|recomiendas|decid|opcion|alternativa|quitar|poner|cambiar precio)/.test(q)) {
    return { modo: 'decision', instruccion: marco.decision }
  }
  if (/(por que|porque|causa|que cambio|que esta mal|problema|dolor|riesgo|anomali|bajo|subio|bajo|raro|explica)/.test(q)) {
    return { modo: 'diagnostico', instruccion: marco.diagnostico }
  }
  if (/(como vamos|que pasa|estado|hoy|ahorita|ahora|turno|ventas|prioridad|alerta|pendiente)/.test(q)) {
    return { modo: 'estado', instruccion: marco.estado }
  }
  return { modo: 'exploracion', instruccion: marco.exploracion }
}

/** Texto listo para el prompt, sin exponer la taxonomía al usuario. */
export function marcoRazonamientoOperativo(pregunta: string): string {
  const intencion = intencionOperativa(pregunta)
  return `\nMODO DE RAZONAMIENTO PARA ESTA PREGUNTA:\n${intencion.instruccion}\nAntes de responder, determina qué es hecho, qué es inferencia y qué falta por comprobar. Si hay datos suficientes, toma postura; si no, explica el límite sin inventar.\n`
}
