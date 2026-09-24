// P0 pos_staff (2026-09-24) — la API es la ÚNICA puerta de escritura, así que se prueba
// como puerta: con sesión de dashboard (rol de client_users) y con shift token (rol de
// pos_staff), dos restaurantes, y contando QUÉ llega a salir hacia PostgREST.
//
// La base simulada es un mapa en memoria; `fetch` está interceptado y ninguna llamada sale
// de la máquina. PINs, UUIDs y pimienta son sintéticos.
//
// Lo que esta prueba NO cubre y dónde sí: los privilegios de la base (authenticated/anon,
// TRUNCATE, trigger de auditoría, client_id inmutable, act-as con caducidad) están en
// supabase/tests/pos_staff_endurecimiento/run.sh, contra un Postgres de verdad.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const SB = 'https://sb.fixture.test'
const APP = 'https://app.fixture.test'
const PIMIENTA = 'ab'.repeat(32) // 64 hex sintéticos

type Fila = Record<string, unknown>
let base: Record<string, Fila[]>
let escrituras: Array<{ metodo: string; url: string; cuerpo: Fila }>
let auditoria: Fila[]

// Sesiones de dashboard: token → usuario; usuario → membresías.
const SESIONES: Record<string, string> = {
  'jwt-sin-membresia': 'u-nadie',
  'jwt-viewer-a': 'u-viewer-a',
  'jwt-capitan-a': 'u-capitan-a',
  'jwt-gerente-a': 'u-gerente-a',
  'jwt-duenio-a': 'u-duenio-a',
}
const MEMBRESIAS: Record<string, Array<{ client_id: string; role: string }>> = {
  'u-nadie': [],
  'u-viewer-a': [{ client_id: 'tenant-a', role: 'viewer' }],
  'u-capitan-a': [{ client_id: 'tenant-a', role: 'capitan' }],
  'u-gerente-a': [{ client_id: 'tenant-a', role: 'gerente' }],
  'u-duenio-a': [{ client_id: 'tenant-a', role: 'dueño' }],
}

function sembrar() {
  base = {
    'tenant-a': [
      { id: 'a-mesero', client_id: 'tenant-a', name: 'Ana', pin: '4101', role: 'mesero', role_display: 'mesero', active: true, hourly_rate: 0, weekly_salary: 0 },
      { id: 'a-capitan', client_id: 'tenant-a', name: 'Caro', pin: '4103', role: 'capitan', role_display: 'capitan', active: true, hourly_rate: 0, weekly_salary: 0 },
      { id: 'a-gerente', client_id: 'tenant-a', name: 'Beto', pin: '4102', role: 'gerente', role_display: 'gerente', active: true, hourly_rate: 0, weekly_salary: 0 },
      { id: 'a-admin', client_id: 'tenant-a', name: 'Dora', pin: '4104', role: 'admin', role_display: 'admin', active: true, hourly_rate: 0, weekly_salary: 0 },
    ],
    'tenant-b': [
      { id: 'b-mesero', client_id: 'tenant-b', name: 'Eva', pin: '4201', role: 'mesero', role_display: 'mesero', active: true, hourly_rate: 0, weekly_salary: 0 },
    ],
  }
  escrituras = []
  auditoria = []
}

function stub() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input)
    const metodo = (init?.method || 'GET').toUpperCase()
    if (u.startsWith(`${SB}/auth/v1/user`)) {
      const tok = String((init?.headers as Record<string, string>)?.Authorization || '').replace(/^Bearer\s+/, '')
      const id = SESIONES[tok]
      return id ? new Response(JSON.stringify({ id }), { status: 200 }) : new Response('{}', { status: 401 })
    }
    if (u.includes('/rest/v1/client_users')) {
      const uid = decodeURIComponent(/user_id=eq\.([^&]+)/.exec(u)?.[1] ?? '')
      return new Response(JSON.stringify(MEMBRESIAS[uid] ?? []), { status: 200 })
    }
    if (u.includes('/rest/v1/pos_staff_audit')) {
      auditoria.push(JSON.parse(String(init?.body || '{}')))
      return new Response(null, { status: 201 })
    }
    if (u.includes('/rest/v1/pos_staff')) {
      const cid = decodeURIComponent(/client_id=eq\.([^&]+)/.exec(u)?.[1] ?? '')
      if (metodo === 'POST' || metodo === 'PATCH') {
        const cuerpo = JSON.parse(String(init?.body || '{}'))
        escrituras.push({ metodo, url: u, cuerpo })
        return new Response(null, { status: 204 })
      }
      const pinQ = /[?&]pin=eq\.([^&]+)/.exec(u)?.[1]
      const idQ = /[?&]id=eq\.([^&]+)/.exec(u)?.[1]
      let filas = base[cid] ?? []
      if (pinQ) filas = filas.filter(f => f.pin === decodeURIComponent(pinQ))
      if (idQ) filas = filas.filter(f => f.id === decodeURIComponent(idQ))
      return new Response(JSON.stringify(filas), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  }))
}

