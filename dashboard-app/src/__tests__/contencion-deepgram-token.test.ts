// Contención V-C07 — /api/deepgram-token entregaba la llave MAESTRA de Deepgram
// (process.env.DEEPGRAM_API_KEY tal cual) a cualquier usuario con sesión Supabase,
// sin membresía de restaurante ni rol (deepgram-token/route.ts:5,13 en 6d6a31fc).
//
// Contrato nuevo (opción A, documentada oficialmente por Deepgram:
// POST https://api.deepgram.com/v1/auth/grant, header `Authorization: Token <API_KEY>`,
// body { ttl_seconds }, respuesta { access_token, expires_in }):
//   · el cuerpo JAMÁS contiene la llave maestra;
//   · sin sesión → 401; sin membresía → 401; rol < gerente → 403;
//   · apagado por defecto: sin DEEPGRAM_TOKEN_ENABLED='true' → 410 deepgram_token_disabled;
//   · encendido: se acuña un token efímero (≤60 s) y se devuelve solo ese token;
//   · rate limit simple por usuario/tenant → 429.
// Todo con fetch simulado y una llave FALSA. Ninguna llamada de red real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const FAKE_MASTER = 'dg-llave-maestra-falsa-0123456789abcdef'
const URL_RUTA = 'https://app.fixture.test/api/deepgram-token'

type Llamada = { url: string; init?: RequestInit }
let llamadas: Llamada[] = []

function stubFetch(opts: { membership?: Array<{ client_id: string; role: string }>; grant?: () => Response } = {}) {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    llamadas.push({ url: u, init })
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-fixture-1' }), { status: 200 })
    if (u.includes('/rest/v1/client_users')) return new Response(JSON.stringify(opts.membership ?? []), { status: 200 })
    if (u.startsWith('https://api.deepgram.com/v1/auth/grant')) {
      return opts.grant ? opts.grant() : new Response(JSON.stringify({ access_token: 'jwt-efimero-fixture', expires_in: 30 }), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  }))
}

async function tokenDe(rol: string, cid = 'tenant-a', staff = 'staff-1') {
  const { issueShiftToken } = await import('@/lib/shift-token')
  return issueShiftToken(staff, cid, rol, `${rol}-fixture`)
}

async function llamar(headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/deepgram-token/route')
  const res = await GET(new NextRequest(URL_RUTA, { headers }))
  const texto = await res.text()
  return { res, texto }
}

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  process.env.SUPABASE_SERVICE_KEY = 'service-key-fixture'
  process.env.SHIFT_TOKEN_SECRET = 'x'.repeat(40)
  process.env.DEEPGRAM_API_KEY = FAKE_MASTER
  process.env.DEEPGRAM_TOKEN_ENABLED = 'true'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DEEPGRAM_API_KEY
  delete process.env.DEEPGRAM_TOKEN_ENABLED
})

