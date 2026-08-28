// Enrolamiento de terminales por sucursal — validación server-side de las rutas.
//
// Se ejercen los handlers REALES; sólo se moquean las fronteras: el gate de admin y la
// llamada REST a Supabase (platformServiceFetch). terminal-enrollment corre de verdad, así
// que locationBelongsToClient y validateMetadata se prueban a través del handler.
//
// Cubre: location requerida en alta nueva · rechazo cross-tenant (sucursal de otro
// restaurante) · rechazo de metadata con secretos · PATCH no mueve tenant/sucursal ·
// lectura legacy (location_id NULL) sin romper.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { admin: 'test' } })),
  platformServiceFetch: vi.fn(),
}))
vi.mock('@/lib/platform-writes', () => ({ auditLog: vi.fn(async () => {}) }))

import { platformServiceFetch } from '@/lib/platform-auth'
import { POST as terminalsPOST, PATCH as terminalsPATCH, GET as terminalsGET } from '@/app/api/platform/terminals/route'
import { POST as configPOST } from '@/app/api/platform/terminal-config/route'

const mockFetch = platformServiceFetch as unknown as Mock

// Sucursales válidas por tenant en el escenario de prueba.
//   tenant-a → loc-a1     ·     tenant-b → loc-b1
const VALID = new Set(['tenant-a|loc-a1', 'tenant-b|loc-b1'])

// Capturamos las escrituras a pos_terminals para inspeccionarlas.
let writes: { url: string; method: string; body: unknown }[] = []

beforeEach(() => {
  writes = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE_SENTINEL'
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase()
    // Validación de sucursal ⇒ client_locations?client_id=eq.X&id=eq.Y&...
    if (path.startsWith('client_locations?')) {
      const cid = /client_id=eq\.([^&]+)/.exec(path)?.[1]
      const id = /[?&]id=eq\.([^&]+)/.exec(path)?.[1]
      const hit = cid && id && VALID.has(`${decodeURIComponent(cid)}|${decodeURIComponent(id)}`)
      return { ok: true, json: async () => (hit ? [{ id }] : []) } as unknown as Response
    }
    // Escrituras / lecturas a pos_terminals
    if (path.startsWith('pos_terminals')) {
      if (method !== 'GET') {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        writes.push({ url: path, method, body })
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      // GET legacy: una fila enrolada con location_id NULL debe pasar tal cual
      return { ok: true, json: async () => [
        { device_id: 'd-legacy', label: 'vieja', active: true, location_id: null, role: null, channel: 'stable', status: 'active' },
      ] } as unknown as Response
    }
    return { ok: true, json: async () => [] } as unknown as Response
  })
})

function post(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}
function get(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) }, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}

describe('POST /api/platform/terminals — alta nueva', () => {
  it('rechaza sin location_id (400) y no escribe', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', device_id: 'dev1' }))
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('rechaza sucursal de OTRO tenant (cross-tenant) y no escribe', async () => {
    // loc-b1 es de tenant-b; tenant-a no puede enrolar ahí.
    const res = await terminalsPOST(post({ clientId: 'tenant-a', device_id: 'dev1', location_id: 'loc-b1' }))
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('acepta sucursal propia y estampa location_id en la escritura', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', device_id: 'dev1', location_id: 'loc-a1', label: 'Caja 1' }))
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    const body = writes[0].body as Record<string, unknown>
    expect(body.client_id).toBe('tenant-a')
    expect(body.location_id).toBe('loc-a1')
    expect(body.metadata).toEqual({})
  })

  it('rechaza metadata con un secreto y no escribe', async () => {
    const res = await terminalsPOST(post({
      clientId: 'tenant-a', device_id: 'dev1', location_id: 'loc-a1',
      metadata: { token: 'robado' },
    }))
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})

describe('PATCH /api/platform/terminals — no mueve tenant/sucursal', () => {
  it('rechaza si el body intenta cambiar location_id', async () => {
    const res = await terminalsPATCH(post({ clientId: 'tenant-a', device_id: 'dev1', active: false, location_id: 'loc-b1' }))
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('permite sólo cambiar active', async () => {
    const res = await terminalsPATCH(post({ clientId: 'tenant-a', device_id: 'dev1', active: false }))
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].body).toEqual({ active: false })
  })
})

describe('GET /api/platform/terminals — compat legacy', () => {
  it('devuelve filas con location_id NULL sin romper', async () => {
    const res = await terminalsGET(get('clientId=tenant-a'))
    expect(res.status).toBe(200)
    const j = await res.json() as { terminals: { device_id: string; location_id: string | null }[] }
    expect(j.terminals[0].location_id).toBeNull()
    expect(j.terminals[0].device_id).toBe('d-legacy')
  })
})

describe('POST /api/platform/terminal-config — sucursal obligatoria', () => {
  it('rechaza sin locationId', async () => {
    const res = await configPOST(post({ clientId: 'tenant-a', role: 'server_pos' }))
    expect(res.status).toBe(400)
  })

  it('rechaza sucursal de otro tenant', async () => {
    const res = await configPOST(post({ clientId: 'tenant-a', role: 'server_pos', locationId: 'loc-b1' }))
    expect(res.status).toBe(400)
  })

  it('emite el config con location_id cuando la sucursal es propia', async () => {
    const res = await configPOST(post({ clientId: 'tenant-a', role: 'server_pos', locationId: 'loc-a1' }))
    expect(res.status).toBe(200)
    const j = await res.json() as { config: { location_id: string; client_id: string } }
    expect(j.config.location_id).toBe('loc-a1')
    expect(j.config.client_id).toBe('tenant-a')
  })
})
