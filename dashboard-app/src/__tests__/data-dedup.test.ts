import { describe, it, expect } from 'vitest'

// Reproduce dedupeByFecha logic for testing
function dedupeByFecha(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const f = row.fecha as string
    const ventas = (row.ventas_dia as number) || 0
    const existing = map.get(f)
    if (!existing || ventas > ((existing.ventas_dia as number) || 0)) {
      map.set(f, row)
    }
  }
  const seen = new Set<string>()
  const result: Record<string, unknown>[] = []
  for (const row of rows) {
    const f = row.fecha as string
    if (seen.has(f)) continue
    seen.add(f)
    result.push(map.get(f)!)
  }
  return result
}

describe('dedupeByFecha', () => {
  it('keeps row with highest ventas when duplicates exist', () => {
    const rows = [
      { fecha: '2026-05-24', ventas_dia: null, report_type: 'cierre' },
      { fecha: '2026-05-24', ventas_dia: 117698, report_type: 'avance' },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(1)
    expect(result[0].ventas_dia).toBe(117698)
  })

  it('keeps row with highest ventas (reversed order)', () => {
    const rows = [
      { fecha: '2026-05-24', ventas_dia: 117698, report_type: 'avance' },
      { fecha: '2026-05-24', ventas_dia: 5000, report_type: 'cierre' },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(1)
    expect(result[0].ventas_dia).toBe(117698)
  })

  it('handles null ventas_dia correctly', () => {
    const rows = [
      { fecha: '2026-05-24', ventas_dia: null },
      { fecha: '2026-05-24', ventas_dia: 50000 },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(1)
    expect(result[0].ventas_dia).toBe(50000)
  })

  it('keeps unique dates without duplicates', () => {
    const rows = [
      { fecha: '2026-05-23', ventas_dia: 88131 },
      { fecha: '2026-05-24', ventas_dia: 117698 },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(2)
  })

  it('handles multiple days with duplicates', () => {
    const rows = [
      { fecha: '2026-05-16', ventas_dia: 29129 },
      { fecha: '2026-05-16', ventas_dia: 69272 },
      { fecha: '2026-05-21', ventas_dia: 11693 },
      { fecha: '2026-05-21', ventas_dia: 37680 },
      { fecha: '2026-05-24', ventas_dia: 117698 },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(3)
    expect(result.find(r => r.fecha === '2026-05-16')?.ventas_dia).toBe(69272)
    expect(result.find(r => r.fecha === '2026-05-21')?.ventas_dia).toBe(37680)
    expect(result.find(r => r.fecha === '2026-05-24')?.ventas_dia).toBe(117698)
  })

  it('handles empty array', () => {
    expect(dedupeByFecha([])).toHaveLength(0)
  })

  it('handles all nulls — keeps one row', () => {
    const rows = [
      { fecha: '2026-05-24', ventas_dia: null },
      { fecha: '2026-05-24', ventas_dia: null },
    ]
    const result = dedupeByFecha(rows)
    expect(result).toHaveLength(1)
  })
})
