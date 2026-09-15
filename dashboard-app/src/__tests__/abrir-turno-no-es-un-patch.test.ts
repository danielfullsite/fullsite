// ABRIR UN TURNO ES INSERTAR UNA FILA, NO PARCHEAR LA TABLA ENTERA.
//
// Campo, AMALAY, 2026-09-14. Se abrió turno DOS veces, con la terminal online.
// Las dos veces la pantalla dijo «Turno activo», las dos veces Supabase se quedó
// sin ningún turno abierto, y las dos veces `/pos/mesas` dijo «No hay turno
// abierto» — y mesas tenía razón. En medio, `/pos/turno` y `/pos/mesas` se
// contradecían sobre si el restaurante estaba abierto.
//
// Leyendo los renglones de `sync_queue` en la terminal:
//
//     table       : pos_turnos
//     method      : PATCH
//     retries     : 0
//     error_class : TERMINAL_NON_RETRYABLE
//     error_detail: "MUTACION_SIN_FILTRO: PATCH pos_turnos habria tocado toda la tabla"
//
// ── LA CADENA, ESLABÓN POR ESLABÓN ──────────────────────────────────────────
//
//   1. `openTurno` (pos-data.ts) encola con `addToQueue('pos_turnos', body)`,
//      la cola vieja de localStorage. `addToQueue` guarda {id, table, data,
//      timestamp, synced}: NO tiene campo para `method` ni para `endpoint`.
//   2. `drainLocalStorageToIdb` migra ese renglón a IndexedDB y, al no encontrar
//      método, cae a su valor por omisión: **PATCH**.
//   3. En el reenvío, `restPath = item.endpoint || item.table` da "pos_turnos"
//      pelón, sin `?id=eq.…`.
//   4. `esMutacionSinFiltro('PATCH', 'pos_turnos')` es verdadero y la guarda se
//      niega a mandarlo.
//   5. `markConflict(..., 'TERMINAL_NON_RETRYABLE')` y `getPendingQueue(true)`
//      descarta todo lo que traiga `error_class`: el renglón queda invisible
//      para siempre, con `retries: 0` y sin error a la vista.
//
// ── LA GUARDA TIENE RAZÓN. EL QUE ESTÁ MAL ES QUIEN ENCOLA ──────────────────
//
// Un `PATCH pos_turnos` sin filtro habría tocado TODAS las filas. Esa guarda
// existe por el incidente del 2026-08-31, cuando un PATCH sin filtro cerró once
// turnos de un golpe. Hacerla más permisiva sería deshacer ese arreglo.
//
// Lo que está mal es el método: un turno que se abre es una fila NUEVA. El
// camino online ya lo hace bien —POST con `resolution=merge-duplicates`, porque
// el id se genera del lado del cliente y es estable—. El camino offline se
// quedaba con el default equivocado.
//
// Nota de historia: el mismo default ya había mordido antes. El comentario de
// `drainLocalStorageToIdb` dice «el viejo default PATCH lo dejaba en 405 eterno»
// y lo arreglaron... sólo para los endpoints `/api/`. Las tablas se quedaron.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { esMutacionSinFiltro } from '../lib/pos-offline-db'

const SRC = resolve(__dirname, '..')
const posData = readFileSync(join(SRC, 'lib', 'pos-data.ts'), 'utf8')
const offlineDb = readFileSync(join(SRC, 'lib', 'pos-offline-db.ts'), 'utf8')
const offlineSync = readFileSync(join(SRC, 'lib', 'offline-sync.ts'), 'utf8')

describe('la guarda de mutación sin filtro sigue siendo estricta', () => {
  it('un PATCH a una tabla pelada se rechaza', () => {
    // Si esto deja de ser true, se deshizo el arreglo del incidente del
    // 2026-08-31 en el que un PATCH sin filtro cerró once turnos.
    expect(esMutacionSinFiltro('PATCH', 'pos_turnos')).toBe(true)
    expect(esMutacionSinFiltro('DELETE', 'pos_orders')).toBe(true)
  })

  it('con filtro pasa, y un POST nunca es una mutación sin filtro', () => {
    expect(esMutacionSinFiltro('PATCH', 'pos_turnos?id=eq.abc')).toBe(false)
    expect(esMutacionSinFiltro('POST', 'pos_turnos')).toBe(false)
  })
})

describe('abrir turno encola un INSERT', () => {
  it('REGRESION: openTurno dice explícitamente que es POST', () => {
    // Depender de un valor por omisión fue justo lo que rompió esto. El método
    // se declara donde se conoce la intención, no se adivina dos capas después.
    const bloque = posData.slice(posData.indexOf('const queueForSync'), posData.indexOf('const queueForSync') + 600)
    expect(bloque).toMatch(/'POST'/)
  })

  it('REGRESION: la migración ya no asume PATCH para un renglón de tabla', () => {
    // Un renglón de `addToQueue(tabla, datos)` es un INSERT por construcción:
    // esa función nunca tuvo forma de expresar otra cosa.
    const bloque = offlineDb.slice(offlineDb.indexOf('drainLocalStorageToIdb'))
    expect(bloque.slice(0, 1400)).not.toMatch(/\?\s*'POST'\s*:\s*'PATCH'/)
  })

  it('addToQueue puede declarar su método', () => {
    expect(offlineSync).toMatch(/export function addToQueue\([^)]*method/)
  })
})
