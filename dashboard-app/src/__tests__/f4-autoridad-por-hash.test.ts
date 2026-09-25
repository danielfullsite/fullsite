/**
 * Bloque POS, PR 04 — F4: el PIN en claro deja de ser la autoridad. Y F5 preparado.
 *
 * Contrato (pos-pin-authority.ts):
 *   · POS_PIN_AUTHORITY=hash busca por pin_hash + versión y NUNCA por `pin`.
 *   · Valor desconocido, sin pimienta, backfill incompleto o base caída → 503, nunca 401: la
 *     Caja lee un 401 como revocación y borraría la credencial de alguien válido.
 *   · En hash, los PINs de emergencia de entorno (texto plano) no deciden.
 *   · Los escritores escriben el hash en hash aunque no esté la bandera de doble escritura;
 *     F5 (POS_PIN_WRITE_PLAIN=off) escribe `pin: null` y sólo con la autoridad en hash.
 * Offline y sintético: fetch interceptado, pimienta de relleno.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const PIMIENTA = '3c'.repeat(32)
const throttle = vi.hoisted(() => ({ registros: [] as Array<{ key: string; ok: boolean }> }))
vi.mock('@/lib/pin-throttle', () => ({
  pinGate: vi.fn(async () => ({ allowed: true })),
  pinRecord: vi.fn(async (key: string, ok: boolean) => { throttle.registros.push({ key, ok }) }),
}))

type Fila = { id: string; client_id: string; name: string; role: string; pin: string | null; pin_hash: string | null; pin_hash_v: number | null; active: boolean }
let filas: Fila[]
let urls: string[]
let baseCaida = false

async function hashDe(cid: string, pin: string) {
  const { hashPinParaBD, _olvidarLlavesMemoizadas } = await import('@/lib/pos-pin-hash')
  _olvidarLlavesMemoizadas()
  return hashPinParaBD(cid, pin)
}

function base() {
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u); urls.push(url)
    if (url.includes('/clients?')) return Response.json([{ pos_settings: {} }])
    if (url.includes('/pos_audit_log') || url.includes('/pos_time_clock') && init?.method === 'POST') return Response.json([{ id: 1 }], { status: 201 })
    if (url.includes('/pos_time_clock')) return Response.json([])
    if (url.includes('/pos_staff')) {
      if (baseCaida) return new Response('{}', { status: 500 })
      if (init?.method === 'POST' || init?.method === 'PATCH') return new Response(null, { status: 204 })
      const q = new URL(url).searchParams
      const cid = q.get('client_id')?.slice(3)
      let r = filas.filter(f => f.client_id === cid)
      if (q.get('active') === 'eq.true') r = r.filter(f => f.active)
      const o = q.get('or')
      if (o) r = r.filter(f => f.pin_hash === null || f.pin_hash_v === null || f.pin_hash_v !== 1) // cobertura
      if (q.get('pin')) r = r.filter(f => `eq.${f.pin}` === q.get('pin'))
      if (q.get('pin_hash')) r = r.filter(f => `eq.${f.pin_hash}` === q.get('pin_hash') && `eq.${f.pin_hash_v}` === q.get('pin_hash_v'))
      const neq = q.get('id'); if (neq?.startsWith('neq.')) r = r.filter(f => f.id !== neq.slice(4))
      const roles = q.get('role')?.replace(/^in\.\(|\)$/g, '').split(','); if (roles) r = r.filter(f => roles.includes(f.role))
      return Response.json(r.map(({ id, name, role }) => ({ id, name, role })))
    }
    return Response.json([])
  }))
}

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllEnvs()
  throttle.registros = []
  baseCaida = false
  process.env.SHIFT_TOKEN_SECRET = 'secreto-sintetico-de-prueba-de-al-menos-32-caracteres'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-fixture'
  process.env.POS_PIN_PEPPER = PIMIENTA
  filas = [
    { id: 'a-g', client_id: 'tenant-a', name: 'Gerente A', role: 'gerente', pin: '4102', pin_hash: await hashDe('tenant-a', '4102'), pin_hash_v: 1, active: true },
    { id: 'a-m', client_id: 'tenant-a', name: 'Mesero A', role: 'mesero', pin: '4101', pin_hash: await hashDe('tenant-a', '4101'), pin_hash_v: 1, active: true },
    { id: 'b-g', client_id: 'tenant-b', name: 'Gerente B', role: 'gerente', pin: '4102', pin_hash: await hashDe('tenant-b', '4102'), pin_hash_v: 1, active: true },
  ]
  base()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const pin = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/pos/pin/route')
  const r = await POST(new NextRequest('https://app.test/api/pos/pin', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify(body) }))
  return { status: r.status, json: await r.json() }
}
const consultaDeStaff = () => urls.filter(u => u.includes('/pos_staff?') && !u.includes('or='))

describe('modo de la autoridad', () => {
  it('sólo "", "plain" y "hash" son válidos; lo demás es inválido (falla cerrado)', async () => {
    const { modoAutoridadPin } = await import('@/lib/pos-pin-authority')
    for (const [v, m] of [['', 'plain'], ['plain', 'plain'], ['hash', 'hash'], ['Hash', 'invalido'], ['on', 'invalido'], ['true', 'invalido']]) {
      vi.stubEnv('POS_PIN_AUTHORITY', v)
      expect(modoAutoridadPin(), v).toBe(m)
    }
  })
})

describe('V1 · /api/pos/pin', () => {
  it('plain (default): busca por pin, como siempre', async () => {
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(200)
    expect(consultaDeStaff()[0]).toContain('pin=eq.4102')
  })

  it('hash: busca por pin_hash + versión; el PIN NO viaja en la consulta', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    const r = await pin({ client_id: 'tenant-a', pin: '4102' })
    expect(r.status).toBe(200)
    expect(r.json.staff).toEqual({ id: 'a-g', name: 'Gerente A', role: 'gerente' })
    const q = consultaDeStaff()[0]
    expect(q).toContain(`pin_hash=eq.${await hashDe('tenant-a', '4102')}`)
    expect(q).toContain('pin_hash_v=eq.1')
    expect(q).not.toMatch(/[?&]pin=/)
    expect(q).not.toContain('4102')
  })

  it('hash, sin PIN en claro en la fila (F5): sigue entrando', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    filas[0].pin = null
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(200)
  })

  it('hash: PIN equivocado → 401 y cuenta', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    expect((await pin({ client_id: 'tenant-a', pin: '9999' })).status).toBe(401)
    expect(throttle.registros).toContainEqual({ key: 'tenant-a:10.0.0.9', ok: false })
  })

  it('ESTADO INCIERTO: alguien activo sin hash → 503, NO 401, y no cuenta', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    filas[1].pin_hash = null; filas[1].pin_hash_v = null
    const r = await pin({ client_id: 'tenant-a', pin: '4101' })
    expect(r.status).toBe(503)
    expect(r.json.code).toBe('authority_unavailable')
    expect(throttle.registros.filter(x => !x.ok)).toHaveLength(0)
  })

  it('ESTADO INCIERTO: hash de otra versión de pimienta → 503', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    filas[1].pin_hash_v = 2
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(503)
  })

  it('la cobertura sólo se recuerda cuando es COMPLETA: tras terminar el backfill, entra', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    filas[1].pin_hash = null; filas[1].pin_hash_v = null
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(503)
    filas[1].pin_hash = await hashDe('tenant-a', '4101'); filas[1].pin_hash_v = 1
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(200)
  })

  it('sin pimienta → 503', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    delete process.env.POS_PIN_PEPPER
    // La llave se memoiza por instancia (el entorno no cambia en caliente); la fixture ya la
    // había cargado al calcular los hashes de las filas.
    ;(await import('@/lib/pos-pin-hash'))._olvidarLlavesMemoizadas()
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(503)
  })

  it('bandera con valor desconocido → 503 (no decide en silencio)', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hashh')
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(503)
  })

  it('base caída → 503', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    baseCaida = true
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).status).toBe(503)
  })

  it('DOS TENANTS: el mismo PIN busca hashes distintos, cada quien en su tenant', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    expect((await pin({ client_id: 'tenant-a', pin: '4102' })).json.staff.id).toBe('a-g')
    expect((await pin({ client_id: 'tenant-b', pin: '4102' })).json.staff.id).toBe('b-g')
    const [a, b] = consultaDeStaff()
    expect(a).not.toBe(b)
  })

  it('DOWNGRADE: el cliente no puede pedir el modo plano', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    await pin({ client_id: 'tenant-a', pin: '4102', authority: 'plain', modo: 'plain', POS_PIN_AUTHORITY: 'plain' })
    expect(consultaDeStaff()[0]).not.toMatch(/[?&]pin=/)
  })

  it('en hash, el PIN de emergencia de entorno (texto plano) ya NO decide', async () => {
    vi.stubEnv('POS_FALLBACK_PIN', '7777777')
    vi.stubEnv('POS_FALLBACK_CLIENT_ID', 'tenant-a')
    expect((await pin({ client_id: 'tenant-a', pin: '7777777' })).status, 'plain: el fallback sigue').toBe(200)
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    expect((await pin({ client_id: 'tenant-a', pin: '7777777' })).status, 'hash: no').toBe(401)
  })
})

describe('V2 · /api/pos/time-clock y V3 · pinTaken', () => {
  async function shift(rol = 'mesero') {
    const { issueShiftToken } = await import('@/lib/shift-token')
    return issueShiftToken('a-m', 'tenant-a', rol, 'M', 'POS-A')
  }

  it('checador en hash: busca por hash; con backfill incompleto → 503', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    const { POST } = await import('@/app/api/pos/time-clock/route')
    const t = await shift()
    const ok = await POST(new NextRequest('https://app.test/api/pos/time-clock', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ pin: '4101' }) }))
    expect(ok.status).not.toBe(401)
    expect(urls.find(u => u.includes('/pos_staff?') && u.includes('pin_hash=eq.'))).toBeTruthy()
    expect(urls.some(u => /[?&]pin=eq\./.test(u))).toBe(false)
    filas[0].pin_hash = null
    const { _olvidarCobertura } = await import('@/lib/pos-pin-authority')
    _olvidarCobertura()
    const r = await POST(new NextRequest('https://app.test/api/pos/time-clock', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ pin: '4101' }) }))
    expect(r.status).toBe(503)
  })

  it('pinTaken en hash: un PIN ocupado se detecta por hash; base caída → 503 (antes: «libre»)', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    const { POST } = await import('@/app/api/owner/staff/route')
    const t = await shift('gerente')
    const req = () => new NextRequest('https://app.test/api/owner/staff', { method: 'POST', headers: { authorization: `Bearer ${t}`, origin: 'https://app.test', host: 'app.test' }, body: JSON.stringify({ name: 'Nuevo', role: 'mesero', pin: '4101' }) })
    expect((await POST(req())).status).toBe(409)
    baseCaida = true
    expect((await POST(req())).status).toBe(503)
  })
})

describe('escritores (F2 → F4 → F5)', () => {
  it('con la autoridad en hash el hash se escribe aunque no esté POS_PIN_DUAL_WRITE', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    const { columnasDePin } = await import('@/lib/pos-staff-pin-write')
    expect(await columnasDePin('tenant-a', '5555')).toMatchObject({ pin: '5555', pin_hash: await hashDe('tenant-a', '5555'), pin_hash_v: 1 })
  })
  it('F5: POS_PIN_WRITE_PLAIN=off con la autoridad en hash → pin null + hash', async () => {
    vi.stubEnv('POS_PIN_AUTHORITY', 'hash')
    vi.stubEnv('POS_PIN_WRITE_PLAIN', 'off')
    const { columnasDePin } = await import('@/lib/pos-staff-pin-write')
    expect(await columnasDePin('tenant-a', '5555')).toMatchObject({ pin: null, pin_hash_v: 1 })
  })
  it('F5 sin la autoridad en hash es incoherente → falla cerrado (503 en la ruta)', async () => {
    vi.stubEnv('POS_PIN_WRITE_PLAIN', 'off')
    const { columnasDePin } = await import('@/lib/pos-staff-pin-write')
    const { esPimientaNoConfigurada } = await import('@/lib/pos-pin-hash')
    await expect(columnasDePin('tenant-a', '5555')).rejects.toSatisfy(esPimientaNoConfigurada)
  })
})
