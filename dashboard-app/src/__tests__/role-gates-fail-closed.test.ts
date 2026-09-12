import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPosRole } from '@/lib/api-auth'

afterEach(() => vi.unstubAllEnvs())

describe('los permisos de servidor no tienen grace mode', () => {
  it.each([undefined, '', 'false', 'true'])('un mesero queda bloqueado con env=%s', value => {
    if (value === undefined) vi.unstubAllEnvs()
    else vi.stubEnv('MARKET_ROLE_STRICT', value)
    expect(checkPosRole({ role: 'mesero' }, 4, 'MARKET_ROLE_STRICT')).toEqual({ ok: false, mode: 'blocked' })
  })

  it('un gerente sigue pasando', () => {
    expect(checkPosRole({ role: 'gerente' }, 4, 'MARKET_ROLE_STRICT')).toEqual({ ok: true, mode: 'role:gerente' })
  })
})
