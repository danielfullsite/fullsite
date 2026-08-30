import { describe, expect, it } from 'vitest'
import { deterministicPin10 } from '@/lib/provision-tenant'

describe('deterministicPin10 — PINs de plantilla de 10 dígitos', () => {
  it('siempre 10 dígitos numéricos y nunca empieza en 0', () => {
    for (const seed of ['carls:dueño', 'carls:mesero', 'amalay:gerente', 'x:y']) {
      const pin = deterministicPin10(seed)
      expect(pin).toMatch(/^[1-9][0-9]{9}$/)
    }
  })

  it('determinístico: misma semilla, mismo PIN (idempotencia del provision)', () => {
    expect(deterministicPin10('carls:dueño')).toBe(deterministicPin10('carls:dueño'))
  })

  it('distinto por rol y por tenant (sin colisiones en el set típico)', () => {
    const roles = ['dueño', 'gerente', 'capitan', 'cajero', 'mesero', 'staff']
    const pins = new Set<string>()
    for (const t of ['carls', 'amalay', 'lacostaverde']) {
      for (const r of roles) pins.add(deterministicPin10(`${t}:${r}`))
    }
    expect(pins.size).toBe(18)
  })
})
