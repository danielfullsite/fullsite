// BUG-019 — dynamic tests of the REAL /api/voice and /api/coach handlers. Proves the
// ownership gate at the endpoint (not just the helper): anon→401, non-owner→403 no data,
// missing owner var→deny even AMALAY, exact owner→allowed, and on every denial NO legacy
// fetch / service-role query runs and nothing sensitive leaks.
/* eslint-disable @typescript-eslint/no-explicit-any -- handler test harness */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(),
  unauthorized: () => new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 }),
}))
import { withPOSAuth } from '@/lib/api-auth'
import { POST as voicePOST } from '@/app/api/voice/route'
import { POST as coachPOST } from '@/app/api/coach/route'

const OLD = { ...process.env }
let fetchSpy: any
function fakeReq(body: any = { message: 'hola' }): any {
  return { headers: { get: () => 'test-ip' }, cookies: { get: () => undefined }, json: async () => body }
}
function setAuth(clientId: string | null) {
  ;(withPOSAuth as any).mockResolvedValue(clientId ? { clientId, staffId: 's', staffName: '', role: 'dueño', authType: 'supabase_session' } : null)
}

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
  vi.stubGlobal('fetch', fetchSpy)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'svc'
  process.env.GROQ_API_KEY = 'g' // so voice reaches auth/gate (GROQ check precedes auth in voice)
  process.env.WANSOFT_LEGACY_CLIENT_ID = 'amalay'
})
afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks() })

describe('/api/voice ownership gate', () => {
  it('#1 anonymous → 401', async () => {
    setAuth(null)
    const res = await voicePOST(fakeReq())
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('#3 non-owner tenant → 403 feature_unavailable, no legacy fetch', async () => {
    setAuth('coffee-shop')
    const res = await voicePOST(fakeReq())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'feature_unavailable' })
    expect(fetchSpy).not.toHaveBeenCalled() // no service-role query on denial
  })
  it('#5/#6 Client #2 and hypothetical wansoft-2 → 403, no data', async () => {
    for (const t of ['client-2', 'wansoft-tenant-2']) {
      setAuth(t)
      const res = await voicePOST(fakeReq())
      expect(res.status).toBe(403)
      const body = await res.text()
      expect(body).not.toMatch(/amalay|ventas|wansoft/i) // no owner/record disclosure
    }
  })
  it('missing WANSOFT_LEGACY_CLIENT_ID → deny even AMALAY (403), no fetch', async () => {
    delete process.env.WANSOFT_LEGACY_CLIENT_ID
    setAuth('amalay')
    const res = await voicePOST(fakeReq())
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('#7 exact owner AMALAY → passes the gate (not 401/403)', async () => {
    setAuth('amalay')
    const res = await voicePOST(fakeReq())
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    expect(fetchSpy).toHaveBeenCalled() // reached the data stage past the gate
  })
})

describe('/api/coach ownership gate', () => {
  it('#2 anonymous → 401', async () => {
    setAuth(null)
    const res = await coachPOST(fakeReq({}))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('#4 non-owner tenant → 403, no legacy fetch', async () => {
    setAuth('coffee-shop')
    const res = await coachPOST(fakeReq({}))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'feature_unavailable' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('missing owner var → deny even AMALAY (403)', async () => {
    delete process.env.WANSOFT_LEGACY_CLIENT_ID
    setAuth('amalay')
    const res = await coachPOST(fakeReq({}))
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('exact owner AMALAY → passes the gate (not 403)', async () => {
    delete process.env.GROQ_API_KEY // coach returns {insights:[]} 200 after gate when no GROQ
    delete process.env.GROQ
    setAuth('amalay')
    const res = await coachPOST(fakeReq({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ insights: [] })
  })
})
