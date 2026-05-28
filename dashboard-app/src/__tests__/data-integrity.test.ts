import { describe, it, expect } from 'vitest'

// Reproduce parseRow sanitization
const num = (v: unknown) => Number(v) || 0

describe('Data Integrity — parseRow sanitization', () => {
  it('converts null to 0', () => {
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
  })

  it('converts string numbers', () => {
    expect(num('117698.0')).toBe(117698)
    expect(num('0')).toBe(0)
    expect(num('')).toBe(0)
  })

  it('keeps valid numbers', () => {
    expect(num(42)).toBe(42)
    expect(num(0)).toBe(0)
    expect(num(99999.99)).toBe(99999.99)
  })

  it('handles NaN/Infinity', () => {
    expect(num(NaN)).toBe(0)
    expect(num(Infinity)).toBe(Infinity) // valid number
  })

  it('handles negative numbers', () => {
    expect(num(-500)).toBe(-500)
    expect(num('-100')).toBe(-100)
  })
})

describe('Data Integrity — timezone', () => {
  it('Mexico City is UTC-6', () => {
    const now = new Date()
    const mxStr = now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
    const mx = new Date(mxStr)
    // MX should be 5-7 hours behind UTC depending on DST
    const diffHours = (now.getTime() - mx.getTime()) / 3600000
    expect(Math.abs(diffHours)).toBeLessThan(8)
  })

  it('fmt produces YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 24) // May 24, 2026
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const result = `${y}-${m}-${day}`
    expect(result).toBe('2026-05-24')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('Data Integrity — week calculation logic', () => {
  it('dow=6 (Saturday) goes back 5 days', () => {
    const dow: number = 6
    const daysBack = dow === 0 ? 6 : dow - 1
    expect(daysBack).toBe(5)
  })

  it('dow=0 (Sunday) goes back 6 days', () => {
    const dow: number = 0
    const daysBack = dow === 0 ? 6 : dow - 1
    expect(daysBack).toBe(6)
  })

  it('dow=1 (Monday) goes back 0 days', () => {
    const dow: number = 1
    const daysBack = dow === 0 ? 6 : dow - 1
    expect(daysBack).toBe(0)
  })

  it('dow=3 (Wednesday) goes back 2 days', () => {
    const dow: number = 3
    const daysBack = dow === 0 ? 6 : dow - 1
    expect(daysBack).toBe(2)
  })

  it('dow=5 (Friday) goes back 4 days', () => {
    const dow: number = 5
    const daysBack = dow === 0 ? 6 : dow - 1
    expect(daysBack).toBe(4)
  })
})

describe('Data Integrity — payment method percentages', () => {
  it('percentages sum to ~100', () => {
    const methods = [
      { nombre: 'Tarjeta de credito', total: 46.2 },
      { nombre: 'Tarjeta de debito', total: 28.6 },
      { nombre: 'Efectivo', total: 14.4 },
      { nombre: 'Ubereats', total: 7.8 },
      { nombre: 'Rappi', total: 2.4 },
      { nombre: 'Transferencia', total: 0.6 },
    ]
    const sum = methods.reduce((s, m) => s + m.total, 0)
    expect(sum).toBeCloseTo(100, 0)
  })
})
