import { beforeEach, describe, expect, it } from 'vitest'
import {
  issueBiometricRevalidationToken,
  issueShiftToken,
  verifyBiometricRevalidationToken,
  verifyShiftToken,
} from '@/lib/shift-token'

describe('capability de revalidación biométrica', () => {
  beforeEach(() => {
    process.env.SHIFT_TOKEN_SECRET = 'test-secret-with-at-least-thirty-two-characters'
  })

  it('queda ligada a empleado, tenant y terminal y no sirve como shift token', async () => {
    const token = await issueBiometricRevalidationToken('staff-1', 'amalay', 'POS-A')
    await expect(verifyBiometricRevalidationToken(token)).resolves.toMatchObject({
      sub: 'staff-1', cid: 'amalay', did: 'POS-A',
    })
    await expect(verifyShiftToken(token)).resolves.toBeNull()
  })

  it('rechaza replay como otro tipo de token y cualquier alteración', async () => {
    const shift = await issueShiftToken('staff-1', 'amalay', 'gerente', 'Gera')
    await expect(verifyBiometricRevalidationToken(shift)).resolves.toBeNull()

    const biometric = await issueBiometricRevalidationToken('staff-1', 'amalay', 'POS-A')
    const tampered = biometric.slice(0, -1) + (biometric.endsWith('a') ? 'b' : 'a')
    await expect(verifyBiometricRevalidationToken(tampered)).resolves.toBeNull()
  })
})
