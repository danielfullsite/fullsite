import { describe, it, expect } from 'vitest'
import {
  validarDayparts, leerDayparts, franjaDe, aMinutos, contextoFranjas, preguntaDeFranjas,
  DAYPARTS_DEFAULT, type FilaFranja,
} from '@/lib/dayparts'

// Horarios reales de AMALAY (dueño, 2026-09-27).
const AMALAY = {
  franjas: [
    { nombre: 'Brunch', inicio: '08:00', fin: '13:00' },
    { nombre: 'Lunch', inicio: '13:01', fin: '17:00' },
    { nombre: 'Merienda', inicio: '17:01', fin: '18:59' },
    { nombre: 'Dinner', inicio: '19:00', fin: null },
  ],
}

describe('validarDayparts', () => {
  it('acepta los horarios de AMALAY y genera keys', () => {
    const v = validarDayparts(AMALAY)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.config.franjas.map(f => f.key)).toEqual(['brunch', 'lunch', 'merienda', 'dinner'])
  })

  it('rechaza traslapes (una orden no puede contar en dos franjas)', () => {
    const v = validarDayparts({ franjas: [
      { nombre: 'Brunch', inicio: '08:00', fin: '13:00' },
      { nombre: 'Lunch', inicio: '13:00', fin: '17:00' },
    ] })
    expect(v).toEqual({ ok: false, error: '"Brunch" y "Lunch" se enciman' })
  })

  it('"hasta el cierre" sólo puede ser la última', () => {
    const v = validarDayparts({ franjas: [
      { nombre: 'Cena', inicio: '19:00', fin: null },
      { nombre: 'Comida', inicio: '13:00', fin: '17:00' },
    ] })
    expect(v.ok).toBe(true) // se ordena por inicio: Comida, Cena
    const w = validarDayparts({ franjas: [
      { nombre: 'Todo', inicio: '08:00', fin: null },
      { nombre: 'Noche', inicio: '20:00', fin: '23:00' },
    ] })
    expect(w.ok).toBe(false)
  })

  it('permite franjas que cruzan medianoche dentro de la jornada', () => {
    const v = validarDayparts({ franjas: [
      { nombre: 'Cena', inicio: '19:00', fin: '23:59' },
      { nombre: 'Madrugada', inicio: '00:00', fin: '03:00' },
    ] })
    expect(v.ok).toBe(true)
  })

  it('rechaza horas inválidas, vacío y nombres repetidos se desambiguan', () => {
    expect(validarDayparts({ franjas: [] }).ok).toBe(false)
    expect(validarDayparts({ franjas: [{ nombre: 'X', inicio: '25:00', fin: null }] }).ok).toBe(false)
    const v = validarDayparts({ franjas: [
      { nombre: 'Turno', inicio: '08:00', fin: '12:00' },
      { nombre: 'Turno', inicio: '12:01', fin: null },
    ] })
    expect(v.ok && v.config.franjas.map(f => f.key)).toEqual(['turno', 'turno-2'])
  })
})

describe('franjaDe', () => {
  const cfg = (validarDayparts(AMALAY) as { ok: true; config: typeof DAYPARTS_DEFAULT }).config
  it.each([
    ['08:00', 'brunch'], ['13:00', 'brunch'], ['13:01', 'lunch'], ['17:00', 'lunch'],
    ['17:01', 'merienda'], ['18:59', 'merienda'], ['19:00', 'dinner'], ['23:30', 'dinner'],
    ['01:30', 'dinner'], // después de medianoche sigue siendo la cena (jornada empieza 5am)
  ])('%s → %s', (hora, key) => {
    expect(franjaDe(aMinutos(hora), cfg)?.key).toBe(key)
  })
  it('antes de abrir no cae en ninguna', () => {
    expect(franjaDe(aMinutos('07:30'), cfg)).toBeNull()
  })
})

describe('leerDayparts', () => {
  it('config rota → default, y lo avisa', () => {
    expect(leerDayparts({ franjas: 'x' })).toEqual({ config: DAYPARTS_DEFAULT, esDefault: true })
    expect(leerDayparts(null).esDefault).toBe(true)
    expect(leerDayparts(AMALAY).esDefault).toBe(false)
  })
})

describe('contextoFranjas', () => {
  const cfg = (validarDayparts(AMALAY) as { ok: true; config: typeof DAYPARTS_DEFAULT }).config
  const fila = (loc: string, franja: string, venta: number, comida: number, ordenes = 10): FilaFranja =>
    ({ location_id: loc, franja, ordenes, dias: 30, venta, venta_comida: comida, venta_bebida: venta - comida, fuente: 'pos' })

  it('calcula % de venta total y de comida por franja', () => {
    const txt = contextoFranjas({
      filas: [fila('a', 'brunch', 600, 400), fila('a', 'lunch', 400, 100)],
      config: cfg, esDefault: false, desde: '2026-08-28', hasta: '2026-09-27', nombreSucursal: id => id,
    })
    expect(txt).toContain('Brunch: 60.0% de la venta total ($600), 80.0% de la venta de COMIDA ($400)')
    expect(txt).toContain('Lunch: 40.0% de la venta total ($400), 20.0% de la venta de COMIDA ($100)')
    expect(txt).not.toContain('POR SUCURSAL')
  })

  it('con varias sucursales agrega el desglose por sucursal', () => {
    const txt = contextoFranjas({
      filas: [fila('centro', 'brunch', 100, 50), fila('valle', 'dinner', 300, 200)],
      config: cfg, esDefault: false, desde: 'a', hasta: 'b', nombreSucursal: id => id.toUpperCase(),
    })
    expect(txt).toContain('POR SUCURSAL (2)')
    expect(txt).toContain('CENTRO:')
    expect(txt).toContain('VALLE:')
  })

  it('sin datos no inventa porcentajes', () => {
    const txt = contextoFranjas({ filas: [], config: cfg, esDefault: true, desde: 'a', hasta: 'b', nombreSucursal: id => id })
    expect(txt).toContain('no inventes porcentajes')
    expect(txt).toContain('/configuracion/horarios-venta')
  })
})

describe('preguntaDeFranjas', () => {
  it('detecta las preguntas de horario, incluidas franjas propias', () => {
    expect(preguntaDeFranjas('¿Qué % de mi venta de comida es de brunch, lunch y dinner?')).toBe(true)
    expect(preguntaDeFranjas('como va la hora feliz', { franjas: [{ key: 'hf', nombre: 'Hora Feliz', inicio: '18:00', fin: '20:00' }] })).toBe(true)
    expect(preguntaDeFranjas('quién es el mejor mesero')).toBe(false)
  })
})
