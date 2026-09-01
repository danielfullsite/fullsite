// pos_turnos — que no se pida una columna que no existe.
//
// INCIDENTE 2026-08-31, AMALAY. El POS no podía enviar NINGUNA comanda: cada intento
// devolvía HTTP 409. La causa fue una sola palabra en un select:
//
//   `...&select=id,closed_at,location_id&limit=1`
//                          ^^^^^^^^^^^ no existe en pos_turnos
//
// PostgREST responde 400 ante una columna inexistente. El código lo leía como
// `!turnoRes.ok` -> TURN_NOT_FOUND -> 409, con turno abierto o sin él. La lógica de
// turnos era correcta; la consulta nunca llegaba a ejecutarse.
//
// POR QUÉ CI NO LO AGARRÓ
//
// Las pruebas del endpoint simulan `fetch`, así que el select podía nombrar cualquier
// cosa: el mock siempre respondía 200. Un mock no sabe qué columnas existen.
//
// Esta prueba cierra esa clase de fallo: lee el CÓDIGO REAL, extrae toda columna que se
// le pida a pos_turnos —en el `select` y en los filtros, que también dan 400— y la
// contrasta contra el esquema. No prueba una línea: prueba que no se pueda volver a
// escribir el error.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Columnas reales de public.pos_turnos.
 *
 * Obtenidas el 2026-08-31 con:
 *   select column_name from information_schema.columns
 *    where table_schema='public' and table_name='pos_turnos'
 *    order by ordinal_position;
 *
 * Si una migración agrega o quita columnas, esta lista se actualiza EN EL MISMO PR que
 * la migración. Que haya que tocarla a mano es a propósito: obliga a mirar el esquema.
 */
const COLUMNAS_REALES = new Set([
  'id', 'client_id', 'opened_by', 'fondo_inicial', 'opened_at',
  'closed_by', 'fondo_final', 'efectivo_sistema', 'diferencia', 'closed_at', 'notas',
])

/** Operadores de PostgREST: `col=eq.x`, `col=is.null`, `col=gte.x`… */
const OPERADORES = 'eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|not'

const ARCHIVOS = [
  'src/app/api/pos/save-order/route.ts',
]