async function shift(rol: string, cid: string, staffId: string) {
  const { issueShiftToken } = await import('@/lib/shift-token')
  return issueShiftToken(staffId, cid, rol, `${rol}-fixture`)
}

function req(metodo: 'GET' | 'POST' | 'PATCH', token: string | null, cuerpo?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP, host: 'app.fixture.test', ...extra }
  if (token) headers.authorization = `Bearer ${token}`
  return new NextRequest(`${APP}/api/owner/staff`, { method: metodo, headers, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })
}

async function ruta() { return import('@/app/api/owner/staff/route') }

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  process.env.SUPABASE_SERVICE_KEY = 'service-key-fixture'
  process.env.SHIFT_TOKEN_SECRET = 'x'.repeat(40)
  delete process.env.POS_PIN_DUAL_WRITE
  delete process.env.POS_PIN_PEPPER
  sembrar()
  stub()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/lib/platform-auth')
  vi.doUnmock('@/lib/platform-writes')
  delete process.env.POS_PIN_DUAL_WRITE
  delete process.env.POS_PIN_PEPPER
})

// ── Identidad y membresía ──────────────────────────────────────────────────────
describe('quién entra', () => {
  it('sin token → 401 y nada se escribe', async () => {
    const { POST } = await ruta()
    const r = await POST(req('POST', null, { name: 'X', role: 'mesero' }))
    expect(r.status).toBe(401)
    expect(escrituras).toHaveLength(0)
  })

  it('sesión válida SIN membresía → 401 (falla cerrado, no adivina tenant)', async () => {
    const { GET, POST } = await ruta()
    expect((await GET(req('GET', 'jwt-sin-membresia'))).status).toBe(401)
    expect((await POST(req('POST', 'jwt-sin-membresia', { name: 'X', role: 'mesero' }))).status).toBe(401)
    expect(escrituras).toHaveLength(0)
  })

  for (const jwt of ['jwt-viewer-a', 'jwt-capitan-a']) {
    it(`miembro básico (${jwt}) → 403 en GET, POST y PATCH`, async () => {
      const { GET, POST, PATCH } = await ruta()
      expect((await GET(req('GET', jwt))).status).toBe(403)
      expect((await POST(req('POST', jwt, { name: 'X', role: 'admin', pin: '9999' }))).status).toBe(403)
      expect((await PATCH(req('PATCH', jwt, { id: 'a-mesero', role: 'admin' }))).status).toBe(403)
      expect((await PATCH(req('PATCH', jwt, { id: 'a-gerente', reset_pin: true }))).status).toBe(403)
      expect(escrituras).toHaveLength(0)
    })
  }

  it('shift token de mesero → 403', async () => {
    const { PATCH } = await ruta()
    const t = await shift('mesero', 'tenant-a', 'a-mesero')
    expect((await PATCH(req('PATCH', t, { id: 'a-mesero', role: 'admin' }))).status).toBe(403)
    expect(escrituras).toHaveLength(0)
  })

  it('pedir un tenant del que no es miembro (x-fullsite-tenant) → 401', async () => {
    const { GET } = await ruta()
    const r = await GET(req('GET', 'jwt-gerente-a', undefined, { 'x-fullsite-tenant': 'tenant-b' }))
    expect(r.status).toBe(401)
  })
})

