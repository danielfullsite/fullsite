// BUG-019 dependency patch — los 3 routes server-side deben leer tablas tenant
// con la SERVICE-ROLE key canónica (SUPABASE_SERVICE_KEY), NUNCA con anon, y
// fallar cerrado si la key falta. Ejercen los handlers REALES; solo se moquea
// fetch (frontera de red). No se reproduce la lógica en mocks.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const ANON = 'ANON_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

let calls: { url: string; apikey: string | null; authorization: string | null }[] = []

function installFetch(handler: (url: string) => unknown) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers as HeadersInit)
    calls.push({ url: String(url), apikey: h.get('apikey'), authorization: h.get('authorization') })
    const body = handler(String(url))
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
}

function setEnv({ service }: { service: boolean }) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON
  if (service) process.env.SUPABASE_SERVICE_KEY = SERVICE
  else delete process.env.SUPABASE_SERVICE_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY // probamos que NO se requiere
}

const restCalls = () => calls.filter(c => c.url.includes('/rest/v1/'))
const usedAnonAsAuth = () => calls.some(c => c.authorization === `Bearer ${ANON}`)

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); calls = [] })

describe('BUG-019 dep patch — hourly-distribution usa service key, no anon', () => {
  it('con SUPABASE_SERVICE_KEY (y SIN service_role_key): lee pos_orders con Bearer service, nunca anon', async () => {
    setEnv({ service: true })
    installFetch(() => [])
    const { GET } = await import('@/app/api/dashboard/hourly-distribution/route')
    const req = { nextUrl: { searchParams: new URLSearchParams({ client_id: 'demo' }) } } as unknown as import('next/server').NextRequest
    const res = await GET(req)
    const posCall = restCalls().find(c => c.url.includes('pos_orders'))
    expect(posCall).toBeTruthy()
    expect(posCall!.authorization).toBe(`Bearer ${SERVICE}`)
    expect(posCall!.apikey).toBe(SERVICE)
    expect(usedAnonAsAuth()).toBe(false)
    expect(res.status).not.toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain(SERVICE)
  })

  it('SIN service key → 503 fail-closed, NO se llama a pos_orders con anon', async () => {
    setEnv({ service: false })
    installFetch(() => [])
    const { GET } = await import('@/app/api/dashboard/hourly-distribution/route')
    const req = { nextUrl: { searchParams: new URLSearchParams({ client_id: 'demo' }) } } as unknown as import('next/server').NextRequest
    const res = await GET(req)
    expect(res.status).toBe(503)
    expect(restCalls()).toHaveLength(0)
  })
})

describe('BUG-019 dep patch — health usa service key, no anon', () => {
  it('con service key: lee wansoft_data con Bearer service, nunca anon', async () => {
    setEnv({ service: true })
    installFetch((u) => u.includes('wansoft_daily') ? [{ fecha: new Date().toISOString().slice(0, 10) }]
      : u.includes('wansoft_data') ? [{ fecha: '2026-08-01', data_key: 'costeo_por_platillo' }]
      : u.includes('agent_runs') ? [{ agent_id: 'x', created_at: new Date().toISOString() }] : [])
    const { GET } = await import('@/app/api/health/route')
    const res = await GET({ url: `${URLBASE}/api/health?data_source=wansoft` } as unknown as import('next/server').NextRequest)
    const wd = restCalls().find(c => c.url.includes('wansoft_data'))
    expect(wd).toBeTruthy()
    expect(wd!.authorization).toBe(`Bearer ${SERVICE}`)
    expect(usedAnonAsAuth()).toBe(false)
    expect(JSON.stringify(await res.json())).not.toContain(SERVICE)
  })

  it('SIN service key → 503 degraded fail-closed, sin fetch a tablas tenant', async () => {
    setEnv({ service: false })
    installFetch(() => [])
    const { GET } = await import('@/app/api/health/route')
    const res = await GET({ url: `${URLBASE}/api/health` } as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(503)
    expect(restCalls()).toHaveLength(0)
  })
})

describe('BUG-019 dep patch — backup usa service key, no anon', () => {
  function makeReq() {
    return {
      headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer user-token' : null) },
      url: `${URLBASE}/api/backup?table=pos_orders`,
    } as unknown as import('next/server').NextRequest
  }
  it('lectura de tablas tenant con Bearer service; el apikey de /auth/v1/user es anon (legítimo)', async () => {
    setEnv({ service: true })
    process.env.BACKUP_ADMIN_EMAILS = 'admin@test.com'
    installFetch((u) => u.includes('/auth/v1/user') ? { email: 'admin@test.com' } : [])
    const { GET } = await import('@/app/api/backup/route')
    const res = await GET(makeReq())
    const authCall = calls.find(c => c.url.includes('/auth/v1/user'))
    const posCall = restCalls().find(c => c.url.includes('pos_orders'))
    expect(authCall!.apikey).toBe(ANON)                 // apikey no privilegiado para validar el user JWT
    expect(posCall).toBeTruthy()
    expect(posCall!.authorization).toBe(`Bearer ${SERVICE}`)   // datos tenant → service role
    expect(posCall!.apikey).toBe(SERVICE)
    expect(res.status).not.toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain(SERVICE)
  })

  it('SIN service key (usuario autorizado) → 503 fail-closed, sin leer tablas tenant', async () => {
    setEnv({ service: false })
    process.env.BACKUP_ADMIN_EMAILS = 'admin@test.com'
    installFetch((u) => u.includes('/auth/v1/user') ? { email: 'admin@test.com' } : [])
    const { GET } = await import('@/app/api/backup/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(503)
    expect(restCalls().some(c => c.url.includes('pos_orders'))).toBe(false)
  })
})
