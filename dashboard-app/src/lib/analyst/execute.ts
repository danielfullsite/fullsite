/**
 * Ejecuta el plan. Aquí el tenant deja de ser negociable.
 *
 * El plan lo escribió un modelo; esta capa lo convierte en lecturas reales y le pone el
 * `client_id` que resolvió el servidor, no el que diga nadie más. La fuga F-2 (cerrada el
 * 2026-08-30) fue exactamente esto por otra puerta: el chat tomaba el tenant del body y
 * cualquier usuario logueado leía las ventas y los nombres del staff de otro restaurante.
 *
 * Devuelve, además de las filas, la PROCEDENCIA: qué se consultó, con qué rango, cuántas
 * filas volvieron y qué cobertura traían. Es lo que se le enseña al usuario junto con la
 * respuesta, y lo que permite que alguien la audite sin creernos nada.
 */

import type { ConsultaValidada } from './plan'
import { buscarVista } from './contract'

export interface ResultadoConsulta {
  vista: string
  desde: string
  hasta: string
  porque: string
  automatica: boolean
  /** Filas tal como volvieron. El modelo las lee; no las recalcula. */
  filas: Record<string, unknown>[]
  /** null cuando la lectura falló. NO es lo mismo que cero filas. */
  error: string | null
  truncada: boolean
}

export interface Procedencia {
  consultas: {
    vista: string; rango: string; filas: number; porque: string
    automatica: boolean; error: string | null; truncada: boolean
  }[]
  /** Resultado del invariante de nivel 4 entre las vistas que se hayan consultado. */
  cuadre: { estado: 'ok' | 'descuadrado' | 'no_verificado'; detalle: string }
}

/** Tope por consulta. Suficiente para un año de días o un mes por hora y mesero. */
const MAX_FILAS = 2000

function entorno() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o la llave de servicio')
  return { url: url.replace(/\/$/, ''), headers: { apikey: key, Authorization: `Bearer ${key}` } }
}

/**
 * Corre una consulta del plan contra una vista del contrato.
 *
 * `clientId` es un argumento obligatorio y separado: no viaja dentro de la consulta y no
 * hay forma de que el plan lo sobreescriba. Se codifica con encodeURIComponent porque un
 * id de tenant termina dentro de un query string de PostgREST.
 */
export async function ejecutarConsulta(
  c: ConsultaValidada,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoConsulta> {
  const base: Omit<ResultadoConsulta, 'filas' | 'error' | 'truncada'> = {
    vista: c.vista, desde: c.desde, hasta: c.hasta,
    porque: c.porque, automatica: Boolean(c.automatica),
  }
  const def = buscarVista(c.vista)
  if (!def) {
    // No debería pasar: `validarPlan` ya filtró por lista blanca. Se comprueba igual porque
    // esta función es la última puerta antes de la base.
    return { ...base, filas: [], error: `vista fuera del contrato: ${c.vista}`, truncada: false }
  }

  const { url, headers } = entorno()
  const params = new URLSearchParams()
  params.set('client_id', `eq.${clientId}`)
  params.set(def.fecha, `gte.${c.desde}`)
  params.append(def.fecha, `lte.${c.hasta}`)
  params.set('select', c.columnas.join(','))
  params.set('limit', String(MAX_FILAS))
  for (const [k, v] of Object.entries(c.filtros)) params.set(k, `eq.${v}`)

  // PostgREST acepta el mismo parámetro repetido para un rango cerrado; URLSearchParams lo
  // serializa bien con append. Se arma así y no a mano para que un id con caracteres raros
  // no rompa la consulta ni se cuele en otro parámetro.
  const destino = `${url}/rest/v1/${def.nombre}?${params.toString()}`

  try {
    const res = await fetchImpl(destino, { headers })
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '')
      return { ...base, filas: [], truncada: false,
               error: `HTTP ${res.status} al leer ${def.nombre}: ${cuerpo.slice(0, 200)}` }
    }
    const filas = (await res.json()) as Record<string, unknown>[]
    return { ...base, filas: Array.isArray(filas) ? filas : [], error: null,
             truncada: Array.isArray(filas) && filas.length >= MAX_FILAS }
  } catch (e) {
    // Fallar callado está prohibido: el error viaja hasta la respuesta del usuario.
    return { ...base, filas: [], truncada: false,
             error: e instanceof Error ? e.message : 'error desconocido' }
  }
}