function fuente(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

/**
 * Columnas declaradas en `TURNO_SELECT_COLUMNS`.
 *
 * Se leen de la DECLARACIÓN, no del template donde se interpolan: el select real dice
 * `select=${TURNO_SELECT_COLUMNS.join(',')}`, así que buscar nombres literales en la URL
 * no encuentra nada. Esto se descubrió reintroduciendo el bug a propósito — la primera
 * versión de esta prueba pasaba 7/7 con `location_id` puesto. Una prueba que no falla
 * cuando el bug está presente no prueba nada.
 */
function columnasDeLaConstante(src: string): string[] {
  const m = src.match(/TURNO_SELECT_COLUMNS\s*=\s*\[([^\]]*)\]/)
  if (!m) return []
  return [...m[1].matchAll(/['"]([A-Za-z0-9_]+)['"]/g)].map(x => x[1])
}

/** Toda columna que el código le pide a pos_turnos, venga del select o de un filtro. */
function columnasPedidas(src: string): { select: string[]; filtros: string[] } {
  const select: string[] = [...columnasDeLaConstante(src)]
  const filtros: string[] = []

  // Los fragmentos de URL de pos_turnos pueden partirse en varias líneas concatenadas.
  // Se recorta desde cada mención hasta un margen generoso para no perder el select.
  let i = src.indexOf('pos_turnos')
  while (i !== -1) {
    const trozo = src.slice(i, i + 400)

    for (const m of trozo.matchAll(/[?&]select=([A-Za-z0-9_,]+)/g)) {
      select.push(...m[1].split(',').map(s => s.trim()).filter(Boolean))
    }
    for (const m of trozo.matchAll(new RegExp(`[?&]([a-z_]+)=(?:${OPERADORES})\\.`, 'g'))) {
      filtros.push(m[1])
    }
    i = src.indexOf('pos_turnos', i + 1)
  }
  return { select, filtros }
}

describe('pos_turnos — el código sólo pide columnas que existen', () => {
  for (const rel of ARCHIVOS) {
    it(`${rel}: ningún select nombra una columna inexistente`, () => {
      const { select } = columnasPedidas(fuente(rel))
      expect(select.length).toBeGreaterThan(0) // si no encontró nada, el extractor se rompió
      const inventadas = select.filter(c => !COLUMNAS_REALES.has(c))
      expect(inventadas, `columnas que NO existen en pos_turnos: ${inventadas.join(', ')}`).toEqual([])
    })

    it(`${rel}: ningún filtro nombra una columna inexistente`, () => {
      // Un filtro por columna inexistente también devuelve 400 — mismo fallo, otra vía.
      const { filtros } = columnasPedidas(fuente(rel))
      const inventadas = filtros.filter(c => !COLUMNAS_REALES.has(c))
      expect(inventadas, `filtros sobre columnas que NO existen: ${inventadas.join(', ')}`).toEqual([])
    })
  }

  it('REGRESION: `location_id` no vuelve a aparecer en una consulta a pos_turnos', () => {
    // El nombre exacto que causó el incidente. Existe en pos_orders, no en pos_turnos —
    // por eso es fácil de escribir por inercia.
    for (const rel of ARCHIVOS) {
      const { select, filtros } = columnasPedidas(fuente(rel))
      expect([...select, ...filtros]).not.toContain('location_id')
    }
  })
})

describe('El extractor detecta de verdad — si no, la prueba de arriba no vale nada', () => {
  it('atrapa una columna inventada en el select literal', () => {
    const falso = "fetch(`${u}/rest/v1/pos_turnos?id=eq.1&select=id,closed_at,columna_fantasma&limit=1`)"
    const { select } = columnasPedidas(falso)
    expect(select).toContain('columna_fantasma')
    expect(select.filter(c => !COLUMNAS_REALES.has(c))).toEqual(['columna_fantasma'])
  })

  it('REGRESION DE LA PRUEBA: atrapa la columna cuando viene de la CONSTANTE', () => {
    // La primera version de esta prueba fallaba aqui en silencio: leia la URL, donde
    // las columnas ya no aparecen literales. Reintroducir el bug pasaba 7/7.
    const conBug = "export const TURNO_SELECT_COLUMNS = ['id', 'closed_at', 'location_id'] as const\n" +
                   "fetch(`${u}/rest/v1/pos_turnos?id=eq.1&select=${TURNO_SELECT_COLUMNS.join(',')}`)"
    const { select } = columnasPedidas(conBug)
    expect(select).toContain('location_id')
    expect(select.filter(c => !COLUMNAS_REALES.has(c))).toEqual(['location_id'])
  })

  it('atrapa una columna inventada en un filtro', () => {
    const falso = "fetch(`${u}/rest/v1/pos_turnos?client_id=eq.x&location_id=is.null&select=id`)"
    const { filtros } = columnasPedidas(falso)
    expect(filtros).toContain('location_id')
    expect(filtros.filter(c => !COLUMNAS_REALES.has(c))).toEqual(['location_id'])
  })

  it('no marca como inventadas las columnas buenas', () => {
    const bueno = "fetch(`${u}/rest/v1/pos_turnos?client_id=eq.x&closed_at=is.null&select=id,closed_at`)"
    const { select, filtros } = columnasPedidas(bueno)
    expect([...select, ...filtros].filter(c => !COLUMNAS_REALES.has(c))).toEqual([])
  })

  it('lee el select aunque la URL esté partida en varias líneas', () => {
    const partido = [
      "fetch(",
      "  `${sbUrl}/rest/v1/pos_turnos?id=eq.${x}` +",
      "    `&client_id=eq.${c}&select=id,closed_at&limit=1`,",
      ")",
    ].join('\n')
    expect(columnasPedidas(partido).select).toEqual(['id', 'closed_at'])
  })
})
