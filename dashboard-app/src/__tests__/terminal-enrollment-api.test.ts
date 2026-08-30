// Enrolamiento de terminales — la PLATAFORMA genera la identidad.
//
// Se ejercen los handlers REALES; sólo se moquean las fronteras: el gate de admin y la
// llamada REST a Supabase (platformServiceFetch). terminal-enrollment corre de verdad.
//
// Cubre: device_id del body RECHAZADO · device_id generado por el servidor · el código se
// guarda SÓLO como hash · canje de un solo uso · expiración/reuso fallan cerrado · rechazo
// cross-tenant/sucursal · la identidad la fija el código (no el body del claim) · ausencia
// de secretos en respuestas y logs · lectura legacy.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { hashEnrollmentCode } from '../lib/terminal-enrollment'

vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { admin: 'test' } })),
  platformServiceFetch: vi.fn(),
}))
vi.mock('@/lib/platform-writes', () => ({ auditLog: vi.fn(async () => {}) }))

import { platformServiceFetch } from '@/lib/platform-auth'
import { POST as terminalsPOST, PATCH as terminalsPATCH, GET as terminalsGET } from '@/app/api/platform/terminals/route'
import { POST as claimPOST } from '@/app/api/platform/terminal-claim/route'

const mockFetch = platformServiceFetch as unknown as Mock

// Sucursales válidas por tenant:  tenant-a → loc-a1 · tenant-b → loc-b1
const VALID_LOC = new Set(['tenant-a|loc-a1', 'tenant-b|loc-b1'])

// Enrolamientos "pendientes" que el claim puede canjear, por hash del código.
let pending: Map<string, { client_id: string; location_id: string; role: string | null; label: string | null; device_id: string }>
let writes: { table: string; method: string; body: Record<string, unknown> }[]

beforeEach(() => {
  writes = []
  pending = new Map()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE_SENTINEL'
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : null

    if (path.startsWith('client_locations?')) {
      const cid = /client_id=eq\.([^&]+)/.exec(path)?.[1]
      const id = /[?&]id=eq\.([^&]+)/.exec(path)?.[1]
      const hit = cid && id && VALID_LOC.has(`${decodeURIComponent(cid)}|${decodeURIComponent(id)}`)
      return { ok: true, json: async () => (hit ? [{ id }] : []) } as unknown as Response
    }

    if (path.startsWith('pos_terminal_enrollments')) {
      if (method === 'POST') {
        writes.push({ table: 'pos_terminal_enrollments', method, body })
        // Simula la fila pendiente para que un claim posterior la pueda canjear.
        pending.set(String(body.code_hash), {
          client_id: body.client_id, location_id: body.location_id,
          role: body.role ?? null, label: body.label ?? null, device_id: body.device_id,
        })
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      if (method === 'PATCH') {
        // Canje atómico: sólo matchea si el hash está pendiente. Un segundo canje ya no.
        const hash = /code_hash=eq\.([^&]+)/.exec(path)?.[1]
        const row = hash ? pending.get(decodeURIComponent(hash)) : undefined
        if (row) { pending.delete(decodeURIComponent(hash!)); return { ok: true, json: async () => [row] } as unknown as Response }
        return { ok: true, json: async () => [] } as unknown as Response
      }
    }

    if (path.startsWith('pos_terminals')) {
      if (method === 'GET') {
        return { ok: true, json: async () => [
          { device_id: 'd-legacy', label: 'vieja', active: true, location_id: null, role: null, channel: 'stable', status: 'active' },
        ] } as unknown as Response
      }
      writes.push({ table: 'pos_terminals', method, body })
      return { ok: true, json: async () => ({}) } as unknown as Response
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
const enrollWrites = () => writes.filter(w => w.table === 'pos_terminal_enrollments')
const terminalWrites = () => writes.filter(w => w.table === 'pos_terminals')

describe('POST /terminals — la plataforma genera la identidad', () => {
  it('RECHAZA device_id aportado por el cliente (400) y no escribe', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-a1', device_id: 'yo-lo-elijo' }))
    expect(res.status).toBe(400)
    expect(enrollWrites()).toHaveLength(0)
  })

  it('genera device_id en el servidor y devuelve un código de un solo uso', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-a1', label: 'Caja 1' }))
    expect(res.status).toBe(200)
    const j = await res.json() as { device_id: string; enrollment_code: string; expires_at: string }
    expect(j.device_id).toMatch(/^dev-[0-9a-f-]{36}$/) // generado por el servidor
    expect(j.enrollment_code.length).toBeGreaterThanOrEqual(16)
    expect(j.expires_at).toBeTruthy()
  })

  it('guarda SÓLO el hash del código, nunca el código en claro', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-a1' }))
    const j = await res.json() as { enrollment_code: string }
    const w = enrollWrites()[0].body
    expect(w.code_hash).toBe(hashEnrollmentCode(j.enrollment_code))
    expect(w.code_hash).not.toBe(j.enrollment_code)
    // El cuerpo persistido no contiene el código en claro bajo ninguna llave.
    expect(JSON.stringify(w)).not.toContain(j.enrollment_code)
  })

  it('rechaza sucursal de otro tenant (cross-tenant)', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-b1' }))
    expect(res.status).toBe(400)
    expect(enrollWrites()).toHaveLength(0)
  })

  it('rechaza metadata con un secreto', async () => {
    const res = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-a1', metadata: { token: 'x' } }))
    expect(res.status).toBe(400)
  })
})

