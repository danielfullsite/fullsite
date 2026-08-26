// Regresión de seguridad: los PIN de emergencia por variable de entorno deben
// pertenecer a UN restaurante.
//
// Qué estaba roto (hasta 2026-08-26): /api/pos/pin comparaba el PIN recibido
// contra POS_FALLBACK_PIN sin mirar el client_id. Quien conociera ese PIN
// entraba como admin de CUALQUIER restaurante y se llevaba un shift token
// firmado. MANAGER_PINS tenía el mismo agujero, concediendo gerente.
// POS_FALLBACK_PIN llevaba 76 días configurado en producción.
//
// La propiedad que fija este archivo: sin la variable de tenant, el fallback no
// aplica a NADIE (falla cerrado); con ella, aplica sólo a los declarados.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/shift-token', () => ({
  issueShiftToken: vi.fn(async () => 'SHIFT_TOKEN_XYZ'),
}))

const PIN_MAESTRO = '999999'

function stubFetchSinStaff() {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url)
    if (u.includes('/rpc/pos_pin_throttle')) {
      return { ok: true, json: async () => ({ allowed: true }) } as unknown as Response
    }
    if (u.includes('/rest/v1/clients')) {
      return { ok: true, json: async () => [{ pos_settings: {} }] } as unknown as Response
    }
    // pos_staff vacío: obliga al route a caer en la rama del fallback, que es
    // justo la que se está probando.
    return { ok: true, json: async () => [] } as unknown as Response
  })
}

function makeReq(body: Record<string, unknown>) {
  return {
    headers: { get: (_k: string) => null },
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

async function intentar(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/pos/pin/route')
  const res = await POST(makeReq(body))
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  stubFetchSinStaff()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  process.env.POS_FALLBACK_PIN = PIN_MAESTRO
})

afterEach(() => {
  delete process.env.POS_FALLBACK_PIN
  delete process.env.POS_FALLBACK_CLIENT_ID
  delete process.env.MANAGER_PINS
  delete process.env.MANAGER_PINS_CLIENT_ID
})

describe('POS_FALLBACK_PIN acotado a un restaurante', () => {
  it('sin POS_FALLBACK_CLIENT_ID el fallback NO aplica — falla cerrado', async () => {
    const r = await intentar({ pin: PIN_MAESTRO, client_id: 'amalay' })

    expect(r.json.staff).toBeUndefined()
    expect(r.status).toBe(401)
  })

  it('con el tenant declarado, el fallback sigue funcionando para ESE restaurante', async () => {
    process.env.POS_FALLBACK_CLIENT_ID = 'amalay'

    const r = await intentar({ pin: PIN_MAESTRO, client_id: 'amalay' })

    expect(r.json.staff).toEqual({ id: 'admin', name: 'Admin', role: 'admin' })
  })

  it('EL BUG: el mismo PIN no entra en otro restaurante', async () => {
    process.env.POS_FALLBACK_CLIENT_ID = 'amalay'

    const r = await intentar({ pin: PIN_MAESTRO, client_id: 'boruca' })

    expect(r.json.staff).toBeUndefined()
    expect(r.json.shiftToken).toBeUndefined()
    expect(r.status).toBe(401)
  })

  it('acepta varios tenants separados por coma', async () => {
    process.env.POS_FALLBACK_CLIENT_ID = 'amalay, sucursal-2'

    expect((await intentar({ pin: PIN_MAESTRO, client_id: 'sucursal-2' })).json.staff).toBeDefined()
    expect((await intentar({ pin: PIN_MAESTRO, client_id: 'otro' })).json.staff).toBeUndefined()
  })

  it('una variable vacía no habilita a nadie', async () => {
    process.env.POS_FALLBACK_CLIENT_ID = '   '

    expect((await intentar({ pin: PIN_MAESTRO, client_id: 'amalay' })).json.staff).toBeUndefined()
  })
})

describe('MANAGER_PINS acotado a un restaurante', () => {
  beforeEach(() => {
    delete process.env.POS_FALLBACK_PIN
    process.env.MANAGER_PINS = '4321:Eduardo'
  })

  it('sin MANAGER_PINS_CLIENT_ID no concede gerente a nadie', async () => {
    const r = await intentar({ pin: '4321', client_id: 'amalay', manager: true })

    expect(r.json.staff).toBeUndefined()
  })

  it('con el tenant declarado concede gerente sólo ahí', async () => {
    process.env.MANAGER_PINS_CLIENT_ID = 'amalay'

    const propio = await intentar({ pin: '4321', client_id: 'amalay', manager: true })
    expect(propio.json.staff).toEqual({ id: 'manager', name: 'Eduardo', role: 'gerente' })

    const ajeno = await intentar({ pin: '4321', client_id: 'boruca', manager: true })
    expect(ajeno.json.staff).toBeUndefined()
  })
})
