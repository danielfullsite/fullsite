import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/shift-token', () => ({
  verifyShiftToken: vi.fn(async (token: string) => token === 'GERENTE_OK'
    ? { cid: 'amalay', rol: 'gerente' }
    : token === 'OTRO_TENANT' ? { cid: 'otro', rol: 'gerente' }
      : token === 'MESERO' ? { cid: 'amalay', rol: 'mesero' } : null),
}))

import { apruebaSospechosa, verifyManagerApproval } from '@/lib/manager-approval'

const CLIENTE = 'amalay'

describe('offline_approved no es una autorización', () => {
  it.each(['mesero', 'cajero', 'capitan', undefined])('bloquea al rol %s aunque mande true', async rol => {
    await expect(verifyManagerApproval({
      offlineApproved: true,
      clientId: CLIENTE,
      solicitanteRol: rol,
    })).resolves.toMatchObject({ ok: false, mode: 'blocked' })
  })

  it.each(['gerente', 'admin'])('la propia sesión firmada %s sí alcanza', async rol => {
    const result = await verifyManagerApproval({
      offlineApproved: true,
      clientId: CLIENTE,
      solicitanteRol: rol,
    })
    expect(result).toMatchObject({ ok: true, mode: `session_role:${rol}` })
    expect(apruebaSospechosa(result)).toBe(false)
  })

  it('un token separado de gerente autoriza a una terminal de mesero', async () => {
    const result = await verifyManagerApproval({
      approvalToken: 'GERENTE_OK',
      clientId: CLIENTE,
      solicitanteRol: 'mesero',
    })
    expect(result).toMatchObject({ ok: true, mode: 'online:gerente' })
    expect(apruebaSospechosa(result)).toBe(false)
  })

  it.each(['OTRO_TENANT', 'MESERO', 'INVALIDO'])('rechaza un token inválido o insuficiente: %s', async token => {
    await expect(verifyManagerApproval({
      approvalToken: token,
      clientId: CLIENTE,
      solicitanteRol: 'mesero',
    })).resolves.toMatchObject({ ok: false, mode: 'blocked' })
  })

  it('una variable de entorno ausente o falsa nunca abre un grace mode', async () => {
    for (const value of [undefined, '', 'false', 'true']) {
      if (value === undefined) vi.unstubAllEnvs()
      else vi.stubEnv('POS_APPROVAL_STRICT', value)
      await expect(verifyManagerApproval({ clientId: CLIENTE, solicitanteRol: 'mesero' }))
        .resolves.toMatchObject({ ok: false, mode: 'blocked' })
    }
    vi.unstubAllEnvs()
  })
})

describe('la bitácora no la dicta el cliente', () => {
  const lee = (route: string) =>
    readFileSync(join(__dirname, '..', 'app', 'api', 'pos', route, 'route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('reopen-order y cancel-item toman actor y rol del token de sesión', () => {
    for (const route of ['reopen-order', 'cancel-item']) {
      const source = lee(route)
      expect(source, route).toMatch(/actor: auth\.staffName/)
      expect(source, route).toMatch(/solicitante_rol: auth\.role/)
      expect(source, route).toMatch(/manager_declarado/)
    }
  })

  it('ninguna ruta usa offline_approved para conceder acceso', () => {
    for (const route of ['reopen-order', 'cancel-item']) {
      const source = lee(route)
      expect(source, route).not.toContain('offline_approved')
      expect(source, route).not.toContain('legacy_no_approval')
      expect(source, route).not.toContain('offline_device_trust')
    }
  })
})
