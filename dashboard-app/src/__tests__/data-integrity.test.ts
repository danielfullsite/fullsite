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
    // ESTA PRUEBA MEDIA LA ZONA DEL PROCESO, NO LA DE MEXICO.
    //
    // Antes hacia `new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))`,
    // que toma los numeros de pared de Mexico y los reinterpreta como hora LOCAL DEL
    // PROCESO. El resultado dependia de donde corriera: en UTC y en Monterrey pasaba,
    // en Asia/Tokyo daba ~15 h y fallaba. Comprobado el 2026-09-09 corriendo la suite
    // completa con TZ=Asia/Tokyo.
    //
    // Es exactamente el idioma roto que el corte del dia dejo de usar (`todayMX()`,
    // `zonedStartOfDayISO`). Una prueba que lo consagra como correcto es peor que no
    // tenerla: el siguiente que necesite convertir zonas la copia.
    //
    // El desfase de verdad se saca comparando los numeros de pared contra el instante,
    // sin pasar por la zona del proceso.
    const ahora = new Date()
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(ahora)
    const n = (t: string) => Number(partes.find(x => x.type === t)!.value)
    const paredComoUTC = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
    const horas = (paredComoUTC - ahora.getTime()) / 3600000
    // -6 sin horario de verano, -5 con el. Mexico lo abolio en 2022, pero se acepta
    // el rango por si vuelve o por si la base de zonas del runner es vieja.
    expect(horas).toBeGreaterThanOrEqual(-6.01)
    expect(horas).toBeLessThanOrEqual(-4.99)
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
