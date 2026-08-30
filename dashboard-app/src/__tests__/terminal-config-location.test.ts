// El generador de TerminalConfig exige sucursal y estampa location_id, sin romper la
// compatibilidad con el schema del Electron. Y la validación de metadata rechaza secretos.
//
// Autocontenido: no toca red ni base. La compat con el Electron se comprueba afirmando que
// el config trae TODOS los campos de su required[] (calcado de config-schema.js) más
// location_id como campo adicional — que validate() acepta por ser extra.
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { generateTerminalConfig } from '../lib/terminal-config'
import {
  validateMetadata, MetadataInvalida,
  generateDeviceId, generateEnrollmentCode, hashEnrollmentCode,
} from '../lib/terminal-enrollment'

// Espejo de electron-app/local-server/config-schema.js → required[]. Si cambia allá, aquí.
const ELECTRON_REQUIRED = [
  'config_version', 'restaurant_id', 'terminal_id', 'terminal_role',
  'terminal_name', 'local_server_host', 'local_server_port',
  'protocol_version', 'provisioned_at',
]

describe('generateTerminalConfig — sucursal obligatoria', () => {
  it('lanza si falta locationId', () => {
    // @ts-expect-error — probamos el contrato en runtime, sin locationId
    expect(() => generateTerminalConfig({ clientId: 'diezmex-demo', role: 'server_pos' }))
      .toThrow(/locationId/)
  })

  it('lanza si falta clientId', () => {
    // @ts-expect-error — sin clientId
    expect(() => generateTerminalConfig({ locationId: 'diezmex-rosta', role: 'server_pos' }))
      .toThrow(/clientId/)
  })

  it('estampa location_id en el config', () => {
    const c = generateTerminalConfig({ clientId: 'diezmex-demo', locationId: 'diezmex-rosta', role: 'server_pos' })
    expect(c.location_id).toBe('diezmex-rosta')
    expect(c.client_id).toBe('diezmex-demo')
  })

  it('sigue trayendo todos los campos que el Electron exige (compat sin instalador nuevo)', () => {
    const c = generateTerminalConfig({ clientId: 'diezmex-demo', locationId: 'diezmex-rosta', role: 'pos', bridgeHost: '192.168.1.10' }) as unknown as Record<string, unknown>
    for (const f of ELECTRON_REQUIRED) {
      expect(c[f], `falta el campo requerido por el Electron: ${f}`).toBeTruthy()
    }
    // location_id viaja como campo ADICIONAL — no está en required[], no rompe validate().
    expect(ELECTRON_REQUIRED).not.toContain('location_id')
    expect(c.location_id).toBe('diezmex-rosta')
  })
})

describe('validateMetadata — sin secretos, whitelist, escalares, tope', () => {
  it('acepta objeto vacío', () => {
    expect(validateMetadata(undefined)).toEqual({})
    expect(validateMetadata({})).toEqual({})
  })

  it('acepta llaves de la whitelist con valores escalares', () => {
    const ok = { model: 'iPad', os: 'iPadOS 17', ip_lan: '192.168.1.20' }
    expect(validateMetadata(ok)).toEqual(ok)
  })

  it.each([
    ['token', { token: 'abc' }],
    ['password', { password: 'x' }],
    ['service_role', { service_role: 'eyJ...' }],
    ['api_key', { api_key: 'k' }],
    ['authorization', { authorization: 'Bearer x' }],
  ])('rechaza llave secreta: %s', (_n, m) => {
    expect(() => validateMetadata(m)).toThrow(MetadataInvalida)
  })

  it('rechaza llave fuera de la whitelist', () => {
    expect(() => validateMetadata({ cualquier_otra: 'x' })).toThrow(MetadataInvalida)
  })

  it('rechaza valores no escalares (objeto/array anidado)', () => {
    expect(() => validateMetadata({ model: { secreto: 'oculto' } })).toThrow(MetadataInvalida)
    expect(() => validateMetadata({ notes: ['a', 'b'] })).toThrow(MetadataInvalida)
  })

  it('rechaza no-objeto', () => {
    expect(() => validateMetadata('soy un string')).toThrow(MetadataInvalida)
    expect(() => validateMetadata([1, 2, 3])).toThrow(MetadataInvalida)
  })

  it('rechaza metadata que excede 4KB', () => {
    expect(() => validateMetadata({ notes: 'x'.repeat(5000) })).toThrow(/4KB/)
  })
})

describe('identidad y código generados por el servidor', () => {
  it('generateDeviceId produce ids únicos con el formato esperado', () => {
    const a = generateDeviceId()
    const b = generateDeviceId()
    expect(a).toMatch(/^dev-[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
    // Cumple el DEVICE_RE del sistema (^[\w-]{1,64}$).
    expect(a).toMatch(/^[\w-]{1,64}$/)
  })

  it('generateEnrollmentCode tiene alta entropía y no se repite', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateEnrollmentCode()))
    expect(codes.size).toBe(200)
    for (const c of codes) expect(c.length).toBeGreaterThanOrEqual(16)
  })

  it('hashEnrollmentCode es sha256 determinista y no reversible al código', () => {
    const code = generateEnrollmentCode()
    expect(hashEnrollmentCode(code)).toBe(createHash('sha256').update(code).digest('hex'))
    expect(hashEnrollmentCode(code)).toBe(hashEnrollmentCode(code))
    expect(hashEnrollmentCode(code)).not.toBe(code)
    expect(hashEnrollmentCode(code)).toHaveLength(64)
  })
})
