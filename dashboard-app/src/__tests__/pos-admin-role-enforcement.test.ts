import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withPOSAuth } from '@/lib/api-auth'
import { POST as adjustMarket } from '@/app/api/pos/adjust-market/route'
import { POST as recipeSync } from '@/app/api/pos/recipe-sync/route'
vi.mock('@/lib/api-auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api-auth')>(), withPOSAuth: vi.fn() }))
const upstream = vi.fn()
beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'fixture-only')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid')
  vi.stubEnv('MARKET_ROLE_STRICT', 'false')
  upstream.mockReset().mockImplementation(async () => Response.json([]))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const setRole = (role: string) => vi.mocked(withPOSAuth).mockResolvedValue({ clientId: 'tenant', role, staffId: 'staff', staffName: 'Nombre real', authType: 'shift_token' })
describe('administración exige permiso sin grace', () => {
  for (const role of ['mesero', 'cajero', 'capitan', 'cocina']) it(`${role} no cambia stock/recetas aunque declare gerente en body`, async () => {
    setRole(role)
    const body = { menu_item_id: 'item', adjustment_type: 'entrada', quantity: 1, role: 'gerente', actor: 'Admin' }
    for (const handler of [adjustMarket, recipeSync]) {
      const response = await handler(new NextRequest('http://local/api/pos/action', { method: 'POST', body: JSON.stringify(body) }))
      expect(response.status).toBe(403)
    }
    expect(upstream).not.toHaveBeenCalled()
  })
  for (const role of ['gerente', 'admin', 'dueño']) it(`${role} conserva el flujo administrativo`, async () => {
    setRole(role)
    const response = await adjustMarket(new NextRequest('http://local/api/pos/adjust-market', { method: 'POST', body: JSON.stringify({ menu_item_id: 'item', adjustment_type: 'entrada', quantity: 1, actor: 'No confiar' }) }))
    expect(response.status).toBe(200)
    expect(JSON.parse(upstream.mock.calls[0][1].body).p_actor).toBe('Nombre real')
  })
})
