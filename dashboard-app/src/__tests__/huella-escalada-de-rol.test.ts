// La huella IGNORABA el rol pedido — escalada de privilegio.
//
// ENCONTRADO el 2026-08-31, al ir a extender la huella al corte de caja (Daniel:
// "para ingresar pin en corte de caja tmb deberia de ser con huella").
//
// La rama de `fingerprint_id` en /api/pos/pin resolvia y devolvia ANTES de que se
// calculara `roleFilter`, asi que `manager: true` y `min_role` no se aplicaban. Y
// como el endpoint NO verifica ninguna firma WebAuthn —confia en el id que le
// mandan— bastaba conocer el UUID de un gerente para obtener un shiftToken de
// gerente sin huella y sin PIN. Esos UUID viven en `pos_staff_cache`, en el
// localStorage de cualquier terminal.
//
// Montar la huella del corte de caja encima de esto habria llevado el bypass justo
// a la autorizacion del dinero, que es el riesgo #1 documentado del negocio.
//
// LO QUE ESTA PRUEBA NO CUBRE: la firma WebAuthn sigue sin verificarse en el
// servidor. Se fija la ESCALADA (una huella solo obtiene el rol de su propio
// empleado), no la suplantacion.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shift-token', () => ({ issueShiftToken: vi.fn(async () => 'TOKEN') }))

let urls: string[] = []

/** Responde por URL. `staff` es lo que devuelve la consulta a pos_staff. */
function stubFetch(staff: unknown[]) {
  urls = []
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/rpc/pos_pin_throttle')) return { ok: true, json: async () => ({ allowed: true }) } as unknown as Response
    if (u.includes('/rest/v1/clients')) return { ok: true, json: async () => [{ pos_settings: {} }] } as unknown as Response
    return { ok: true, json: async () => staff } as unknown as Response
  })
}

const req = (body: Record<string, unknown>) => ({
  headers: { get: () => null },
  json: async () => body,
}) as unknown as import('next/server').NextRequest

const consultaDeStaff = () => urls.find(u => u.includes('/rest/v1/pos_staff')) || ''

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k'
})

describe('La huella no puede pedir mas rol del que tiene el empleado', () => {
  it('REGRESION: con manager:true, la consulta de huella LLEVA filtro de rol', async () => {
    // El corazon del bug: antes esta consulta salia sin `role=in.(...)`, asi que la
    // base devolvia al mesero y el endpoint le emitia token igual.
    stubFetch([{ id: 'u1', name: 'Ana', role: 'gerente' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    await POST(req({ fingerprint_id: 'u1', client_id: 'amalay', manager: true }))

    const q = consultaDeStaff()
    expect(q, 'debe consultarse pos_staff').toContain('id=eq.u1')
    expect(q, 'la consulta de huella debe filtrar por rol').toContain('role=in.')
    expect(q).toContain('gerente')
    expect(q, 'un mesero no puede colarse como gerente').not.toContain('mesero')
  })

  it('min_role tambien se aplica a la huella, no solo al PIN', async () => {
    stubFetch([{ id: 'u2', name: 'Beto', role: 'capitan' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    await POST(req({ fingerprint_id: 'u2', client_id: 'amalay', min_role: 'capitan' }))

    const q = consultaDeStaff()
    expect(q).toContain('role=in.')
    expect(q).toContain('capitan')
    expect(q, 'por debajo de capitan no entra').not.toContain('mesero')
  })

  it('un mesero pidiendo rol de gerente NO recibe token', async () => {
    // Con el filtro puesto, la base no devuelve fila: el endpoint responde 401.
    stubFetch([])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'mesero-1', client_id: 'amalay', manager: true }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.shiftToken).toBeUndefined()
  })

  it('sin rol pedido, la huella sigue funcionando para entrar al POS', async () => {
    // Importante que esto NO se rompa: es el login normal por huella, que si debe
    // aceptar a cualquier empleado activo.
    stubFetch([{ id: 'u3', name: 'Caro', role: 'mesero' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'u3', client_id: 'amalay' }))

    expect(res.status).toBe(200)
    const q = consultaDeStaff()
    expect(q, 'sin min_role no se filtra por rol').not.toContain('role=in.')
  })

  it('la huella sigue exigiendo empleado ACTIVO y del MISMO tenant', async () => {
    stubFetch([{ id: 'u4', name: 'Dani', role: 'gerente' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    await POST(req({ fingerprint_id: 'u4', client_id: 'amalay', manager: true }))

    const q = consultaDeStaff()
    expect(q).toContain('active=eq.true')
    expect(q).toContain('client_id=eq.amalay')
  })
})
