import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: mocks.auth, unauthorized: () => Response.json({}, { status: 401 }) }))
vi.mock('@/lib/api-guard', () => ({ sameOriginOnly: () => null }))
vi.mock('@/lib/shift-token', () => ({ issueShiftToken: mocks.token }))
vi.mock('@/lib/pin-throttle', () => ({ pinGate: async () => ({ allowed: true }), pinRecord: mocks.record }))
import { POST as login } from '@/app/api/pos/pin/route'
import { PATCH as rotate } from '@/app/api/owner/staff/route'
import { deterministicPin10 } from '@/lib/provision-tenant'

type Staff = { id: string; client_id: string; name: string; role: string; pin: string; active: boolean }
let staff: Staff, writes: Record<string, unknown>[]
const tenant = 'synthetic-tenant'
function request(handler: (request: NextRequest) => Promise<Response>, body: Record<string, unknown>) {
  return handler(new NextRequest('http://fixture.invalid/api/fixture', { method: handler === rotate ? 'PATCH' : 'POST', body: JSON.stringify(body) }))
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'synthetic-service-only')
  vi.stubEnv('POS_FALLBACK_CLIENT_ID', '')
  vi.stubEnv('MANAGER_PINS_CLIENT_ID', '')
  const pin = deterministicPin10(`${tenant}:gerente`)
  staff = { id: `${tenant}-${pin}`, client_id: tenant, name: 'Gerente (plantilla)', role: 'gerente', pin, active: true }
  writes = []
  mocks.auth.mockResolvedValue({ clientId: tenant, role: 'dueño', staffName: 'Owner', authType: 'supabase_session' })
  mocks.token.mockResolvedValue('synthetic-shift-token')
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input).replace(/^undefined/, 'http://fixture.invalid'))
    if (url.pathname.endsWith('/clients')) return Response.json([{ pos_settings: {} }])
    if (url.pathname.endsWith('/pos_staff_audit')) return new Response(null, { status: 204 })
    expect(url.pathname.endsWith('/pos_staff')).toBe(true)
    let matches = url.searchParams.get('client_id') === `eq.${staff.client_id}`
    for (const key of ['id', 'pin'] as const) if (url.searchParams.has(key)) matches &&= url.searchParams.get(key) === `eq.${staff[key]}`
    if (url.searchParams.has('active')) matches &&= staff.active
    if (init?.method === 'PATCH') {
      expect(matches).toBe(true)
      const changes = JSON.parse(String(init.body)); writes.push(changes); Object.assign(staff, changes)
      return new Response(null, { status: 204 })
    }
    return Response.json(matches ? [{ ...staff }] : [])
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('plantilla legacy requiere rotación con recuperación por Equipo', () => {
  it('PIN predecible no emite token y comunica una ruta de recuperación sin devolver el PIN', async () => {
    const response = await request(login, { client_id: tenant, pin: staff.pin })
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'pin_rotation_required', recovery_path: '/equipo' })
    expect(JSON.stringify(body)).not.toContain(staff.pin)
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.record).toHaveBeenCalledWith(`${tenant}:unknown`, false)
  })
  it('renombrar plantilla o usar su ID en huella no evita el bloqueo', async () => {
    staff.name = 'Renamed employee'
    expect((await request(login, { client_id: tenant, pin: staff.pin })).status).toBe(401)
    const response = await request(login, { client_id: tenant, fingerprint_id: staff.id })
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('pin_rotation_required')
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('dueño asigna PIN propio por Equipo y el mismo empleado vuelve a ingresar', async () => {
    const oldPin = staff.pin
    expect((await request(rotate, { id: staff.id, name: 'Assigned manager', pin: '5827', active: true })).status).toBe(200)
    expect(writes).toEqual([{ name: 'Assigned manager', pin: '5827', active: true }])
    expect((await request(login, { client_id: tenant, pin: oldPin })).status).toBe(401)
    const response = await request(login, { client_id: tenant, pin: '5827' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ staff: { id: staff.id, name: 'Assigned manager', role: 'gerente' }, shiftToken: 'synthetic-shift-token' })
  })
  it('gerente no puede reemplazar credencial de dueño ni admin', async () => {
    mocks.auth.mockResolvedValue({ clientId: tenant, role: 'gerente' })
    for (const role of ['dueño', 'admin', 'gerente']) {
      staff.role = role
      expect((await request(rotate, { id: staff.id, pin: '5827' })).status).toBe(403)
    }
    expect(writes).toHaveLength(0)
  })
  it('empleado existente con PIN corto conserva acceso y no cruza restaurante', async () => {
    staff = { ...staff, id: 'ordinary-employee', name: 'Employee', role: 'mesero', pin: '5827' }
    expect((await request(login, { client_id: tenant, pin: '5827' })).status).toBe(200)
    expect((await request(login, { client_id: 'other-tenant', pin: '5827' })).status).toBe(401)
  })
})