// ── Jerarquía ──────────────────────────────────────────────────────────────────
describe('jerarquía de roles', () => {
  it('gerente (sesión) crea capitán → 200', async () => {
    const { POST } = await ruta()
    const r = await POST(req('POST', 'jwt-gerente-a', { name: 'Nuevo', role: 'capitan' }))
    expect(r.status).toBe(200)
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].cuerpo.client_id).toBe('tenant-a')
  })

  for (const rol of ['gerente', 'admin']) {
    it(`gerente NO crea ${rol} → 403`, async () => {
      const { POST } = await ruta()
      expect((await POST(req('POST', 'jwt-gerente-a', { name: 'X', role: rol }))).status).toBe(403)
      expect(escrituras).toHaveLength(0)
    })
  }

  it('gerente NO asciende a un capitán a gerente → 403', async () => {
    const { PATCH } = await ruta()
    expect((await PATCH(req('PATCH', 'jwt-gerente-a', { id: 'a-capitan', role: 'gerente' }))).status).toBe(403)
    expect(escrituras).toHaveLength(0)
  })

  it('gerente NO edita ni restablece el PIN de otro gerente/admin → 403', async () => {
    const { PATCH } = await ruta()
    expect((await PATCH(req('PATCH', 'jwt-gerente-a', { id: 'a-gerente', pin: '5555' }))).status).toBe(403)
    expect((await PATCH(req('PATCH', 'jwt-gerente-a', { id: 'a-admin', reset_pin: true }))).status).toBe(403)
    expect(escrituras).toHaveLength(0)
  })

  it('dueño crea admin → 200', async () => {
    const { POST } = await ruta()
    expect((await POST(req('POST', 'jwt-duenio-a', { name: 'Admin2', role: 'admin' }))).status).toBe(200)
    expect(escrituras).toHaveLength(1)
  })

  it('el client_id del cuerpo se IGNORA: se escribe en el tenant de la membresía', async () => {
    const { POST } = await ruta()
    await POST(req('POST', 'jwt-duenio-a', { name: 'X', role: 'mesero', client_id: 'tenant-b' }))
    expect(escrituras[0].cuerpo.client_id).toBe('tenant-a')
  })
})

// ── Autoescalación ─────────────────────────────────────────────────────────────
describe('autoescalación', () => {
  it('gerente con shift token no se cambia su propio rol → 403', async () => {
    const { PATCH } = await ruta()
    const t = await shift('gerente', 'tenant-a', 'a-gerente')
    expect((await PATCH(req('PATCH', t, { id: 'a-gerente', role: 'admin' }))).status).toBe(403)
    expect(escrituras).toHaveLength(0)
  })

  it('admin con shift token tampoco (aunque la jerarquía se lo permitiría) → 403', async () => {
    const { PATCH } = await ruta()
    const t = await shift('admin', 'tenant-a', 'a-admin')
    const r = await PATCH(req('PATCH', t, { id: 'a-admin', role: 'mesero' }))
    expect(r.status).toBe(403)
    expect((await r.json()).error).toMatch(/propio rol/)
  })

  it('nadie se desactiva a sí mismo → 403', async () => {
    const { PATCH } = await ruta()
    const t = await shift('admin', 'tenant-a', 'a-admin')
    expect((await PATCH(req('PATCH', t, { id: 'a-admin', active: false }))).status).toBe(403)
  })

  it('corregir el propio nombre: admin sí (200); gerente no, por la jerarquía previa (403)', async () => {
    const { PATCH } = await ruta()
    const t = await shift('gerente', 'tenant-a', 'a-gerente')
    expect((await PATCH(req('PATCH', t, { id: 'a-gerente', name: 'Beto R.' }))).status).toBe(403)
    // ↑ 403 por la jerarquía existente (un gerente no edita filas de rol gerente, ni la
    // suya). Se deja escrito: el candado nuevo no relaja lo que ya existía.
    const tAdmin = await shift('admin', 'tenant-a', 'a-admin')
    expect((await PATCH(req('PATCH', tAdmin, { id: 'a-admin', name: 'Dora R.' }))).status).toBe(200)
  })
})

// ── Acceso cruzado ─────────────────────────────────────────────────────────────
describe('acceso cruzado entre restaurantes', () => {
  it('dueño de A no edita a personal de B → 404 y nada se escribe', async () => {
    const { PATCH } = await ruta()
    expect((await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'b-mesero', role: 'admin' }))).status).toBe(404)
    expect((await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'b-mesero', reset_pin: true }))).status).toBe(404)
    expect(escrituras).toHaveLength(0)
  })

  it('shift token de B no ve personal de A', async () => {
    const { GET } = await ruta()
    const t = await shift('gerente', 'tenant-b', 'b-gerente')
    const j = await (await GET(req('GET', t))).json()
    expect(j.staff.map((s: Fila) => s.id)).toEqual(['b-mesero'])
  })
})