export async function ejecutarPlan(
  consultas: ConsultaValidada[],
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoConsulta[]> {
  return Promise.all(consultas.map((c) => ejecutarConsulta(c, clientId, fetchImpl)))
}

function num(v: unknown): number {
  // PostgREST devuelve `numeric` como STRING. Sumarlo sin convertir concatena.
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * El invariante de nivel 4, calculado en vivo entre las vistas que se consultaron.
 *
 * Crunchtime promete enseñar "the formulas, the connections, the reasoning". Esto es el
 * pedazo que ellos no pueden dar: no sólo de dónde salió el número, sino si ese día cierra.
 * Se calcula aquí y no se lee de `cuadre.py` a propósito — ese detector reporta por corrida
 * y no deja un veredicto por día que se pueda citar, así que depender de él sería citar algo
 * que quizá no corrió.
 *
 * Tolerancia de 1%: `ops_hourly` corta el día por `dia_venta` y `ops_daily_history` todavía
 * lo corta por fecha calendario, así que las órdenes de madrugada se mueven entre días. Una
 * diferencia mayor a eso no es el corte — es un problema. (El arreglo del corte va en su
 * propio PR; mientras tanto esta comparación lo refleja en vez de esconderlo.)
 */
export function verificarCuadre(resultados: ResultadoConsulta[]): Procedencia['cuadre'] {
  const diario = resultados.find((r) => r.vista === 'ops_daily_history' && !r.error)
  const horario = resultados.find((r) => r.vista === 'ops_hourly' && !r.error)

  if (!diario || !horario) {
    return { estado: 'no_verificado',
             detalle: 'para comprobar el cuadre hacen falta ops_daily_history y ops_hourly en la misma consulta' }
  }
  if (diario.truncada || horario.truncada) {
    return { estado: 'no_verificado',
             detalle: 'una de las lecturas topó el límite de filas; comparar sumas incompletas acusaría de descuadre a un día sano' }
  }

  const porDiaHora = new Map<string, number>()
  for (const f of horario.filas) {
    const d = String(f.dia_venta ?? '')
    porDiaHora.set(d, (porDiaHora.get(d) ?? 0) + num(f.ventas))
  }

  const descuadrados: string[] = []
  let comparados = 0
  for (const f of diario.filas) {
    const d = String(f.fecha ?? '')
    const suma = porDiaHora.get(d)
    if (suma === undefined) continue
    const total = num(f.ventas_dia)
    if (total <= 0) continue
    comparados++
    if (Math.abs(total - suma) / total > 0.01) {
      descuadrados.push(`${d}: el día dice ${total.toFixed(2)} y sus horas suman ${suma.toFixed(2)}`)
    }
  }

  if (comparados === 0) {
    return { estado: 'no_verificado', detalle: 'los rangos consultados no se traslapan' }
  }
  if (descuadrados.length === 0) {
    return { estado: 'ok', detalle: `${comparados} día(s) comprobados: el total del día es la suma de sus horas` }
  }
  return {
    estado: 'descuadrado',
    detalle: `${descuadrados.length} de ${comparados} día(s) no cierran — ${descuadrados.slice(0, 3).join(' · ')}`,
  }
}

export function construirProcedencia(resultados: ResultadoConsulta[]): Procedencia {
  return {
    consultas: resultados.map((r) => ({
      vista: r.vista,
      rango: r.desde === r.hasta ? r.desde : `${r.desde} → ${r.hasta}`,
      filas: r.filas.length,
      porque: r.porque,
      automatica: r.automatica,
      error: r.error,
      truncada: r.truncada,
    })),
    cuadre: verificarCuadre(resultados),
  }
}

export const _test = { MAX_FILAS, num }
