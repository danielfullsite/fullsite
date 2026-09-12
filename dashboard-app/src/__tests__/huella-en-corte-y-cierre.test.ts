import { describe, expect, it } from 'vitest'
import {
  hayHuellasDadasDeAlta,
  MANAGER_BIOMETRIC_APPROVAL_ENABLED,
  verifyManagerHuella,
} from '@/lib/pos-data'

describe('la huella no aprueba operaciones de dinero sin prueba de servidor', () => {
  it('falla cerrada y deja disponible el PIN', async () => {
    await expect(verifyManagerHuella('gerente')).resolves.toBeNull()
  })

  it('no anuncia huellas de gerente en Corte o Cierre', async () => {
    expect(MANAGER_BIOMETRIC_APPROVAL_ENABLED).toBe(false)
    await expect(hayHuellasDadasDeAlta()).resolves.toBe(false)
  })
})
