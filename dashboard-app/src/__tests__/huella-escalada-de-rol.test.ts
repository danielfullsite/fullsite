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
// LO QUE ESTA PRUEBA NO CUBRIA: la firma WebAuthn seguia sin verificarse en el
// servidor. Se fijo la ESCALADA (una huella solo obtiene el rol de su propio
// empleado), no la suplantacion.
//
// ACTUALIZADO 2026-09-23 (F-01, auditoria dashboard): la suplantacion se cierra
// quitando la rama. Un `fingerprint_id` ya no emite token con NINGUN rol — ni el
// de gerente pedido ni el propio del empleado — y el servidor ni consulta pos_staff.
// Las pruebas de abajo pasan de "la huella respeta el rol" a "la huella no es
// credencial"; lo que protegian (nadie sube de rol por huella) queda cubierto de
// sobra. El detalle vive en pos-pin-huella-no-es-credencial.test.ts.

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
  it('REGRESION: con manager:true, un fingerprint_id de gerente NO obtiene token ni consulta pos_staff', async () => {
    stubFetch([{ id: 'u1', name: 'Ana', role: 'gerente' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'u1', client_id: 'amalay', manager: true }))

    expect(res.status).toBe(401)
    expect((await res.json()).shiftToken).toBeUndefined()
    expect(consultaDeStaff(), 'el id no se usa para buscar al empleado').toBe('')
  })

  it('min_role con huella tampoco emite token', async () => {
    stubFetch([{ id: 'u2', name: 'Beto', role: 'capitan' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'u2', client_id: 'amalay', min_role: 'capitan' }))

    expect(res.status).toBe(401)
    expect(consultaDeStaff()).toBe('')
  })

  it('un mesero pidiendo rol de gerente NO recibe token', async () => {
    stubFetch([])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'mesero-1', client_id: 'amalay', manager: true }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.shiftToken).toBeUndefined()
  })

  it('CONTRATO NUEVO: sin rol pedido, la huella tampoco entra al POS — hay que usar PIN', async () => {
    // Antes esto devolvia 200 con el rol del propio empleado. Era justo la
    // suplantacion: conocer el UUID bastaba.
    stubFetch([{ id: 'u3', name: 'Caro', role: 'mesero' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'u3', client_id: 'amalay' }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('biometria_no_verificada')
    expect(body.shiftToken).toBeUndefined()
  })

  it('el PIN sigue exigiendo empleado ACTIVO, del MISMO tenant y con el rol pedido', async () => {
    stubFetch([{ id: 'u4', name: 'Dani', role: 'gerente' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    await POST(req({ pin: '2468', client_id: 'amalay', manager: true }))

    const q = consultaDeStaff()
    expect(q).toContain('active=eq.true')
    expect(q).toContain('client_id=eq.amalay')
    expect(q).toContain('role=in.')
    expect(q, 'un mesero no puede colarse como gerente').not.toContain('mesero')
  })
})
