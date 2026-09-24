// P0 pos_staff (2026-09-25) — el proxy del kiosco corre con service_role (se salta RLS y
// los grants que endurece la migración 20260925010000). Antes de hoy un shift token de
// GERENTE podía, por cualquiera de las dos rutas del proxy,
//
//     PATCH pos_staff?id=eq.<admin>   { "pin": "0000", "role": "mesero" }
//
// sin la jerarquía de /api/owner/staff (un gerente no toca admin/gerente) ni su auditoría.
// Y la ruta por segmentos (`db/[...path]`) nunca consultaba SOLO_LECTURA.
//
// Se ejercitan los manejadores HTTP de verdad, con shift token firmado, y se cuenta si
// algo llegó a salir hacia PostgREST. Ninguna llamada sale de la máquina.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

type H = (r: NextRequest, ctx?: { params: Promise<{ path: string[] }> }) => Promise<Response>
let porQuery: Record<'GET' | 'POST' | 'PATCH' | 'DELETE', H>
let porRuta: Record<'GET' | 'POST' | 'PATCH' | 'DELETE', H>
const tokens: Record<string, string> = {}
let salidas: string[] = []

beforeAll(async () => {
  process.env.SHIFT_TOKEN_SECRET = 'secreto-local-de-prueba-de-32-o-mas-caracteres'
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://ejemplo.supabase.co'
  process.env.SUPABASE_SERVICE_KEY ||= 'service-role-de-prueba'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-de-prueba'
  const { issueShiftToken } = await import('@/lib/shift-token')
  for (const rol of ['mesero', 'cajero', 'gerente', 'admin', 'dueño']) {
    tokens[rol] = await issueShiftToken(`staff-${rol}`, 'tenant-a', rol, rol)
  }
  porQuery = (await import('@/app/api/pos/db/route')) as unknown as typeof porQuery
  porRuta = (await import('@/app/api/pos/db/[...path]/route')) as unknown as typeof porRuta
})
afterEach(() => { vi.unstubAllGlobals(); salidas = [] })

function interceptar(filas: unknown[] = []) {
  salidas = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    salidas.push(String(input))
    return new Response(JSON.stringify(filas), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

const q = (metodo: string, rol: string, path: string, cuerpo?: unknown) =>
  new NextRequest(`https://app.fixture.test/api/pos/db?path=${encodeURIComponent(path)}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokens[rol]}`, 'content-type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  })

const r = (metodo: string, rol: string, path: string, cuerpo?: unknown) => {
  const [recurso, qs] = path.split('?')
  const req = new NextRequest(`https://app.fixture.test/api/pos/db/rest/v1/${recurso}${qs ? `?${qs}` : ''}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokens[rol]}`, 'content-type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  })
  return [req, { params: Promise.resolve({ path: ['rest', 'v1', ...recurso.split('/')] }) }] as const
}

const ESCRITURAS: Array<['POST' | 'PATCH' | 'DELETE', string, unknown]> = [
  ['PATCH', 'pos_staff?id=eq.staff-admin', { pin: '0000' }],
  ['PATCH', 'pos_staff?id=eq.staff-admin', { role: 'mesero' }],
  ['PATCH', 'pos_staff?id=eq.staff-gerente', { active: false }],
  ['POST', 'pos_staff', { id: 'nuevo', name: 'X', pin: '9999', role: 'admin' }],
  ['DELETE', 'pos_staff?id=eq.staff-admin', undefined],
]

describe('pos_staff es de SOLO LECTURA en el proxy, para todos los roles', () => {
  for (const rol of ['mesero', 'cajero', 'gerente', 'admin', 'dueño']) {
    for (const [metodo, path, cuerpo] of ESCRITURAS) {
      it(`/api/pos/db?path — ${rol} ${metodo} ${path} → 403 y nada sale`, async () => {
        interceptar()
        const res = await porQuery[metodo](q(metodo, rol, path, cuerpo))
        expect(res.status).toBe(403)
        expect(salidas).toHaveLength(0)
      })
      it(`/api/pos/db/rest/v1/… — ${rol} ${metodo} ${path} → 403 y nada sale`, async () => {
        interceptar()
        const [req, ctx] = r(metodo, rol, path, cuerpo)
        const res = await porRuta[metodo](req, ctx)
        expect(res.status).toBe(403)
        expect(salidas).toHaveLength(0)
      })
    }
  }
})

describe('la LECTURA sigue funcionando y nunca entrega PIN ni hash', () => {
  const FILA = { id: 'staff-admin', name: 'Dora', role: 'admin', pin: '4104', pin_hash: 'h'.repeat(64), pin_hash_v: 1 }

  it('/api/pos/db?path GET select=* → 200, sin pin/pin_hash/pin_hash_v, acotado por tenant', async () => {
    interceptar([FILA])
    const res = await porQuery.GET(q('GET', 'mesero', 'pos_staff?select=*'))
    expect(res.status).toBe(200)
    const txt = await res.text()
    expect(txt).toContain('Dora')
    expect(txt).not.toMatch(/"pin"|"pin_hash"|"pin_hash_v"/)
    expect(salidas[0]).toContain('client_id=eq.tenant-a')
  })

  it('/api/pos/db/rest/v1 GET select=* → igual', async () => {
    interceptar([FILA])
    const [req, ctx] = r('GET', 'gerente', 'pos_staff?select=*')
    const res = await porRuta.GET(req, ctx)
    expect(res.status).toBe(200)
    expect(await res.text()).not.toMatch(/"pin"|"pin_hash"|"pin_hash_v"/)
  })

  for (const consulta of ['pos_staff?select=pin_hash', 'pos_staff?pin_hash=eq.abc&select=id', 'pos_staff?select=id,pin_hash_v']) {
    it(`pedir o filtrar por el hash (${consulta}) → 403: no hay oráculo`, async () => {
      interceptar([FILA])
      const res = await porQuery.GET(q('GET', 'gerente', consulta))
      expect(res.status).toBe(403)
      expect(salidas).toHaveLength(0)
    })
  }
})

describe('la política, como contrato', () => {
  it('puedeEscribirEn(pos_staff) es false para todo rol — y SOLO_LECTURA vive dentro de ella', async () => {
    const { puedeEscribirEn, SOLO_LECTURA } = await import('@/lib/pos-db-policy')
    expect(SOLO_LECTURA.has('pos_staff')).toBe(true)
    for (const rol of ['mesero', 'cajero', 'capitan', 'gerente', 'admin', 'dueño', null, undefined]) {
      expect(puedeEscribirEn('pos_staff', rol)).toBe(false)
      expect(puedeEscribirEn('clients', rol)).toBe(false)
    }
    // Lo que no cambió: gerente sigue escribiendo el menú; cajero, la caja.
    expect(puedeEscribirEn('pos_menu_items', 'gerente')).toBe(true)
    expect(puedeEscribirEn('pos_cierres', 'cajero')).toBe(true)
    expect(puedeEscribirEn('pos_orders', 'mesero')).toBe(true)
  })
})
