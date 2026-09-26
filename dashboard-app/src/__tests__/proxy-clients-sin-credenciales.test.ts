// P0 (2026-09-26): las credenciales de Wansoft de `clients` salían por el proxy del POS.
//
// `clients` entró al proxy de query el 2026-09-14 (SCOPED_BY_OWN_ID) y al proxy por ruta el
// 2026-09-26 (40459c5e). Los dos corren con service_role y `client-config.ts` pide la fila con
// `select=*`, así que cualquier shift token —un mesero— recibía `wansoft_user`, `wansoft_pass`
// y `wansoft_cookies` de su restaurante, y el Service Worker lo guardaba en su caché de
// /api/pos/db. Ningún código del POS ni de Electron lee esas columnas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ clientId: 'tenant-lab', role: 'mesero' }))
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => auth, unauthorized: () => new Response(null, { status: 401 }) }))

// Centinelas armados en ejecución: escritos como literales, el escáner de secretos del repo
// los toma por credenciales.
const [USUARIO, CLAVE, COOKIE] = ['usuario', 'clave', 'cookie'].map(s => ['centinela', s, 'wansoft'].join('-'))
const FILA = {
  id: 'tenant-lab', display_name: 'Lab', timezone: 'America/Monterrey', iva_rate: '0.16', mesas: 12,
  wansoft_subsidiary_id: '17', wansoft_user: USUARIO, wansoft_pass: CLAVE, wansoft_cookies: { sesion: COOKIE },
}
let pedidos: string[]
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9999'
  auth.role = 'mesero'; pedidos = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    pedidos.push(String(url))
    return new Response(JSON.stringify([FILA]), { headers: { 'content-type': 'application/json; charset=utf-8' } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

for (const proxy of ['query', 'path'] as const) describe(`clients por el proxy ${proxy}`, () => {
  async function get(consulta: string, headers: Record<string, string> = {}) {
    const url = proxy === 'query'
      ? `http://localhost/api/pos/db?path=${encodeURIComponent(`clients?${consulta}`)}`
      : `http://localhost/api/pos/db/rest/v1/clients?${consulta}`
    const req = new NextRequest(url, { headers })
    if (proxy === 'query') return (await import('@/app/api/pos/db/route')).GET(req)
    return (await import('@/app/api/pos/db/[...path]/route')).GET(req, { params: Promise.resolve({ path: ['rest', 'v1', 'clients'] }) })
  }

  it.each(['mesero', 'cajero', 'gerente', 'admin'])('%s: select=* no trae credenciales de Wansoft y sí la configuración', async rol => {
    auth.role = rol
    const r = await get('id=eq.tenant-lab&limit=1')
    expect(r.status).toBe(200)
    const texto = await r.text()
    for (const x of [USUARIO, CLAVE, COOKIE, 'wansoft_user', 'wansoft_pass', 'wansoft_cookies']) expect(texto, x).not.toContain(x)
    const [fila] = JSON.parse(texto)
    expect(fila).toMatchObject({ id: 'tenant-lab', timezone: 'America/Monterrey', iva_rate: '0.16', mesas: 12, wansoft_subsidiary_id: '17' })
  })

  it.each([
    'select=wansoft_pass',
    'select=id,wansoft_user',
    'select=wansoft_cookies',
    'wansoft_pass=eq.x',
    'or=(wansoft_pass.like.a*,id.eq.x)',
    'order=wansoft_user.asc',
  ])('rechaza nombrar una credencial: %s', async consulta => {
    const r = await get(consulta)
    expect(r.status).toBe(403)
    expect(pedidos).toHaveLength(0)
  })
})
