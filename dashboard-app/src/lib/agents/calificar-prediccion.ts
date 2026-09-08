/**
 * Califica al predictor contra la realidad.
 *
 * El predictor dice a media tarde en cuánto va a cerrar el día. Al día siguiente
 * el cierre real está en la base. Nadie tiene que opinar: se compara y sale un
 * número. Es la única señal de calidad que este sistema puede producir sin
 * trabajo humano y sin necesitar volumen — un dato por día operado.
 *
 * LO DIFÍCIL NO ES LA RESTA, ES SABER QUÉ DÍA NO CUENTA.
 *
 * Entre el 20 de junio y el 3 de agosto de 2026 el predictor recibió el mismo
 * dato de entrada 34 días seguidos: la fuente había dejado de actualizarse y
 * repetía la última fila. Sus proyecciones de esos días existen y se ven como
 * cualquier otra. Calificarlas mediría ruido con apariencia de rigor, y ese
 * número alimentaría el aprendizaje del sistema.
 *
 * Por eso un día se descarta —no se cuenta como error, se descarta— cuando:
 *
 *  · no hay cierre real, o el día cerró en cero
 *  · la venta que el predictor «veía» ya era igual o mayor al cierre del día:
 *    entonces no estaba prediciendo, estaba leyendo el resultado
 *  · esa misma venta de entrada aparece idéntica en otros días: dato congelado
 *
 * Descartar es distinto de acertar y distinto de fallar. Un día descartado
 * aparece en el reporte con su motivo, no se esconde: si de diez días se
 * descartan nueve, eso es lo más importante que el reporte puede decir.
 */

export interface Prediccion {
  fecha: string
  /** Lo que proyectó que iba a cerrar. */
  proyectado: number
  /** Lo que llevaba vendido cuando proyectó. */
  llevaba: number
  /** Hora del día en que proyectó. Una proyección de las 8pm no vale lo que una de las 2pm. */
  hora: number
}

export interface CierreReal {
  fecha: string
  ventas: number
}

export type MotivoDescarte =
  | 'sin-cierre-real'
  | 'cerro-en-cero'
  | 'ya-veia-el-dia-completo'
  | 'dato-de-entrada-congelado'

export interface DiaCalificado {
  fecha: string
  hora: number
  proyectado: number
  real: number
  /** Positivo si proyectó de más. */
  error: number
  /** Error absoluto como fracción del cierre real. 0.074 es 7.4%. */
  errorPct: number
}

export interface DiaDescartado {
  fecha: string
  motivo: MotivoDescarte
}

export interface Calificacion {
  calificados: DiaCalificado[]
  descartados: DiaDescartado[]
  /** Error porcentual medio sobre los días calificados. null si no hay ninguno. */
  errorMedio: number | null
  /** Cuántos días quedaron dentro de un margen dado. */
  dentroDe: (margen: number) => number
}

/**
 * Una venta de entrada que se repite entre días distintos es dato congelado.
 *
 * Se compara contra el conjunto completo, no contra el día anterior: el bug
 * repetía el mismo valor durante semanas, con huecos en medio.
 */
function entradasRepetidas(predicciones: Prediccion[]): Set<number> {
  const cuenta = new Map<number, number>()
  for (const p of predicciones) {
    if (p.llevaba > 0) cuenta.set(p.llevaba, (cuenta.get(p.llevaba) ?? 0) + 1)
  }
  return new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([v]) => v))
}

export function calificar(
  predicciones: Prediccion[],
  cierres: CierreReal[],
): Calificacion {
  const realPorFecha = new Map(cierres.map(c => [c.fecha, c.ventas]))
  const congeladas = entradasRepetidas(predicciones)

  const calificados: DiaCalificado[] = []
  const descartados: DiaDescartado[] = []

  for (const p of predicciones) {
    const real = realPorFecha.get(p.fecha)

    if (real === undefined) { descartados.push({ fecha: p.fecha, motivo: 'sin-cierre-real' }); continue }
    if (!(real > 0))        { descartados.push({ fecha: p.fecha, motivo: 'cerro-en-cero' }); continue }
    if (congeladas.has(p.llevaba)) { descartados.push({ fecha: p.fecha, motivo: 'dato-de-entrada-congelado' }); continue }
    // Si ya veía el día completo, no predijo: leyó el resultado.
    if (p.llevaba >= real)  { descartados.push({ fecha: p.fecha, motivo: 'ya-veia-el-dia-completo' }); continue }

    const error = p.proyectado - real
    calificados.push({
      fecha: p.fecha, hora: p.hora, proyectado: p.proyectado, real,
      error, errorPct: Math.abs(error) / real,
    })
  }

  const errorMedio = calificados.length > 0
    ? calificados.reduce((s, d) => s + d.errorPct, 0) / calificados.length
    : null

  return {
    calificados, descartados, errorMedio,
    dentroDe: (margen: number) => calificados.filter(d => d.errorPct <= margen).length,
  }
}

/**
 * Cuántos días hacen falta para que el número signifique algo.
 *
 * Con dos días, un error medio del 40% y uno del 4% son igual de creíbles, o
 * sea nada creíbles. Se usa el mismo criterio que para la precisión de los
 * agentes, por coherencia: debajo de esto se enseña el conteo, no el promedio.
 */
export const MINIMO_DIAS_PARA_PROMEDIAR = 20

export function hayMuestraSuficiente(c: Calificacion): boolean {
  return c.calificados.length >= MINIMO_DIAS_PARA_PROMEDIAR
}
