/**
 * El cuadre de caja del día: lo que dice el sistema contra lo que se contó.
 *
 * La cuenta ya existe y ya está guardada. Al cerrar un turno, el POS escribe
 * `efectivo_sistema`, `fondo_final` y `diferencia` en `pos_turnos`, y hay 38
 * turnos cerrados con esas tres columnas llenas. Ninguna pantalla del panel las
 * mostraba: sólo se leía el turno ABIERTO, y sólo su fondo inicial.
 *
 * Aquí NO se recalcula la diferencia. Se lee la que el POS guardó, para que no
 * haya dos cuentas que puedan discrepar; si algún día la fórmula cambia, cambia
 * en un solo lugar.
 *
 * EL CASO QUE OBLIGA A TENER CUIDADO. Medido en la base el 2026-09-08: de 38
 * turnos cerrados, 37 tienen conteo en CERO, y ninguno lo tiene vacío. O sea que
 * en la práctica se cierra sin contar, y la columna guarda un cero que parece un
 * conteo real. Enseñar esa diferencia tal cual haría que el panel dijera «faltan
 * $5,957» cuando lo que pasó es que nadie contó — y una acusación falsa de
 * faltante es de las peores cosas que puede hacer un sistema en un restaurante.
 *
 * Por eso hay tres estados y no dos, y el del medio existe precisamente para no
 * afirmar de más.
 */

export type EstadoCuadre =
  /** Contaron y coincide con el sistema. */
  | 'cuadra'
  /** Contaron y no coincide: hay una diferencia real que alguien debe explicar. */
  | 'descuadra'
  /** Se cerró sin capturar el conteo. No se sabe si cuadra; no se acusa a nadie. */
  | 'sin-conteo'
  /** El turno sigue abierto: todavía no hay nada que cuadrar. */
  | 'abierto'

export interface TurnoCerrado {
  id: string
  opened_at: string | null
  closed_at: string | null
  closed_by: string | null
  fondo_inicial: number | null
  /** Lo que el sistema calculó que debía haber en efectivo. */
  efectivo_sistema: number | null
  /** Lo que la persona contó al cerrar. */
  fondo_final: number | null
  /** La resta, tal como la guardó el POS. */
  diferencia: number | null
}

export interface Cuadre {
  estado: EstadoCuadre
  sistema: number | null
  contado: number | null
  diferencia: number | null
  cerradoPor: string | null
  cerradoAt: string | null
  /** Una línea en español, lista para pintar. */
  mensaje: string
}

/** Debajo de esto es redondeo de monedas, no un descuadre que alguien deba explicar. */
export const TOLERANCIA_PESOS = 1

const pesos = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })

/**
 * Lee el cuadre de un turno.
 *
 * @param turno el turno cerrado, o null si no hay ninguno cerrado ese día.
 */
export function cuadreDeTurno(turno: TurnoCerrado | null): Cuadre {
  const vacio: Cuadre = {
    estado: 'abierto', sistema: null, contado: null, diferencia: null,
    cerradoPor: null, cerradoAt: null,
    mensaje: 'El turno sigue abierto',
  }
  if (!turno || !turno.closed_at) return vacio

  const sistema = num(turno.efectivo_sistema)
  const contado = num(turno.fondo_final)
  const diferencia = num(turno.diferencia)
  const base = { sistema, contado, diferencia, cerradoPor: turno.closed_by ?? null, cerradoAt: turno.closed_at }

  // Cerrado con conteo en cero habiendo efectivo en el sistema: es «no contaron»,
  // no «faltó todo». La columna no distingue los dos casos, así que el panel
  // tampoco puede afirmar uno.
  if (sistema != null && sistema > 0 && (contado == null || contado === 0)) {
    return { ...base, estado: 'sin-conteo',
      mensaje: `Se cerró sin capturar el conteo. El sistema esperaba ${pesos(sistema)} en efectivo.` }
  }

  if (contado == null || sistema == null || diferencia == null) {
    return { ...base, estado: 'sin-conteo', mensaje: 'Se cerró sin capturar el conteo de caja.' }
  }

  if (Math.abs(diferencia) < TOLERANCIA_PESOS) {
    return { ...base, estado: 'cuadra', mensaje: `Cuadra. Contaron ${pesos(contado)}.` }
  }

  const falta = diferencia < 0
  return { ...base, estado: 'descuadra',
    mensaje: `${falta ? 'Faltan' : 'Sobran'} ${pesos(Math.abs(diferencia))}. El sistema esperaba ${pesos(sistema)} y contaron ${pesos(contado)}.` }
}

function num(v: unknown): number | null {
  // PostgREST devuelve numeric como CADENA. Sumar sobre eso concatena en vez de
  // sumar, y es un error que ya se pagó antes en este proyecto.
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** El tono con que se pinta, para que el color signifique lo mismo en toda la pantalla. */
export function tonoDeCuadre(estado: EstadoCuadre): 'bien' | 'aviso' | 'grave' | 'neutro' {
  return estado === 'cuadra' ? 'bien'
    : estado === 'descuadra' ? 'grave'
    : estado === 'sin-conteo' ? 'aviso'
    : 'neutro'
}
