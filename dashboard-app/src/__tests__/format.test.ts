import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDate,
  formatShortDate,
  percentChange,
} from '@/lib/format'

// ─── formatCurrency ───────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0')
  })

  it('formats positive integers', () => {
    const result = formatCurrency(1234)
    expect(result).toContain('1')
    expect(result).toContain('234')
    expect(result).toContain('$')
  })

  it('formats large numbers', () => {
    const result = formatCurrency(1234567)
    expect(result).toContain('$')
    // Should contain the digits, possibly with comma/period separators
    expect(result).toMatch(/1.*234.*567/)
  })

  it('handles null', () => {
    expect(formatCurrency(null)).toBe('$0')
  })

  it('handles undefined', () => {
    expect(formatCurrency(undefined)).toBe('$0')
  })

  it('handles NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0')
  })

  it('formats negative numbers', () => {
    const result = formatCurrency(-500)
    expect(result).toContain('500')
    expect(result).toContain('-')
  })

  it('rounds to zero fraction digits', () => {
    // maximumFractionDigits: 0 means no decimals
    const result = formatCurrency(1234.56)
    // Should NOT contain .56
    expect(result).not.toContain('.56')
  })

  it('formats small numbers', () => {
    const result = formatCurrency(5)
    expect(result).toContain('$')
    expect(result).toContain('5')
  })

  it('formats very large amounts', () => {
    const result = formatCurrency(999999)
    expect(result).toContain('$')
  })
})

// ─── formatNumber ─────────────────────────────────────────────────────────

describe('formatNumber', () => {
  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('formats positive integer', () => {
    const result = formatNumber(42)
    expect(result).toBe('42')
  })

  it('formats large number with separators', () => {
    const result = formatNumber(1234567)
    // es-MX uses comma or period as thousands separator
    expect(result).toMatch(/1.*234.*567/)
  })

  it('handles null', () => {
    expect(formatNumber(null)).toBe('0')
  })

  it('handles undefined', () => {
    expect(formatNumber(undefined)).toBe('0')
  })

  it('handles NaN', () => {
    expect(formatNumber(NaN)).toBe('0')
  })

  it('formats negative number', () => {
    const result = formatNumber(-100)
    expect(result).toContain('100')
    expect(result).toContain('-')
  })

  it('formats decimal number', () => {
    const result = formatNumber(3.14)
    expect(result).toContain('3')
  })
})

// ─── formatPercent ────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('formats positive percentage with + sign', () => {
    expect(formatPercent(12.5)).toBe('+12.5%')
  })

  it('formats negative percentage with - sign', () => {
    expect(formatPercent(-8.3)).toBe('-8.3%')
  })

  it('formats zero with + sign', () => {
    expect(formatPercent(0)).toBe('+0.0%')
  })

  it('formats with one decimal place', () => {
    expect(formatPercent(33.333)).toBe('+33.3%')
  })

  it('handles null', () => {
    expect(formatPercent(null)).toBe('+0.0%')
  })

  it('handles undefined', () => {
    expect(formatPercent(undefined)).toBe('+0.0%')
  })

  it('handles NaN', () => {
    expect(formatPercent(NaN)).toBe('+0.0%')
  })

  it('formats large positive percentage', () => {
    expect(formatPercent(150.7)).toBe('+150.7%')
  })

  it('formats large negative percentage', () => {
    expect(formatPercent(-99.9)).toBe('-99.9%')
  })

  it('rounds correctly', () => {
    expect(formatPercent(12.05)).toBe('+12.1%') // 12.05 -> 12.1 (banker's rounding may vary)
    expect(formatPercent(12.04)).toBe('+12.0%')
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats a date string', () => {
    const result = formatDate('2026-05-20')
    // Should contain "20" (day), "mayo" (month in Spanish), "2026"
    expect(result).toContain('20')
    expect(result).toContain('2026')
    expect(result.toLowerCase()).toContain('mayo')
  })

  it('includes weekday in Spanish', () => {
    // 2026-05-20 is a Wednesday (miercoles)
    const result = formatDate('2026-05-20')
    expect(result.toLowerCase()).toMatch(/mi[eé]rcoles/)
  })

  it('formats January date', () => {
    const result = formatDate('2026-01-15')
    expect(result.toLowerCase()).toContain('enero')
    expect(result).toContain('15')
  })

  it('formats December date', () => {
    const result = formatDate('2026-12-25')
    expect(result.toLowerCase()).toContain('diciembre')
    expect(result).toContain('25')
  })

  it('formats first day of month', () => {
    const result = formatDate('2026-03-01')
    expect(result).toContain('1')
    expect(result.toLowerCase()).toContain('marzo')
  })
})

// ─── formatShortDate ──────────────────────────────────────────────────────

describe('formatShortDate', () => {
  it('formats a date string as short', () => {
    const result = formatShortDate('2026-05-20')
    // Short format: day + abbreviated month
    expect(result).toContain('20')
  })

  it('formats January short', () => {
    const result = formatShortDate('2026-01-05')
    expect(result).toContain('5')
  })

  it('does not include year', () => {
    const result = formatShortDate('2026-05-20')
    expect(result).not.toContain('2026')
  })
})

// ─── percentChange ────────────────────────────────────────────────────────

describe('percentChange', () => {
  it('calculates positive change', () => {
    // 110 vs 100 = +10%
    expect(percentChange(110, 100)).toBeCloseTo(10)
  })

  it('calculates negative change', () => {
    // 90 vs 100 = -10%
    expect(percentChange(90, 100)).toBeCloseTo(-10)
  })

  it('calculates no change', () => {
    expect(percentChange(100, 100)).toBeCloseTo(0)
  })

  it('returns 0 when previous is zero (division by zero)', () => {
    expect(percentChange(100, 0)).toBe(0)
  })

  it('returns 0 when current is null', () => {
    expect(percentChange(null, 100)).toBe(0)
  })

  it('returns 0 when previous is null', () => {
    expect(percentChange(100, null)).toBe(0)
  })

  it('returns 0 when both are null', () => {
    expect(percentChange(null, null)).toBe(0)
  })

  it('returns 0 when current is undefined', () => {
    expect(percentChange(undefined, 100)).toBe(0)
  })

  it('returns 0 when previous is undefined', () => {
    expect(percentChange(100, undefined)).toBe(0)
  })

  it('returns 0 when current is 0 (falsy)', () => {
    // The function uses !current which is truthy for 0
    expect(percentChange(0, 100)).toBe(0)
  })

  it('calculates large increase', () => {
    // 200 vs 50 = +300%
    expect(percentChange(200, 50)).toBeCloseTo(300)
  })

  it('calculates large decrease', () => {
    // 10 vs 100 = -90%
    expect(percentChange(10, 100)).toBeCloseTo(-90)
  })

  it('handles same small values', () => {
    expect(percentChange(1, 1)).toBeCloseTo(0)
  })

  it('handles decimal values', () => {
    expect(percentChange(15.5, 10)).toBeCloseTo(55)
  })

  it('handles real AMALAY scenario: weekday vs weekend comparison', () => {
    // Monday: $45,000, Sunday: $85,000 = -47.1%
    const change = percentChange(45000, 85000)
    expect(change).toBeCloseTo(-47.06, 1)
  })
})
