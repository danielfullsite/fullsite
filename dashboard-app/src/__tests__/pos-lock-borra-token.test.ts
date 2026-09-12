import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8')

describe('bloquear o cambiar de identidad elimina la sesión anterior', () => {
  it('centraliza el borrado del shift token', () => {
    expect(source).toMatch(/function clearStoredShiftToken[\s\S]*localStorage\.removeItem\('pos_shift_token'\)/)
  })

  it('lo usa en expiración, inactividad, nuevo PIN y candado manual', () => {
    expect((source.match(/clearStoredShiftToken\(\)/g) || []).length).toBeGreaterThanOrEqual(5)
    const submit = source.slice(source.indexOf('const handleSubmit = async'))
    expect(submit.slice(0, submit.indexOf('const unlock'))).toContain('clearStoredShiftToken()')
    const lock = source.slice(source.indexOf('<POSLockContext.Provider'))
    expect(lock.slice(0, lock.indexOf('</POSLockContext.Provider>'))).toContain('clearStoredShiftToken()')
  })
})
