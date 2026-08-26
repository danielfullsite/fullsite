// Regresión de seguridad: los endpoints administrativos de integraciones exigen
// Authorization: Bearer <INTEGRATION_ADMIN_SECRET>.
//
// Qué se encontró (2026-08-26): cuatro rutas desplegadas en producción no tenían
// ningún guard. Sin credenciales se podía:
//   - menu       → reemplazar el menú de un restaurante en Uber Eats, o marcar
//                  sus platillos agotados
//   - store      → pausar la tienda del restaurante en Uber
//   - order      → aceptar, rechazar o cancelar órdenes reales
//
// `reconcile` NO se toca aquí: otra sesión ya lo cerró con requireTenant el mismo
// día. `order` lleva auth DUAL (secreto admin para CI, sesión POS para el cajero)
// porque /pos/delivery lo llama desde el navegador.
//
// Verificado en vivo antes del fix: POST sin cabecera devolvía 400
// ("store_id and menu required"), o sea que la petición YA había pasado el punto
// donde debía existir autenticación.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { checkAdminAuth } from '@/lib/integrations/admin-auth'

vi.mock('@/lib/integrations/uber-eats/menu', () => ({
  uploadMenu: vi.fn(), markItemsOOS: vi.fn(), restoreItems: vi.fn(),
}))
vi.mock('@/lib/integrations/uber-eats/store', () => ({
  pauseStore: vi.fn(), activateStore: vi.fn(), getStoreStatus: vi.fn(),
}))
vi.mock('@/lib/integrations/uber-eats/adapter-factory', () => ({
  getOrderAdapter: vi.fn(),
}))
vi.mock('@/lib/integrations/audit-logger', () => ({ auditLog: vi.fn() }))
vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  withPOSAuth: vi.fn().mockResolvedValue(null),
}))

const SECRET = 'admin-secret-para-pruebas-0123456789abcdef'

function req(url: string, method: string, auth?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth !== undefined) headers['authorization'] = auth
  return new NextRequest(url, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  })
}

beforeEach(() => { process.env.INTEGRATION_ADMIN_SECRET = SECRET })
afterEach(() => { delete process.env.INTEGRATION_ADMIN_SECRET })

describe('checkAdminAuth', () => {
  it('acepta el secreto correcto', () => {
    expect(checkAdminAuth(req('https://x/y', 'POST', `Bearer ${SECRET}`)).ok).toBe(true)
  })

  it('rechaza sin cabecera', () => {
    expect(checkAdminAuth(req('https://x/y', 'POST')).ok).toBe(false)
  })

  it('rechaza un secreto incorrecto de la misma longitud', () => {
    const wrong = 'X'.repeat(SECRET.length)
    expect(checkAdminAuth(req('https://x/y', 'POST', `Bearer ${wrong}`)).ok).toBe(false)
  })

  it('falla CERRADO si INTEGRATION_ADMIN_SECRET no está configurado', () => {
    delete process.env.INTEGRATION_ADMIN_SECRET
    const r = checkAdminAuth(req('https://x/y', 'POST', `Bearer ${SECRET}`))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_secret_configured')
  })

  it('acepta el secreto sin el prefijo Bearer', () => {
    expect(checkAdminAuth(req('https://x/y', 'POST', SECRET)).ok).toBe(true)
  })
})

describe('rutas administrativas: 401 sin credenciales', () => {
  it('POST /menu → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/menu/route')
    const res = await POST(req('https://app.fullsite.mx/api/integrations/uber-eats/menu', 'POST', undefined, { store_id: 's', menu: {} }))
    expect(res.status).toBe(401)
  })

  it('PATCH /menu → 401', async () => {
    const { PATCH } = await import('@/app/api/integrations/uber-eats/menu/route')
    const res = await PATCH(req('https://app.fullsite.mx/api/integrations/uber-eats/menu', 'PATCH', undefined, { store_id: 's', action: 'oos', items: [{ id: 'a' }] }))
    expect(res.status).toBe(401)
  })

  it('GET /store → 401', async () => {
    const { GET } = await import('@/app/api/integrations/uber-eats/store/route')
    const res = await GET(req('https://app.fullsite.mx/api/integrations/uber-eats/store?store_id=s', 'GET'))
    expect(res.status).toBe(401)
  })

  it('POST /store → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/store/route')
    const res = await POST(req('https://app.fullsite.mx/api/integrations/uber-eats/store', 'POST', undefined, { store_id: 's', action: 'pause' }))
    expect(res.status).toBe(401)
  })

  it('POST /order → 401', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/order/route')
    const res = await POST(req('https://app.fullsite.mx/api/integrations/uber-eats/order', 'POST', undefined, { order_id: 'o', action: 'cancel' }))
    expect(res.status).toBe(401)
  })

  it('el 401 no revela por qué falló', async () => {
    const { POST } = await import('@/app/api/integrations/uber-eats/menu/route')
    const res = await POST(req('https://app.fullsite.mx/api/integrations/uber-eats/menu', 'POST', 'Bearer equivocado'))
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})