describe('V-C07 — la llave maestra nunca sale al navegador', () => {
  it('sin sesión → 401 y no se llama a Deepgram', async () => {
    stubFetch()
    const { res, texto } = await llamar()
    expect(res.status).toBe(401)
    expect(texto).not.toContain(FAKE_MASTER)
    expect(llamadas.some(l => l.url.includes('deepgram.com'))).toBe(false)
  })

  it('usuario Supabase válido SIN membresía de restaurante → 401, sin llave', async () => {
    stubFetch({ membership: [] })
    const { res, texto } = await llamar({ cookie: 'fs-at=jwt-fixture' })
    expect(res.status).toBe(401)
    expect(texto).not.toContain(FAKE_MASTER)
  })

  it('mesero con turno válido → 403, sin llave', async () => {
    stubFetch()
    const { res, texto } = await llamar({ authorization: `Bearer ${await tokenDe('mesero')}` })
    expect(res.status).toBe(403)
    expect(texto).not.toContain(FAKE_MASTER)
  })

  it('gerente → 200 con token EFÍMERO; el cuerpo no trae la llave maestra', async () => {
    stubFetch()
    const { res, texto } = await llamar({ authorization: `Bearer ${await tokenDe('gerente')}` })
    expect(res.status).toBe(200)
    expect(texto).not.toContain(FAKE_MASTER)
    const j = JSON.parse(texto)
    expect(j.token).toBe('jwt-efimero-fixture')
    expect(j.expires_in).toBeLessThanOrEqual(60)
    expect(typeof j.expires_at).toBe('string')
    expect(Object.keys(j).sort()).toEqual(['expires_at', 'expires_in', 'token'])
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('el acuñado usa el endpoint oficial con `Token <llave>` y TTL ≤ 60 s', async () => {
    stubFetch()
    await llamar({ authorization: `Bearer ${await tokenDe('dueño')}` })
    const grant = llamadas.find(l => l.url.includes('deepgram.com'))!
    expect(grant.url).toBe('https://api.deepgram.com/v1/auth/grant')
    expect(grant.init?.method).toBe('POST')
    expect((grant.init?.headers as Record<string, string>).Authorization).toBe(`Token ${FAKE_MASTER}`)
    const body = JSON.parse(String(grant.init?.body))
    expect(body.ttl_seconds).toBeGreaterThan(0)
    expect(body.ttl_seconds).toBeLessThanOrEqual(60)
  })

  it('dueño por sesión de dashboard con membresía → 200', async () => {
    stubFetch({ membership: [{ client_id: 'tenant-a', role: 'dueño' }] })
    const { res, texto } = await llamar({ cookie: 'fs-at=jwt-fixture' })
    expect(res.status).toBe(200)
    expect(texto).not.toContain(FAKE_MASTER)
  })

  it('Deepgram responde error → 502 genérico, sin llave ni detalle del proveedor', async () => {
    stubFetch({ grant: () => new Response(`bad key ${FAKE_MASTER}`, { status: 401 }) })
    const { res, texto } = await llamar({ authorization: `Bearer ${await tokenDe('gerente')}` })
    expect(res.status).toBe(502)
    expect(texto).not.toContain(FAKE_MASTER)
    expect(JSON.parse(texto).error).toBe('deepgram_grant_failed')
  })

  it('Deepgram responde 200 sin access_token → 502', async () => {
    stubFetch({ grant: () => new Response(JSON.stringify({ nope: true }), { status: 200 }) })
    const { res } = await llamar({ authorization: `Bearer ${await tokenDe('gerente')}` })
    expect(res.status).toBe(502)
  })

  it('bandera apagada (default) → 410 deepgram_token_disabled, sin tocar Deepgram', async () => {
    delete process.env.DEEPGRAM_TOKEN_ENABLED
    stubFetch()
    const { res, texto } = await llamar({ authorization: `Bearer ${await tokenDe('gerente')}` })
    expect(res.status).toBe(410)
    expect(JSON.parse(texto).error).toBe('deepgram_token_disabled')
    expect(llamadas.some(l => l.url.includes('deepgram.com'))).toBe(false)
  })

  it('bandera apagada y sin sesión → 401 (la autenticación va primero)', async () => {
    delete process.env.DEEPGRAM_TOKEN_ENABLED
    stubFetch()
    const { res } = await llamar()
    expect(res.status).toBe(401)
  })

  it('sin DEEPGRAM_API_KEY → 503 (falla cerrado)', async () => {
    delete process.env.DEEPGRAM_API_KEY
    stubFetch()
    const { res, texto } = await llamar({ authorization: `Bearer ${await tokenDe('gerente')}` })
    expect(res.status).toBe(503)
    expect(JSON.parse(texto).error).toBe('deepgram_not_configured')
  })

  it('rate limit: más de 5 tokens por minuto para el mismo usuario → 429', async () => {
    stubFetch()
    const auth = { authorization: `Bearer ${await tokenDe('gerente')}` }
    const { GET } = await import('@/app/api/deepgram-token/route')
    const estados: number[] = []
    for (let i = 0; i < 6; i++) estados.push((await GET(new NextRequest(URL_RUTA, { headers: auth }))).status)
    expect(estados.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(estados[5]).toBe(429)
    // Otro usuario no hereda el límite.
    const otro = { authorization: `Bearer ${await tokenDe('gerente', 'tenant-b', 'staff-9')}` }
    expect((await GET(new NextRequest(URL_RUTA, { headers: otro }))).status).toBe(200)
  })
})
