import { describe, it, expect } from 'vitest'
import { nominaDelDia, type LaborDay } from '@/lib/labor'

// El costo de personal es el segundo gasto más grande de un restaurante y el
// único que se corrige mañana: abrir con un mesero menos, mandar a alguien a
// casa. El cálculo ya existía completo en /api/labor; sólo vivía en una página
// a la que hay que entrar a propósito.
//
// Lo delicado no es el cálculo, es cuándo NO pintar un número. Medido en la base
// de AMALAY el 2026-09-08: 40 empleados activos y CERO con sueldo cargado. Con
// eso el costo da cero, y «$0 · 0% de la venta» en verde se lee como «no gastas
// en nómina», que es exactamente lo contrario de la verdad.

const dia = (p: Partial<LaborDay> = {}): LaborDay =>
  ({ fecha: '2026-09-03', cost: 18900, hours: 96, headcount: 12, sales: 81500, ...p })

describe('cuando la cifra significa algo', () => {
  it('mide el porcentaje de la venta y lo ubica en su zona', () => {
    const n = nominaDelDia(dia({ cost: 16000, sales: 81500 }), true)
    expect(n.estado).toBe('medido')
    expect(n.costo).toBe(16000)
    expect(n.pctVenta).toBeCloseTo(0.196, 3)
    expect(n.zona).toBe('verde')          // ≤ 22%
  })

  it('avisa en amarillo cuando pasa de lo cómodo', () => {
    const n = nominaDelDia(dia({ cost: 20000, sales: 81500 }), true)   // 24.5%
    expect(n.zona).toBe('amarillo')
    expect(n.mensaje).toMatch(/arriba de lo cómodo/)
  })

  it('avisa en rojo cuando se come la venta', () => {
    const n = nominaDelDia(dia({ cost: 30000, sales: 81500 }), true)   // 36.8%
    expect(n.zona).toBe('rojo')
    expect(n.mensaje).toMatch(/se comió más de lo esperado/)
  })

  it('trae las horas y las personas, que es lo que se ajusta mañana', () => {
    const n = nominaDelDia(dia({ hours: 96, headcount: 12 }), true)
    expect(n.horas).toBe(96)
    expect(n.personas).toBe(12)
  })
})

describe('cuando NO hay con qué medir — el caso que no puede mentir', () => {
  it('sin sueldos cargados NO dice cero: dice qué falta', () => {
    // Éste es el caso real de AMALAY hoy.
    const n = nominaDelDia(dia({ cost: 0 }), false)
    expect(n.estado).toBe('sin-sueldos')
    expect(n.costo).toBeNull()
    expect(n.pctVenta).toBeNull()
    expect(n.zona).toBe('sin-dato')       // no 'verde'
    expect(n.mensaje).toMatch(/Falta cargar los sueldos/)
  })

  it('un cero de nómina jamás se pinta como zona buena', () => {
    // El riesgo concreto: 0 / venta = 0%, que cae en verde por debajo del umbral.
    const n = nominaDelDia(dia({ cost: 0, hours: 0 }), false)
    expect(n.zona).not.toBe('verde')
  })

  it('sin turnos registrados ese día tampoco inventa', () => {
    const n = nominaDelDia(dia({ hours: 0, cost: 0 }), true)
    expect(n.estado).toBe('sin-turnos')
    expect(n.pctVenta).toBeNull()
  })

  it('sin venta no hay contra qué medir: no divide entre cero', () => {
    const n = nominaDelDia(dia({ sales: 0 }), true)
    expect(n.estado).toBe('sin-turnos')
    expect(n.pctVenta).toBeNull()
    expect(Number.isFinite(n.pctVenta as number)).toBe(false)
  })

  it('un día sin dato no se confunde con un día medido', () => {
    const n = nominaDelDia(undefined, true)
    expect(n.estado).toBe('sin-turnos')
    expect(n.costo).toBeNull()
  })
})
