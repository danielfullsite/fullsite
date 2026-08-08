import { describe, it, expect } from 'vitest'

// ─── W1-C — paridad TS ↔ Python del business date canónico ──────────────────
// Los `expected` de los fixtures fueron generados por la implementación Python
// de referencia (ops_aggregate.py) vía scripts/wave1/w1c_parity_gen.py.
// PASS = salida idéntica en los 105 casos instante→fecha y 30 casos de bounds,
// incluyendo boundary exacto (±1s), medianoche, tres zonas IANA y los dos días
// de transición DST de America/New_York (spring forward y fall back).

import {
  getBusinessDate,
  getBusinessDayBounds,
  getBusinessDayConfig,
  resolveBusinessDayConfig,
  parseBoundary,
} from '@/lib/business-date'
import fixtures from './fixtures/w1c-business-date-parity.json'

describe('W1-C — paridad instante→business_date (Python = referencia)', () => {
  for (const c of fixtures.business_date_cases) {
    it(c.label, () => {
      expect(getBusinessDate(c.ts_utc, c.tz, c.boundary)).toBe(c.expected)
    })
  }
})

describe('W1-C — paridad de bounds UTC', () => {
  for (const c of fixtures.bounds_cases) {
    it(`bounds ${c.fecha} ${c.tz} b=${c.boundary}`, () => {
      const b = getBusinessDayBounds(c.fecha, c.tz, c.boundary)
      // Mismo instante (comparación por epoch — el formato ISO puede diferir en '.000')
      expect(new Date(b.utcStart).getTime()).toBe(new Date(c.utc_start).getTime())
      expect(new Date(b.utcEnd).getTime()).toBe(new Date(c.utc_end).getTime())
    })
  }
})

describe('W1-C — sin huecos ni traslapes', () => {
  it('end(D) === start(D+1) para todo par consecutivo (incl. días DST)', () => {
    const byKey = new Map<string, typeof fixtures.bounds_cases>()
    for (const c of fixtures.bounds_cases) {
      const k = `${c.tz}|${c.boundary}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(c)
    }
    let pairs = 0
    for (const cases of byKey.values()) {
      const sorted = [...cases].sort((a, b) => a.fecha.localeCompare(b.fecha))
      for (let i = 0; i + 1 < sorted.length; i++) {
        const d0 = new Date(sorted[i].fecha + 'T00:00:00Z')
        const d1 = new Date(sorted[i + 1].fecha + 'T00:00:00Z')
        if (d1.getTime() - d0.getTime() === 86_400_000) {
          expect(sorted[i].utc_end).toBe(sorted[i + 1].utc_start)
          pairs++
        }
      }
    }
    expect(pairs).toBeGreaterThan(0)
  })

  it('cada instante cae en exactamente un día: [start, end) semántica exacta', () => {
    for (const c of fixtures.bounds_cases) {
      const start = new Date(c.utc_start)
      const end = new Date(c.utc_end)
      // El inicio pertenece al día D
      expect(getBusinessDate(start, c.tz, c.boundary)).toBe(c.fecha)
      // Un segundo antes del inicio NO pertenece a D
      expect(getBusinessDate(new Date(start.getTime() - 1000), c.tz, c.boundary)).not.toBe(c.fecha)
      // Un segundo antes del fin pertenece a D
      expect(getBusinessDate(new Date(end.getTime() - 1000), c.tz, c.boundary)).toBe(c.fecha)
      // El fin exacto ya NO pertenece a D (pertenece a D+1)
      expect(getBusinessDate(end, c.tz, c.boundary)).not.toBe(c.fecha)
    }
  })
})

describe('W1-C — fail closed / degradación explícita', () => {
  it('timezone faltante → throw (sin fallback a zona del servidor/navegador)', () => {
    expect(() => getBusinessDayConfig({ id: 'x', business_day_start_local: '04:00:00' })).toThrow(/timezone/)
    expect(() => resolveBusinessDayConfig({ id: 'x' })).toThrow(/timezone/)
  })

  it('timezone IANA inválida → throw', () => {
    expect(() => getBusinessDayConfig({ id: 'x', timezone: 'America/Nowhere', business_day_start_local: '04:00' })).toThrow()
  })

  it('boundary faltante → throw en config estricta (paridad con Python)', () => {
    expect(() => getBusinessDayConfig({ id: 'x', timezone: 'America/Monterrey' })).toThrow(/business_day_start_local/)
  })

  it('boundary inválido → throw', () => {
    expect(() => parseBoundary('25:00')).toThrow()
    expect(() => parseBoundary('abc')).toThrow()
    expect(() => parseBoundary('')).toThrow()
  })

  it('resolver de UI degrada EXPLÍCITAMENTE a medianoche con flag', () => {
    const r = resolveBusinessDayConfig({ id: 'sin-config', timezone: 'America/Monterrey' })
    expect(r.degraded).toBe(true)
    expect(r.boundary).toBe('00:00')
    const ok = resolveBusinessDayConfig({ id: 'con-config', timezone: 'America/Monterrey', business_day_start_local: '04:00:00' })
    expect(ok.degraded).toBe(false)
    expect(ok.boundary).toBe('04:00:00')
  })

  it('sin -06:00 hardcodeado: mismo instante, distinta zona → distinta fecha', () => {
    // 2026-08-08T05:30:00Z = 23:30 (ago 7) en Monterrey, 14:30 (ago 8) en Tokio
    expect(getBusinessDate('2026-08-08T05:30:00Z', 'America/Monterrey', '04:00:00')).toBe('2026-08-07')
    expect(getBusinessDate('2026-08-08T05:30:00Z', 'Asia/Tokyo', '04:00:00')).toBe('2026-08-08')
  })
})
