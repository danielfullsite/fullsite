// Regresión de seguridad — 2026-08-29.
//
// Estas cuatro rutas estuvieron EN PRODUCCIÓN SIN NINGUNA AUTENTICACIÓN de la
// petición entrante. Cualquiera que supiera la URL podía, sobre `app.fullsite.mx`:
//   · POST /store   {"action":"pause"}  → cerrar la tienda de Uber Eats del cliente
//   · POST /menu                        → reemplazarle el menú completo
//   · PATCH /menu   {"action":"oos"}    → marcarle platillos agotados
//   · POST /order   {"action":"deny"}   → rechazar o cancelar órdenes REALES
//   · POST /reconcile                   → disparar el job de reconciliación
//
// El guard vive ahora en `@/lib/integrations/admin-auth`. Estas pruebas existen
// para que, si alguien lo quita o agrega una ruta nueva sin él, CI lo detenga.
//
// Nota de método: el agujero se había reportado como "2 de 7 rutas" a partir de un
// grep de la palabra `authorization`, que también matcheaba los headers SALIENTES
// hacia Supabase. Al revisar cuáles leían de verdad `request.headers.get(...)`
// resultaron ser cuatro. Por eso estas pruebas afirman contra el comportamiento,
// no contra la presencia de un string en el archivo.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/integrations/uber-eats/oauth', () => ({ uberFetch: vi.fn() }))
vi.mock('@/lib/integrations/audit-logger', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/integrations/uber-eats/store', () => ({
  pauseStore: vi.fn(), activateStore: vi.fn(), getStoreStatus: vi.fn(),
}))
vi.mock('@/lib/integrations/uber-eats/menu', () => ({
  uploadMenu: vi.fn(), markItemsOOS: vi.fn(), restoreItems: vi.fn(),
}))
vi.mock('@/lib/integrations/uber-eats/adapter', () => ({ getOrderDetails: vi.fn() }))
vi.mock('@/lib/integrations/uber-eats/adapter-factory', () => ({ getOrderAdapter: vi.fn() }))

import { GET as storeGET, POST as storePOST } from '@/app/api/integrations/uber-eats/store/route'
import { POST as menuPOST, PATCH as menuPATCH } from '@/app/api/integrations/uber-eats/menu/route'
import { POST as orderPOST } from '@/app/api/integrations/uber-eats/order/route'
import { POST as reconcilePOST } from '@/app/api/integrations/uber-eats/reconcile/route'
import { pauseStore, getStoreStatus } from '@/lib/integrations/uber-eats/store'
import { uploadMenu } from '@/lib/integrations/uber-eats/menu'

const SECRET = 'test-integration-admin-secret-xyz789abcdef1234567890'

function req(path: string, body?: unknown, authHeader?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new NextRequest(`https://app.fullsite.mx/api/integrations/uber-eats/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTEGRATION_ADMIN_SECRET = SECRET
  process.env.SUPABASE_SERVICE_KEY = 'test-service-role-key'
})

// Cada caso: [nombre, handler, path, body]. `undefined` como body ⇒ GET.
const GUARDED: Array<[string, (r: NextRequest) => Promise<Response>, string, unknown]> = [
  ['GET  /store',     storeGET,      'store?store_id=abc', undefined],
  ['POST /store',     storePOST,     'store',              { store_id: 'abc', action: 'pause' }],
  ['POST /menu',      menuPOST,      'menu',               { store_id: 'abc', menu: {} }],
  ['PATCH /menu',     menuPATCH,     'menu',               { store_id: 'abc', action: 'oos', items: [] }],
  ['POST /order',     orderPOST,     'order',              { order_id: 'x', action: 'deny' }],
  ['POST /reconcile', reconcilePOST, 'reconcile',          { client_id: 'amalay' }],
]

describe('rutas de integración Uber — guard de administración', () => {
  for (const [name, handler, path, body] of GUARDED) {
    describe(name, () => {
      it('401 sin header Authorization', async () => {
        const res = await handler(req(path, body))
        expect(res.status).toBe(401)
        expect((await res.json()).error).toBe('unauthorized')
      })

      it('401 con token equivocado', async () => {
        const res = await handler(req(path, body, `Bearer ${'x'.repeat(SECRET.length)}`))
        expect(res.status).toBe(401)
      })

      it('401 sin el esquema Bearer', async () => {
        const res = await handler(req(path, body, SECRET))
        expect(res.status).toBe(401)
      })

      it('401 si mandan el service key de Supabase en lugar del secreto', async () => {
        const res = await handler(req(path, body, 'Bearer test-service-role-key'))
        expect(res.status).toBe(401)
      })

      it('503 cuando el servidor no tiene INTEGRATION_ADMIN_SECRET configurado', async () => {
        delete process.env.INTEGRATION_ADMIN_SECRET
        const res = await handler(req(path, body, `Bearer ${SECRET}`))
        expect(res.status).toBe(503)
        expect((await res.json()).error).toBe('not_configured')
      })

      it('NO ejecuta el efecto lateral cuando la auth falla', async () => {
        await handler(req(path, body))
        expect(pauseStore).not.toHaveBeenCalled()
        expect(getStoreStatus).not.toHaveBeenCalled()
        expect(uploadMenu).not.toHaveBeenCalled()
      })
    })
  }

  it('deja pasar con el Bearer correcto (no devuelve 401 ni 503)', async () => {
    vi.mocked(getStoreStatus).mockResolvedValue({ ok: true } as never)
    const res = await storeGET(req('store?store_id=abc', undefined, `Bearer ${SECRET}`))
    expect([401, 503]).not.toContain(res.status)
  })
})
