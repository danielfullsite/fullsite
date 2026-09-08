import { describe, it, expect } from 'vitest'
import { cuadreDeTurno, tonoDeCuadre, TOLERANCIA_PESOS, type TurnoCerrado } from '@/lib/cuadre'

// La cuenta del cuadre ya existía y estaba guardada; lo que faltaba era
// mostrarla. Pero medido en la base de AMALAY el 2026-09-08: de 38 turnos
// cerrados, 37 tienen el conteo en CERO y ninguno lo tiene vacío. O sea que en
// la práctica se cierra sin contar y la columna guarda un cero que parece un
// conteo real.
//
// Mostrar la diferencia tal cual haría que el panel dijera «faltan $5,957»
// cuando lo que pasó es que nadie contó. Una acusación falsa de faltante es de
// las peores cosas que puede hacer un sistema en un restaurante: se la come una
// persona con nombre y apellido. Estas pruebas son sobre eso.

function turno(p: Partial<TurnoCerrado> = {}): TurnoCerrado {
  return {
    id: 't1', opened_at: '2026-09-03T14:00:00Z', closed_at: '2026-09-04T04:00:00Z',
    closed_by: 'Daniel', fondo_inicial: 1000, efectivo_sistema: 5000,
    fondo_final: 5000, diferencia: 0, ...p,
  }
}

describe('cuando SÍ contaron', () => {
  it('cuadra: lo dice y no alarma', () => {
    const c = cuadreDeTurno(turno({ efectivo_sistema: 5000, fondo_final: 5000, diferencia: 0 }))
    expect(c.estado).toBe('cuadra')
    expect(tonoDeCuadre(c.estado)).toBe('bien')
    expect(c.mensaje).toMatch(/Cuadra/)
  })

  it('falta dinero: lo dice con la palabra correcta y las dos cifras', () => {
    const c = cuadreDeTurno(turno({ efectivo_sistema: 5000, fondo_final: 4200, diferencia: -800 }))
    expect(c.estado).toBe('descuadra')
    expect(tonoDeCuadre(c.estado)).toBe('grave')
    expect(c.mensaje).toMatch(/Faltan/)
    expect(c.mensaje).toMatch(/800/)
    expect(c.mensaje).toMatch(/5,000/)   // qué esperaba
    expect(c.mensaje).toMatch(/4,200/)   // qué contaron
  })

  it('sobra dinero: no se llama faltante', () => {
    const c = cuadreDeTurno(turno({ efectivo_sistema: 5000, fondo_final: 5300, diferencia: 300 }))
    expect(c.estado).toBe('descuadra')
    expect(c.mensaje).toMatch(/Sobran/)
    expect(c.mensaje).not.toMatch(/Faltan/)
  })

  it('unos centavos son redondeo, no un descuadre que alguien deba explicar', () => {
    const c = cuadreDeTurno(turno({ efectivo_sistema: 5000, fondo_final: 4999.5, diferencia: -0.5 }))
    expect(Math.abs(-0.5)).toBeLessThan(TOLERANCIA_PESOS)
    expect(c.estado).toBe('cuadra')
  })
})

describe('cuando NO contaron — el caso que no puede acusar en falso', () => {
  it('cerrar con cero habiendo efectivo NO es un faltante', () => {
    // Éste es el caso real de 37 de los 38 turnos de AMALAY.
    const c = cuadreDeTurno(turno({ efectivo_sistema: 5957.76, fondo_final: 0, diferencia: -5957.76 }))
    expect(c.estado).toBe('sin-conteo')
    expect(tonoDeCuadre(c.estado)).toBe('aviso')      // no es 'grave'
    expect(c.mensaje).toMatch(/sin capturar el conteo/)
    // Lo que NO puede decir:
    expect(c.mensaje).not.toMatch(/Faltan/)
  })

  it('el conteo vacío tampoco se lee como cero contado', () => {
    const c = cuadreDeTurno(turno({ fondo_final: null, diferencia: null }))
    expect(c.estado).toBe('sin-conteo')
    expect(c.mensaje).not.toMatch(/Faltan|Cuadra/)
  })

  it('sin efectivo esperado y sin conteo, tampoco inventa que cuadró', () => {
    const c = cuadreDeTurno(turno({ efectivo_sistema: null, fondo_final: null, diferencia: null }))
    expect(c.estado).toBe('sin-conteo')
  })

  it('un día de cero efectivo real SÍ puede cuadrar', () => {
    // Sistema en cero y conteo en cero: no hay nada que reclamar.
    const c = cuadreDeTurno(turno({ efectivo_sistema: 0, fondo_final: 0, diferencia: 0 }))
    expect(c.estado).toBe('cuadra')
  })
})

describe('cuando no hay nada que cuadrar', () => {
  it('sin turno cerrado, el estado es abierto y no dice nada de dinero', () => {
    const c = cuadreDeTurno(null)
    expect(c.estado).toBe('abierto')
    expect(c.diferencia).toBeNull()
    expect(c.mensaje).not.toMatch(/\$/)
  })

  it('un turno todavía abierto no se juzga', () => {
    const c = cuadreDeTurno(turno({ closed_at: null }))
    expect(c.estado).toBe('abierto')
  })
})

describe('las cifras llegan como cadena desde la base', () => {
  it('numeric de PostgREST se convierte, no se concatena', () => {
    // Ya se pagó antes en este proyecto: numeric viaja como cadena y sumarlo
    // concatena. Aquí además rompería la comparación con la tolerancia.
    const c = cuadreDeTurno(turno({
      efectivo_sistema: '5000.00' as unknown as number,
      fondo_final: '4200.00' as unknown as number,
      diferencia: '-800.00' as unknown as number,
    }))
    expect(c.sistema).toBe(5000)
    expect(c.contado).toBe(4200)
    expect(c.diferencia).toBe(-800)
    expect(c.estado).toBe('descuadra')
  })

  it('una cadena que no es número no se cuela como cero', () => {
    const c = cuadreDeTurno(turno({ diferencia: 'n/d' as unknown as number, fondo_final: 4200, efectivo_sistema: 5000 }))
    expect(c.diferencia).toBeNull()
    expect(c.estado).toBe('sin-conteo')   // no se afirma que cuadre
  })
})
