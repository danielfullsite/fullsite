import { describe, it, expect } from 'vitest'
import {
  REGIMENES_FISCALES,
  USOS_CFDI,
  formatMXN,
  generateId,
} from '../lib/pos-data'

describe('CFDI — Regimenes fiscales', () => {
  it('contains common regimenes', () => {
    const claves = REGIMENES_FISCALES.map(r => r.clave)
    expect(claves).toContain('601') // General PM
    expect(claves).toContain('612') // PFAE
    expect(claves).toContain('616') // Sin obligaciones
    expect(claves).toContain('626') // RESICO
  })

  it('each regimen has clave and nombre', () => {
    for (const r of REGIMENES_FISCALES) {
      expect(r.clave).toBeTruthy()
      expect(r.nombre).toBeTruthy()
      expect(r.clave.length).toBe(3)
    }
  })

  it('has at least 10 regimenes', () => {
    expect(REGIMENES_FISCALES.length).toBeGreaterThanOrEqual(10)
  })
})

describe('CFDI — Usos CFDI', () => {
  it('contains common usos', () => {
    const claves = USOS_CFDI.map(u => u.clave)
    expect(claves).toContain('G01') // Adquisicion
    expect(claves).toContain('G03') // Gastos en general
    expect(claves).toContain('S01') // Sin efectos fiscales
  })

  it('each uso has clave and nombre', () => {
    for (const u of USOS_CFDI) {
      expect(u.clave).toBeTruthy()
      expect(u.nombre).toBeTruthy()
    }
  })
})

describe('CFDI — RFC validation patterns', () => {
  const rfcRegex = /^[A-Z&]{3,4}\d{6}[A-Z0-9]{3}$/

  it('validates correct RFC persona moral (12 chars)', () => {
    expect(rfcRegex.test('ABC010101AB1')).toBe(true)
  })

  it('validates correct RFC persona fisica (13 chars)', () => {
    expect(rfcRegex.test('XAXX010101000')).toBe(true)
    expect(rfcRegex.test('ROFD880101ABC')).toBe(true)
  })

  it('rejects invalid RFC', () => {
    expect(rfcRegex.test('123')).toBe(false)
    expect(rfcRegex.test('')).toBe(false)
    expect(rfcRegex.test('abc010101000')).toBe(false) // lowercase
  })

  it('accepts RFC with & (persona moral)', () => {
    expect(rfcRegex.test('A&B010101AB1')).toBe(true)
  })
})

describe('CFDI — IVA calculations', () => {
  const IVA_RATE = 0.16

  it('calculates IVA from total correctly', () => {
    const total = 1160
    const subtotal = total / (1 + IVA_RATE)
    const iva = total - subtotal
    expect(Math.round(subtotal * 100) / 100).toBe(1000)
    expect(Math.round(iva * 100) / 100).toBe(160)
  })

  it('handles small amounts', () => {
    const total = 100
    const subtotal = total / (1 + IVA_RATE)
    const iva = total - subtotal
    expect(subtotal + iva).toBeCloseTo(100, 2)
  })

  it('handles zero', () => {
    const total = 0
    const subtotal = total / (1 + IVA_RATE)
    expect(subtotal).toBe(0)
  })
})

describe('CFDI — ID generation', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('generates string IDs', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

describe('formatMXN', () => {
  it('formats currency with $ prefix', () => {
    const result = formatMXN(1234.56)
    expect(result).toContain('$')
    expect(result).toContain('1234')
  })

  it('formats zero', () => {
    expect(formatMXN(0)).toContain('0')
  })

  it('handles large amounts', () => {
    const result = formatMXN(999999.99)
    expect(result).toContain('$')
    expect(result).toContain('999999')
  })

  it('handles negative amounts', () => {
    const result = formatMXN(-500)
    expect(result).toContain('500')
  })
})
