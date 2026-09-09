/**
 * La redacción — y la parte que Crunchtime vende como su diferenciador.
 *
 * Su promesa textual es: "AI Analyst shows the logic and data sources behind every
 * answer—the formulas, the connections, the reasoning."
 *
 * Aquí eso sale gratis, porque el plan se escribió ANTES de ver los datos: la procedencia no
 * se reconstruye, se arrastra. Y encima lleva algo que ellos estructuralmente no pueden dar:
 * si ese día CUADRA. Crunchtime se cuelga del POS de alguien más y no controla la captura;
 * Fullsite es el POS, así que puede decir "el total del día es la suma de sus horas" o
 * confesar que no lo es.
 *
 * Un dato que no cuadra y se reporta como si cuadrara es peor que no reportarlo: el gerente
 * actúa sobre él.
 */

import type { PlanValidado } from './plan'
import type { ResultadoConsulta, Procedencia } from './execute'

/** Filas que se le pasan al modelo por consulta. Más que esto no cabe y no hace falta. */
const MAX_FILAS_AL_MODELO = 60

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Recorta las filas conservando lo que importa.
 *
 * No se toman las primeras N: en una serie por día eso daría el principio del rango y
 * escondería el final, que casi siempre es lo que se preguntó. Se toman las de mayor peso
 * cuando hay una columna de importe, y si no, las últimas.
 */
function recortar(filas: Record<string, unknown>[]): Record<string, unknown>[] {
  if (filas.length <= MAX_FILAS_AL_MODELO) return filas
  const clave = ['ventas', 'ventas_dia', 'importe_vendido', 'consumo_stock', 'consumo_receta']
    .find((c) => filas[0] && c in filas[0])
  if (clave) {
    return [...filas].sort((a, b) => num(b[clave]) - num(a[clave])).slice(0, MAX_FILAS_AL_MODELO)
  }
  return filas.slice(-MAX_FILAS_AL_MODELO)
}

/** Lo que ve el modelo para redactar: la pregunta, el plan, los datos y el estado del cuadre. */
export function resumirParaModelo(
  pregunta: string,
  plan: PlanValidado,
  resultados: ResultadoConsulta[],
  procedencia: Procedencia,
): string {
  const bloques = resultados.map((r) => {
    const cabecera = `### ${r.vista} (${r.desde} → ${r.hasta})${r.automatica ? ' [agregada por el sistema]' : ''}`
    if (r.error) {
      // Que el modelo SEPA que esto falló, para que no lo lea como ausencia de ventas.
      return `${cabecera}\nLECTURA FALLIDA: ${r.error}\nNo hay datos de esta vista. Esto NO significa que no haya habido actividad.`
    }
    if (r.filas.length === 0) {
      return `${cabecera}\nSin filas en ese rango. La lectura sí funcionó: aquí no hubo actividad.`
    }
    const filas = recortar(r.filas)
    const nota = filas.length < r.filas.length
      ? `\n(se muestran ${filas.length} de ${r.filas.length} filas, las de mayor peso)`
      : ''
    const tope = r.truncada ? `\nADVERTENCIA: la lectura topó el límite; puede faltar información.` : ''
    return `${cabecera}${nota}${tope}\n${JSON.stringify(filas)}`
  })

  const cuadre = procedencia.cuadre.estado === 'ok'
    ? `CUADRE: ${procedencia.cuadre.detalle}. Puedes afirmar estos números.`
    : procedencia.cuadre.estado === 'descuadrado'
    ? `CUADRE: NO CIERRA — ${procedencia.cuadre.detalle}. Dilo en la respuesta: el usuario tiene que saber que estas cifras no cuadran entre sí antes de decidir algo con ellas.`
    : `CUADRE: no verificado (${procedencia.cuadre.detalle}). No afirmes que los números están comprobados.`

  return [
    `PREGUNTA: ${pregunta}`,
    plan.formula ? `\nPLAN: ${plan.formula}` : '',
    `\n${cuadre}`,
    plan.descartes.length ? `\nDESCARTES DEL PLAN: ${plan.descartes.join(' · ')}` : '',
    `\nDATOS:\n${bloques.join('\n\n')}`,
  ].filter(Boolean).join('\n')
}

export function promptDeRespuesta(hoy: string): string {
  return `Eres un analista de restaurantes con veinte años de oficio. Hoy es ${hoy}.

Te llegan datos YA CONSULTADOS. Tu trabajo es leerlos y responder, no traer más.

CÓMO RESPONDER
· Empieza por la respuesta. Nada de "según los datos proporcionados".
· Breve: 4 a 6 líneas para una pregunta simple. Si pidieron un desglose, usa una tabla.
· Español de México, tono directo, montos como $1,234.56.
· Cuando algo se pueda accionar, dilo en una línea al final. Sin discursos.

LOS NÚMEROS
· Usa ÚNICAMENTE los que están en los datos. No estimes, no promedies "del sector",
  no completes lo que falta.
· Si un dato no está, di qué falta y ofrece lo que sí tienes. Eso es una respuesta útil.
· Si una lectura FALLÓ, dilo. "No pude leerlo" y "no hubo ventas" son cosas distintas y
  confundirlas hace que un gerente actúe sobre un cero que no existió.
· Si hay columnas de cobertura (ordenes_sin_cierre, lineas_no_convertibles,
  pct_lineas_con_receta, platillos_sin_receta…), léelas antes de concluir. Un consumo bajo
  con 20% de recetas capturadas no es un consumo bajo: es un catálogo incompleto. Nunca
  sugieras que falta producto sin mirar primero cuánta receta hay capturada.

EL CUADRE
· Si el cuadre CIERRA, responde normal.
· Si NO cierra, dilo antes de dar la cifra. El usuario va a tomar una decisión con esto.
· Si no se verificó, no digas que está comprobado.

NUNCA
· No acuses a una persona. Puedes decir que un número se sale del patrón y merece revisarse;
  decir que alguien roba con una diferencia estadística es acusar sin pruebas, y ese error
  cuesta más que no haber avisado.
· No inventes nombres de meseros, platillos ni sucursales que no estén en los datos.`
}

export const _test = { MAX_FILAS_AL_MODELO, recortar, num }
