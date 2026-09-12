import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { camposProhibidos, MANAGER_ONLY_WRITE, puedeEscribirEn, REABRIR_SOLO_GERENTE } from '@/lib/pos-db-policy'

// REABRIR EL TURNO YA CORTADO.
//
// Encontrado el 2026-09-08 por la cacería de bugs de dinero (73 agentes, 8 caminos).
// El candado de anoche puso `pos_cierres` bajo MANAGER_ONLY_WRITE pero dejó `pos_turnos`
// abierta, así que con un shift token de mesero:
//
//     PATCH pos_turnos?id=eq.<turno>   { "closed_at": null }
//
// y el turno vuelve a estar abierto DESPUÉS del Corte Z. Lo que se cobre ahí dentro queda
// fuera del corte que ya se imprimió y se entregó.
//
// POR QUÉ NO SE ARREGLÓ METIENDO LA TABLA EN MANAGER_ONLY_WRITE, que era lo obvio:
// el cierre de caja se ENCOLA (CierreCajaWizard.tsx:315) y la cola lo reproduce con el rol
// de quien esté logueado en esa terminal. En una caja que opera con rol `cajero` —lo normal—
// un candado por tabla haría que el Corte Z muriera en 403 y el dinero del turno no subiera
// nunca. Se habría cambiado un hueco por uno peor.
//
// La asimetría es el arreglo: cerrar es rutina y la cola debe poder reproducirlo; reabrir es
// corrección administrativa. Se prohíbe el VALOR (`closed_at: null`), no la columna.

const MESERO = 'mesero'
const GERENTE = 'gerente'

describe('el vector', () => {
  it('un mesero no puede escribir ni crear turnos', () => {
    expect(puedeEscribirEn('pos_turnos', MESERO)).toBe(false)
    expect(puedeEscribirEn('pos_turnos', 'cajero')).toBe(true)
  })

  it('un mesero ya no puede reabrir un turno', () => {
    const v = camposProhibidos('pos_turnos', MESERO, JSON.stringify({ closed_at: null }))
    expect(v.length).toBeGreaterThan(0)
    expect(v[0]).toMatch(/reabrir/)
  })

  it('ni escondiéndolo entre otros campos', () => {
    const v = camposProhibidos('pos_turnos', MESERO, JSON.stringify({ notas: 'ajuste', closed_at: null }))
    expect(v.length).toBeGreaterThan(0)
  })

  it('ni mandando un arreglo de filas', () => {
    // PostgREST acepta arreglos; revisar sólo la primera fila dejaría pasar la segunda.
    const v = camposProhibidos('pos_turnos', MESERO,
      JSON.stringify([{ notas: 'x' }, { closed_at: null }]))
    expect(v.length).toBeGreaterThan(0)
  })

  it('un gerente sí puede — es una corrección administrativa legítima', () => {
    expect(camposProhibidos('pos_turnos', GERENTE, JSON.stringify({ closed_at: null }))).toEqual([])
    expect(camposProhibidos('pos_turnos', 'admin', JSON.stringify({ closed_at: null }))).toEqual([])
    expect(camposProhibidos('pos_turnos', 'dueño', JSON.stringify({ closed_at: null }))).toEqual([])
  })
})

describe('lo que NO se puede romper: el corte tiene que poder subir', () => {
  it('CERRAR el turno sigue pasando con rol de cajero', () => {
    // Esta es la prueba que impide el arreglo ingenuo. Si algún día alguien mete
    // pos_turnos en MANAGER_ONLY_WRITE, esta prueba se pone roja y explica por qué.
    const cierre = JSON.stringify({ closed_at: '2026-09-08T23:00:00Z', closed_by: 'Ana', fondo_final: 1500 })
    expect(camposProhibidos('pos_turnos', 'cajero', cierre)).toEqual([])
  })

  it('y pos_turnos NO está en MANAGER_ONLY_WRITE, a propósito', () => {
    expect(MANAGER_ONLY_WRITE.has('pos_turnos')).toBe(false)
    expect(puedeEscribirEn('pos_turnos', 'cajero')).toBe(true)
  })

  it('abrir un turno tampoco se bloquea', () => {
    const apertura = JSON.stringify({ id: 'abc', opened_by: 'Ana', fondo_inicial: 1000, opened_at: '2026-09-08T14:00:00Z' })
    expect(camposProhibidos('pos_turnos', 'cajero', apertura)).toEqual([])
  })
})

describe('la regla no se derrama a otras tablas', () => {
  it('sólo pos_turnos tiene regla de reapertura hoy', () => {
    expect(Object.keys(REABRIR_SOLO_GERENTE)).toEqual(['pos_turnos'])
  })

  it('una tabla sin reglas sigue pasando entera', () => {
    expect(camposProhibidos('pos_mesas', MESERO, JSON.stringify({ closed_at: null }))).toEqual([])
  })

  it('y pos_orders conserva su candado por columna', () => {
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ total: 1 }))).toContain('total')
  })

  it('un cuerpo ilegible se sigue rechazando en las tablas con regla', () => {
    expect(camposProhibidos('pos_turnos', MESERO, '{roto')).toEqual(['(cuerpo ilegible)'])
  })
})

describe('los dos proxies heredan la regla sin tocarlos', () => {
  const lee = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')

  for (const ruta of ['app/api/pos/db/route.ts', 'app/api/pos/db/[...path]/route.ts']) {
    it(`${ruta} llama a camposProhibidos`, () => {
      expect(lee(ruta)).toMatch(/prepararCuerpoProxy\(/)
    })
  }
})
