// Contención V-A18 — GET /api/owner/staff y GET /api/platform/staff entregaban el PIN
// en claro de TODO el personal al navegador (owner/staff/route.ts:82 y
// platform/staff/route.ts:23 en 6d6a31fc: `select=id,name,pin,...`). /pos/staff lo usaba
// para comparar unicidad en el cliente (pos/staff/page.tsx:171-179).
//
// Contrato nuevo: ninguna respuesta GET de personal trae `pin` ni `pin_hash`, ni aunque la
// BD los mande (defensa en profundidad: allowlist de columnas al serializar). La unicidad
// la decide el servidor (pinTaken + índice único) y la pantalla muestra su error.
// Fixtures: dos tenants; fetch simulado; ninguna llamada de red.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'

const FILAS: Record<string, Array<Record<string, unknown>>> = {
  'tenant-a': [
    { id: 'tenant-a-1', client_id: 'tenant-a', name: 'Ana', pin: '1111111111', pin_hash: 'h-a1', role: 'mesero', role_display: 'mesero', active: true, hourly_rate: 50, weekly_salary: 0 },
    { id: 'tenant-a-2', client_id: 'tenant-a', name: 'Beto', pin: '2222222222', pin_hash: 'h-a2', role: 'gerente', role_display: 'gerente', active: true, hourly_rate: 0, weekly_salary: 4000 },
  ],
  'tenant-b': [
    { id: 'tenant-b-1', client_id: 'tenant-b', name: 'Caro', pin: '3333333333', pin_hash: 'h-b1', role: 'cajero', role_display: 'cajero', active: false, hourly_rate: 60, weekly_salary: 0 },
  ],
}

let urls: string[] = []
function stubPosStaff(opts: { conflictoPin?: string } = {}) {
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/rest/v1/pos_staff_audit')) return new Response(null, { status: 201 })
    if (u.includes('pos_staff')) {
      const cid = decodeURIComponent(/client_id=eq\.([^&]+)/.exec(u)?.[1] ?? '')
      if (init?.method === 'POST' || init?.method === 'PATCH') return new Response(null, { status: 204 })
      const pinQ = /pin=eq\.([^&]+)/.exec(u)?.[1]
      const idQ = /[?&]id=eq\.([^&]+)/.exec(u)?.[1]
      let rows = FILAS[cid] ?? []
      if (pinQ) rows = pinQ === opts.conflictoPin ? [{ id: 'otro-id' }] : []
      else if (idQ) rows = rows.filter(r => r.id === decodeURIComponent(idQ))
      // PostgREST "mal portado": devuelve TODAS las columnas aunque el select no las pida.
      return new Response(JSON.stringify(rows), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  }))
}

function sinLlavePin(x: unknown): boolean {
  const json = JSON.stringify(x)
  return !/"pin"\s*:/.test(json) && !/"pin_hash"\s*:/.test(json)
}

async function tokenDe(rol: string, cid: string) {
  const { issueShiftToken } = await import('@/lib/shift-token')
  return issueShiftToken(`${cid}-caller`, cid, rol, `${rol}-fixture`)
}

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  process.env.SUPABASE_SERVICE_KEY = 'service-key-fixture'
  process.env.SHIFT_TOKEN_SECRET = 'x'.repeat(40)
})
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@/lib/platform-auth'); vi.doUnmock('@/lib/platform-writes') })

describe('V-A18 — GET /api/owner/staff no entrega PIN', () => {
  for (const cid of ['tenant-a', 'tenant-b']) {
    for (const rol of ['dueño', 'gerente']) {
      it(`${rol} de ${cid}: respuesta sin 'pin' ni 'pin_hash', y solo su tenant`, async () => {
        stubPosStaff()
        const { GET } = await import('@/app/api/owner/staff/route')
        const res = await GET(new NextRequest('https://app.fixture.test/api/owner/staff', {
          headers: { authorization: `Bearer ${await tokenDe(rol, cid)}` },
        }))
        expect(res.status).toBe(200)
        const j = await res.json()
        expect(sinLlavePin(j)).toBe(true)
        expect(j.staff.map((s: { id: string }) => s.id)).toEqual(FILAS[cid].map(r => r.id))
        // Los campos que la UI sí usa siguen llegando.
        expect(Object.keys(j.staff[0]).sort()).toEqual(['active', 'hourly_rate', 'id', 'name', 'role', 'role_display', 'weekly_salary'])
        // Ni siquiera se pide el PIN a la BD.
        const lectura = urls.find(u => u.includes('pos_staff?client_id='))!
        expect(lectura).not.toMatch(/select=[^&]*\bpin\b/)
      })
    }
  }

  it('mesero → 403 (control existente)', async () => {
    stubPosStaff()
    const { GET } = await import('@/app/api/owner/staff/route')
    const res = await GET(new NextRequest('https://app.fixture.test/api/owner/staff', {
      headers: { authorization: `Bearer ${await tokenDe('mesero', 'tenant-a')}` },
    }))
    expect(res.status).toBe(403)
  })
})