describe('POST /terminal-claim — canje de un solo uso', () => {
  async function nuevoCodigo(clientId = 'tenant-a', location = 'loc-a1') {
    const res = await terminalsPOST(post({ clientId, location_id: location, label: 'Caja 1' }))
    return (await res.json() as { enrollment_code: string; device_id: string })
  }

  it('canjea el código por la identidad asignada y materializa la terminal', async () => {
    const { enrollment_code, device_id } = await nuevoCodigo()
    const res = await claimPOST(post({ code: enrollment_code }))
    expect(res.status).toBe(200)
    const j = await res.json() as { device_id: string; client_id: string; location_id: string }
    expect(j.device_id).toBe(device_id)
    expect(j.client_id).toBe('tenant-a')
    expect(j.location_id).toBe('loc-a1')
    // Se materializó pos_terminals con el device_id del servidor.
    const tw = terminalWrites()
    expect(tw).toHaveLength(1)
    expect(tw[0].body.device_id).toBe(device_id)
    expect(tw[0].body.client_id).toBe('tenant-a')
  })

  it('un segundo canje del mismo código falla cerrado (one-time)', async () => {
    const { enrollment_code } = await nuevoCodigo()
    const r1 = await claimPOST(post({ code: enrollment_code }))
    expect(r1.status).toBe(200)
    const r2 = await claimPOST(post({ code: enrollment_code }))
    expect(r2.status).toBe(400)
  })

  it('la identidad la fija el código, NO el body del claim (no cross-tenant)', async () => {
    const { enrollment_code } = await nuevoCodigo('tenant-a', 'loc-a1')
    // El device intenta colar otro tenant/sucursal en el body: se ignora.
    const res = await claimPOST(post({ code: enrollment_code, clientId: 'tenant-b', location_id: 'loc-b1' }))
    const j = await res.json() as { client_id: string; location_id: string }
    expect(j.client_id).toBe('tenant-a')
    expect(j.location_id).toBe('loc-a1')
  })

  it('código inexistente o vencido falla cerrado con mensaje genérico', async () => {
    const res = await claimPOST(post({ code: 'codigo-que-no-existe-pero-largo-000' }))
    expect(res.status).toBe(400)
    const j = await res.json() as { error: string }
    expect(j.error).toBe('código inválido o vencido')
  })

  it('rechaza un código demasiado corto sin siquiera consultar', async () => {
    const res = await claimPOST(post({ code: 'corto' }))
    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('sin secretos en respuestas ni logs', () => {
  let logs: string[]
  beforeEach(() => {
    logs = []
    for (const m of ['log', 'error', 'warn', 'info'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
    }
  })
  afterEach(() => vi.restoreAllMocks())

  it('el código en claro no aparece en ningún log, y las respuestas no traen code_hash', async () => {
    const enr = await terminalsPOST(post({ clientId: 'tenant-a', location_id: 'loc-a1' }))
    const { enrollment_code } = await enr.json() as { enrollment_code: string }
    const cl = await claimPOST(post({ code: enrollment_code }))
    const clBody = await cl.json() as Record<string, unknown>

    expect(clBody).not.toHaveProperty('code_hash')
    expect(clBody).not.toHaveProperty('enrollment_code')
    expect(logs.join('\n')).not.toContain(enrollment_code)
  })
})

describe('PATCH /terminals — no mueve tenant/sucursal (legacy toggle)', () => {
  it('rechaza si el body intenta cambiar location_id', async () => {
    const res = await terminalsPATCH(post({ clientId: 'tenant-a', device_id: 'd-legacy', active: false, location_id: 'loc-b1' }))
    expect(res.status).toBe(400)
  })
  it('permite sólo cambiar active', async () => {
    const res = await terminalsPATCH(post({ clientId: 'tenant-a', device_id: 'd-legacy', active: false }))
    expect(res.status).toBe(200)
    expect(terminalWrites()[0].body).toEqual({ active: false })
  })
})

describe('GET /terminals — compat legacy', () => {
  it('devuelve filas con location_id NULL sin romper', async () => {
    const res = await terminalsGET(get('clientId=tenant-a'))
    const j = await res.json() as { terminals: { device_id: string; location_id: string | null }[] }
    expect(j.terminals[0].location_id).toBeNull()
    expect(j.terminals[0].device_id).toBe('d-legacy')
  })
})
