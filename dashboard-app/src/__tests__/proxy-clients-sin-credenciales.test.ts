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
  // Revisión 9 (P2): nada de esto lo necesita una terminal, y una columna secreta futura tampoco debe salir.
  report_recipients: ['dueno@lab.test'], business_context: 'contexto', telegram_chat_ids: ['1'],
  provisioning_plan: { version: 1 }, provisioning_state: 'complete', support_email: 'soporte@lab.test',
  regimen_fiscal: '601', codigo_postal: '64000', domicilio_fiscal: { calle: 'x' }, staff_supervisors: ['Ana'],
  columna_futura_secreta: 'no-debe-salir', pos_settings: { 'kds.stations': [] }, features: {}, rfc: 'XAXX010101000',
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
    expect(fila).toMatchObject({ id: 'tenant-lab', timezone: 'America/Monterrey', iva_rate: '0.16', mesas: 12 })
    // Lista BLANCA: sólo sale lo que usa el POS (CONFIG_FIELDS del catálogo de la Caja).
    const { COLUMNAS_PERMITIDAS } = await import('@/lib/pos-db-policy')
    for (const k of Object.keys(fila)) expect(COLUMNAS_PERMITIDAS.clients, k).toContain(k)
    for (const k of ['report_recipients', 'business_context', 'telegram_chat_ids', 'provisioning_plan', 'provisioning_state',
      'support_email', 'regimen_fiscal', 'domicilio_fiscal', 'staff_supervisors', 'columna_futura_secreta', 'wansoft_subsidiary_id'])
      expect(fila, k).not.toHaveProperty(k)
  })

  it.each(['select=id,mesas', 'select=pos_settings', 'id=eq.tenant-lab&limit=1', 'select=id,timezone&order=id.asc', 'or=(id.eq.tenant-lab,display_name.eq.Lab)'])(
    'lo que usa el POS sigue pasando: %s', async consulta => {
      expect((await get(consulta)).status).toBe(200)
    })

  it('el proxy reemplaza el id pedido por el tenant autenticado', async () => {
    expect((await get('id=eq.otro-tenant&select=id')).status).toBe(200)
    expect(pedidos).toHaveLength(1)
    const upstream = new URL(pedidos[0])
    expect(upstream.searchParams.get('id')).toBe('eq.tenant-lab')
    expect(upstream.searchParams.has('client_id')).toBe(false)
  })

  it('una respuesta que no es JSON no sale', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`id,wansoft_pass\ntenant-lab,${CLAVE}`, { headers: { 'content-type': 'text/csv' } })))
    const texto = await (await get('select=id')).text()
    expect(texto).not.toContain(CLAVE)
  })

  it.each([
    'select=wansoft_pass',
    'select=id,wansoft_user',
    'select=wansoft_cookies',
    'wansoft_pass=eq.x',
    'or=(wansoft_pass.like.a*,id.eq.x)',
    'order=wansoft_user.asc',
    // Revisión 9 (P2): cualquier columna fuera de la lista blanca, en cualquier parte de la consulta.
    'select=report_recipients', 'select=id,provisioning_plan', 'provisioning_state=eq.complete',
    'or=(provisioning_plan.is.null,id.eq.x)', 'and=(id.eq.x,or(business_context.like.*a*))', 'order=support_email.desc',
    'columna_futura_secreta=eq.x', 'pos_settings->>clave=eq.x&regimen_fiscal=eq.601', 'select=id&%24x=1',
  ])('rechaza nombrar una columna fuera de la lista: %s', async consulta => {
    const r = await get(consulta)
    expect(r.status).toBe(403)
    expect(pedidos).toHaveLength(0)
  })
})

it('la lista blanca de clients es exactamente CONFIG_FIELDS del catálogo de la Caja', async () => {
  const { COLUMNAS_PERMITIDAS } = await import('@/lib/pos-db-policy')
  const { CONFIG_FIELDS } = await import('@/lib/pos-menu-catalog')
  expect([...COLUMNAS_PERMITIDAS.clients].sort()).toEqual([...CONFIG_FIELDS].sort())
})