describe('V-A18 — la unicidad del PIN la decide el servidor (control negativo)', () => {
  it('POST con PIN ocupado → 409 "Ese PIN ya está en uso"', async () => {
    stubPosStaff({ conflictoPin: '1111111111' })
    const { POST } = await import('@/app/api/owner/staff/route')
    const res = await POST(new NextRequest('https://app.fixture.test/api/owner/staff', {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenDe('gerente', 'tenant-a')}`, 'content-type': 'application/json', origin: 'https://app.fixture.test', host: 'app.fixture.test' },
      body: JSON.stringify({ name: 'Nuevo', pin: '1111111111', role: 'mesero' }),
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Ese PIN ya está en uso')
  })

  it('POST con PIN libre → 200 (el camino legítimo sigue vivo)', async () => {
    stubPosStaff({ conflictoPin: '1111111111' })
    const { POST } = await import('@/app/api/owner/staff/route')
    const res = await POST(new NextRequest('https://app.fixture.test/api/owner/staff', {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenDe('gerente', 'tenant-a')}`, 'content-type': 'application/json', origin: 'https://app.fixture.test', host: 'app.fixture.test' },
      body: JSON.stringify({ name: 'Nuevo', pin: '4444444444', role: 'mesero' }),
    }))
    expect(res.status).toBe(200)
  })

  it('PATCH con PIN ocupado por otro → 409', async () => {
    stubPosStaff({ conflictoPin: '2222222222' })
    const { PATCH } = await import('@/app/api/owner/staff/route')
    const res = await PATCH(new NextRequest('https://app.fixture.test/api/owner/staff', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${await tokenDe('dueño', 'tenant-a')}`, 'content-type': 'application/json', origin: 'https://app.fixture.test', host: 'app.fixture.test' },
      body: JSON.stringify({ id: 'tenant-a-1', pin: '2222222222' }),
    }))
    expect(res.status).toBe(409)
  })
})

describe('V-A18 — GET /api/platform/staff no entrega PIN', () => {
  async function importarConGate() {
    vi.doMock('@/lib/platform-auth', () => ({
      requirePlatformAdmin2FA: async () => ({ ctx: { userId: 'admin-fixture', email: 'admin@fixture.test' } }),
      platformServiceFetch: (p: string, init?: RequestInit) => fetch(`https://sb.fixture.test/rest/v1/${p}`, init),
    }))
    vi.doMock('@/lib/platform-writes', () => ({ auditLog: async () => true }))
    return import('@/app/api/platform/staff/route')
  }

  for (const cid of ['tenant-a', 'tenant-b']) {
    it(`${cid}: respuesta sin 'pin' ni 'pin_hash'`, async () => {
      stubPosStaff()
      const { GET } = await importarConGate()
      const res = await GET(new NextRequest(`https://app.fixture.test/api/platform/staff?client_id=${cid}`))
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(sinLlavePin(j)).toBe(true)
      expect(j.staff).toHaveLength(FILAS[cid].length)
      expect(Object.keys(j.staff[0]).sort()).toEqual(['active', 'id', 'name', 'role', 'role_display'])
      const lectura = urls.find(u => u.includes('pos_staff?client_id='))!
      expect(lectura).not.toMatch(/select=[^&]*\bpin\b/)
    })
  }

  it('PATCH con PIN duplicado (409 del índice único) → 409 legible, no 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"23505"}', { status: 409 })))
    const { PATCH } = await importarConGate()
    const res = await PATCH(new NextRequest('https://app.fixture.test/api/platform/staff', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'tenant-a', id: 'tenant-a-1', pin: '2222222222' }),
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Ese PIN ya está en uso')
  })
})

describe('V-A18 — las pantallas no comparan ni muestran PINs recibidos', () => {
  const posStaff = readFileSync(new URL('../app/pos/staff/page.tsx', import.meta.url), 'utf8')
  const platformStaff = readFileSync(new URL('../app/platform/staff/page.tsx', import.meta.url), 'utf8')
  const equipo = readFileSync(new URL('../app/equipo/page.tsx', import.meta.url), 'utf8')

  it('/pos/staff no compara PINs en el navegador', () => {
    expect(posStaff).not.toMatch(/\.pin\s*===/)
    expect(posStaff).not.toContain('isPinTaken')
  })

  it('/platform/staff no pinta row.pin y muestra «PIN asignado»', () => {
    expect(platformStaff).not.toMatch(/value=\{row\.pin\}/)
    expect(platformStaff).toContain('PIN asignado')
  })

  it('/equipo no revela s.pin de la lista', () => {
    expect(equipo).not.toMatch(/\bs\.pin\b/)
  })
})
