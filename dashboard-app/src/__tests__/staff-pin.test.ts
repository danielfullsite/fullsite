import { describe, expect, it } from 'vitest'
import { generateStaffPin } from '@/lib/staff-pin'

describe('staff PIN generator', () => {
  it('always generates exactly 10 numeric digits without a leading zero', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateStaffPin()).toMatch(/^[1-9]\d{9}$/)
    }
  })

  it('does not return a fixed or repeated default', () => {
    const pins = new Set(Array.from({ length: 100 }, generateStaffPin))
    expect(pins.size).toBe(100)
  })
})
