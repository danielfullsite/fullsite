import { describe, expect, it } from 'vitest'
import { resolvePayrollHours } from '@/lib/nomina'

describe('horas de prenómina', () => {
  it('distingue horas medidas de la estimación de 8 horas por día', () => {
    expect(resolvePayrollHours(14.5, 2)).toEqual({ total: 14.5, measured: true })
    expect(resolvePayrollHours(undefined, 2)).toEqual({ total: 16, measured: false })
  })

  it('no convierte días negativos ni horas inválidas en dinero', () => {
    expect(resolvePayrollHours(Number.NaN, -1)).toEqual({ total: 0, measured: false })
  })
})
