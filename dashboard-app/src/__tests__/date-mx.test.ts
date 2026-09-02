import { describe, it, expect } from 'vitest'
import {
  getActiveTimezone,
  setActiveTimezone,
  zonedStartOfDayISO,
  nowMX,
  fmtDateMX,
} from '@/lib/date-mx'

// Corre en environment: 'node' (vitest.config.ts) → typeof window === 'undefined'.
// Aquí se prueba la lógica pura y el default de servidor. La resolución por
// localStorage / zona de la máquina se prueba en date-mx.dom.test.ts (jsdom).

describe('getActiveTimezone (servidor/SSR)', () => {
  it('sin window cae al default México centro', () => {
    expect(getActiveTimezone()).toBe('America/Mexico_City')
  })
  it('setActiveTimezone es no-op en servidor (no lanza)', () => {
    expect(() => setActiveTimezone('America/Tijuana')).not.toThrow()
    expect(getActiveTimezone()).toBe('America/Mexico_City')
  })
})

describe('zonedStartOfDayISO', () => {
  it('México centro = idéntico al viejo offset -06:00 (retrocompatible)', () => {
    expect(zonedStartOfDayISO('2026-09-02', 'America/Mexico_City')).toBe('2026-09-02T06:00:00.000Z')
    // Debe empatar exactamente al literal que reemplazó en la query del dashboard.
    expect(zonedStartOfDayISO('2026-09-02', 'America/Mexico_City'))
      .toBe(new Date('2026-09-02T00:00:00-06:00').toISOString())
  })

  it('Tijuana en verano (PDT, UTC-7) → inicio de día a las 07:00 UTC', () => {
    expect(zonedStartOfDayISO('2026-07-15', 'America/Tijuana')).toBe('2026-07-15T07:00:00.000Z')
  })

  it('Tijuana en invierno (PST, UTC-8) → inicio de día a las 08:00 UTC', () => {
    expect(zonedStartOfDayISO('2026-01-15', 'America/Tijuana')).toBe('2026-01-15T08:00:00.000Z')
  })

  it('UTC → medianoche exacta', () => {
    expect(zonedStartOfDayISO('2026-09-02', 'UTC')).toBe('2026-09-02T00:00:00.000Z')
  })

  it('sin tz explícita usa la zona activa (default centro en servidor)', () => {
    expect(zonedStartOfDayISO('2026-09-02')).toBe('2026-09-02T06:00:00.000Z')
  })
})

describe('nowMX / fmtDateMX', () => {
  it('fmtDateMX formatea YYYY-MM-DD', () => {
    expect(fmtDateMX(new Date('2026-09-02T18:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('una venta a las 23:00 hora centro cae en ESE día, no el siguiente (UTC)', () => {
    // 2026-09-02 23:00 centro = 2026-09-03 05:00 UTC. .toISOString().slice(0,10)
    // daría 2026-09-03 (el bug). fmtDateMX (zona centro) debe dar 2026-09-02.
    const lateSale = new Date('2026-09-03T05:00:00Z')
    expect(fmtDateMX(lateSale)).toBe('2026-09-02')
    expect(lateSale.toISOString().slice(0, 10)).toBe('2026-09-03') // el viejo comportamiento
  })
  it('nowMX devuelve una fecha válida', () => {
    expect(nowMX().getTime()).toBeGreaterThan(0)
  })
})