// ── Lectura de PIN / hash ──────────────────────────────────────────────────────
describe('el navegador nunca recibe PIN ni hash', () => {
  it('GET (dueño) no trae pin ni pin_hash aunque la base los mande', async () => {
    base['tenant-a'][0].pin_hash = 'h'.repeat(64)
    const { GET } = await ruta()
    const txt = await (await GET(req('GET', 'jwt-duenio-a'))).text()
    expect(txt).not.toMatch(/"pin"|"pin_hash"|"pin_hash_v"/)
  })

  it('PATCH con PIN tecleado no lo devuelve', async () => {
    const { PATCH } = await ruta()
    const j = await (await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', pin: '7777' }))).json()
    expect(j).toEqual({ ok: true })
  })
})

// ── Restablecer PIN, cambio de rol y auditoría ─────────────────────────────────
describe('restablecer PIN y auditoría', () => {
  it('reset_pin: el servidor genera uno libre, lo devuelve UNA vez y audita pin_reset', async () => {
    const { PATCH } = await ruta()
    const r = await PATCH(req('PATCH', 'jwt-gerente-a', { id: 'a-mesero', reset_pin: true }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.pin).toMatch(/^\d{4}$/)
    expect(['4101', '4102', '4103', '4104']).not.toContain(j.pin)
    expect(escrituras[0].cuerpo.pin).toBe(j.pin)
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0]).toMatchObject({ action: 'pin_reset', changed_fields: ['pin'], staff_id: 'a-mesero', client_id: 'tenant-a' })
    // La auditoría registra NOMBRES de campo, nunca el valor.
    expect(JSON.stringify(auditoria)).not.toContain(j.pin)
  })

  it('pin y reset_pin juntos → 400', async () => {
    const { PATCH } = await ruta()
    expect((await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', pin: '7777', reset_pin: true }))).status).toBe(400)
    expect(escrituras).toHaveLength(0)
  })

  it('cambio de rol → role_changed', async () => {
    const { PATCH } = await ruta()
    await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', role: 'cajero' }))
    expect(auditoria[0]).toMatchObject({ action: 'role_changed' })
  })

  it('baja y reactivación → deactivated / reactivated', async () => {
    const { PATCH } = await ruta()
    await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', active: false }))
    await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', active: true }))
    expect(auditoria.map(a => a.action)).toEqual(['deactivated', 'reactivated'])
  })

  it('alta → created, sin el PIN en la bitácora', async () => {
    const { POST } = await ruta()
    const j = await (await POST(req('POST', 'jwt-duenio-a', { name: 'Nuevo', role: 'mesero' }))).json()
    expect(auditoria[0]).toMatchObject({ action: 'created' })
    expect(JSON.stringify(auditoria)).not.toContain(j.pin)
  })
})

// ── Doble escritura del hash (F2) ──────────────────────────────────────────────
describe('F2 — doble escritura de pin_hash', () => {
  it('interruptor apagado: sólo pin (la columna pin_hash aún no existe en prod)', async () => {
    const { PATCH } = await ruta()
    await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', pin: '7777' }))
    expect(Object.keys(escrituras[0].cuerpo)).toEqual(['pin'])
  })

  it('encendido con pimienta: pin_hash = HMAC(client_id:pin) y pin_hash_v = 1', async () => {
    process.env.POS_PIN_DUAL_WRITE = 'on'
    process.env.POS_PIN_PEPPER = PIMIENTA
    const { PATCH, POST } = await ruta()
    const { hashPinParaBD } = await import('@/lib/pos-pin-hash')
    await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', pin: '7777' }))
    expect(escrituras[0].cuerpo).toMatchObject({ pin: '7777', pin_hash: await hashPinParaBD('tenant-a', '7777'), pin_hash_v: 1 })
    await POST(req('POST', 'jwt-duenio-a', { name: 'N', role: 'mesero', pin: '8888' }))
    expect(escrituras[1].cuerpo.pin_hash).toBe(await hashPinParaBD('tenant-a', '8888'))
    // El hash depende del restaurante: el mismo PIN en B da otro.
    expect(await hashPinParaBD('tenant-b', '8888')).not.toBe(escrituras[1].cuerpo.pin_hash)
  })

  for (const [caso, pimienta] of [['sin pimienta', undefined], ['pimienta mal formada', 'corta']] as const) {
    it(`encendido ${caso}: 503 authority_unavailable y NO se escribe nada (ni el pin solo)`, async () => {
      process.env.POS_PIN_DUAL_WRITE = 'on'
      if (pimienta) process.env.POS_PIN_PEPPER = pimienta
      const { PATCH, POST } = await ruta()
      const r1 = await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', pin: '7777' }))
      const r2 = await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', reset_pin: true }))
      const r3 = await POST(req('POST', 'jwt-duenio-a', { name: 'N', role: 'mesero' }))
      for (const r of [r1, r2, r3]) {
        expect(r.status).toBe(503)
        expect((await r.json()).code).toBe('authority_unavailable')
      }
      expect(escrituras).toHaveLength(0)
    })
  }

  it('cambios SIN pin no necesitan pimienta (el interruptor no bloquea bajas ni nombres)', async () => {
    process.env.POS_PIN_DUAL_WRITE = 'on'
    const { PATCH } = await ruta()
    expect((await PATCH(req('PATCH', 'jwt-duenio-a', { id: 'a-mesero', active: false }))).status).toBe(200)
  })
})

// ── /api/platform/staff (E2) ───────────────────────────────────────────────────
describe('E2 — /api/platform/staff PATCH', () => {
  function mockPlataforma() {
    vi.doMock('@/lib/platform-auth', () => ({
      requirePlatformAdmin2FA: async () => ({ ctx: { userId: 'u-plataforma' } }),
      platformServiceFetch: (path: string, init?: RequestInit) => fetch(`${SB}/rest/v1/${path}`, init),
    }))
    const bitacora: unknown[] = []
    vi.doMock('@/lib/platform-writes', () => ({ auditLog: async (_c: unknown, e: unknown) => { bitacora.push(e) } }))
    return bitacora
  }
  const preq = (cuerpo: unknown) => new NextRequest(`${APP}/api/platform/staff`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  })

  it('encendido con pimienta: escribe el hash y la bitácora sólo nombra "pin"', async () => {
    process.env.POS_PIN_DUAL_WRITE = 'on'
    process.env.POS_PIN_PEPPER = PIMIENTA
    const bitacora = mockPlataforma()
    const { PATCH } = await import('@/app/api/platform/staff/route')
    const r = await PATCH(preq({ client_id: 'tenant-b', id: 'b-mesero', pin: '1234567890' }))
    expect(r.status).toBe(200)
    expect(escrituras[0].cuerpo.pin_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(bitacora)).not.toMatch(/pin_hash|1234567890/)
    expect((bitacora[0] as { detail: { campos: string[] } }).detail.campos).toEqual(['pin'])
  })

  it('encendido sin pimienta: 503 y nada se escribe', async () => {
    process.env.POS_PIN_DUAL_WRITE = 'on'
    mockPlataforma()
    const { PATCH } = await import('@/app/api/platform/staff/route')
    const r = await PATCH(preq({ client_id: 'tenant-b', id: 'b-mesero', pin: '1234567890' }))
    expect(r.status).toBe(503)
    expect(escrituras).toHaveLength(0)
  })
})

// ── Ayudante compartido ────────────────────────────────────────────────────────
describe('columnasDePin', () => {
  it('sólo "on" (con espacios recortados) enciende; "true", "1", "yes" no', async () => {
    const { columnasDePin } = await import('@/lib/pos-staff-pin-write')
    process.env.POS_PIN_PEPPER = PIMIENTA
    for (const v of ['true', '1', 'yes', 'encendido']) {
      process.env.POS_PIN_DUAL_WRITE = v
      expect(await columnasDePin('tenant-a', '1234')).toEqual({ pin: '1234' })
    }
    process.env.POS_PIN_DUAL_WRITE = ' on '
    expect(Object.keys(await columnasDePin('tenant-a', '1234'))).toEqual(['pin', 'pin_hash', 'pin_hash_v'])
  })
})
