import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('identidad del turno de personal', () => {
  const source = readFileSync(join(__dirname, '..', 'components', 'pos', 'StaffShiftPanel.tsx'), 'utf8')

  it('persiste el UUID verificado del empleado y nunca el PIN crudo', () => {
    expect(source).toContain('verifyStaffPin(valor)')
    expect(source).toContain('staff_id: member.id')
    expect(source).toContain('<AutorizacionPinOHuella')
    expect(source).toContain('onHuella={identificarConHuella}')
    expect(source).not.toMatch(/staff_id:\s*pin\b/)
    expect(source).not.toContain('verifyManagerPin(pin)')
    expect(source).not.toContain('setSelectedStaff(shift.id)')
    expect(source).toContain('handleClockOut(shift.id)')
  })
})
