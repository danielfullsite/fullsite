import { beforeEach, describe, expect, it, vi } from 'vitest'

const tokens = vi.hoisted(() => ({
  issueShiftToken: vi.fn(async () => 'SHIFT'),
  issueBiometricRevalidationToken: vi.fn(async () => 'BIO'),
  verifyBiometricRevalidationToken: vi.fn(),
}))
vi.mock('@/lib/shift-token', () => tokens)

let urls: string[] = []
function stubFetch(staff: unknown[]) {
  urls = []
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/rpc/pos_pin_throttle')) return { ok: true, json: async () => ({ allowed: true }) } as Response
    if (u.includes('/rest/v1/clients')) return { ok: true, json: async () => [{ pos_settings: {} }] } as Response
    return { ok: true, json: async () => staff } as Response
  })
}

const req = (body: Record<string, unknown>, bearer?: string) => ({
  headers: { get: (name: string) => name.toLowerCase() === 'authorization' && bearer ? `Bearer ${bearer}` : null },
  json: async () => body,
}) as unknown as import('next/server').NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  tokens.verifyBiometricRevalidationToken.mockResolvedValue(null)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'service'
})

describe('fingerprint_id no es una credencial pública', () => {
  it('A/B: conocer el UUID no entrega staff ni shift token y ni siquiera consulta pos_staff', async () => {
    stubFetch([{ id: 'admin-1', name: 'Dueño', role: 'admin' }])
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'admin-1', client_id: 'amalay', device_id: 'POS-A' }))

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'BIOMETRIC_PROOF_REQUIRED' })
    expect(urls.some(url => url.includes('/rest/v1/pos_staff'))).toBe(false)
    expect(tokens.issueShiftToken).not.toHaveBeenCalled()
  })

  it('rechaza proof válido de otra persona, tenant o terminal', async () => {
    stubFetch([])
    const { POST } = await import('@/app/api/pos/pin/route')
    for (const proof of [
      { sub: 'otro', cid: 'amalay', did: 'POS-A' },
      { sub: 'staff-1', cid: 'otro', did: 'POS-A' },
      { sub: 'staff-1', cid: 'amalay', did: 'POS-B' },
    ]) {
      tokens.verifyBiometricRevalidationToken.mockResolvedValueOnce({ ...proof, iat: 1, exp: Date.now() + 1000 })
      const res = await POST(req({ fingerprint_id: 'staff-1', client_id: 'amalay', device_id: 'POS-A' }, 'bio'))
      expect(res.status).toBe(401)
    }
    expect(urls.some(url => url.includes('/rest/v1/pos_staff'))).toBe(false)
  })

  it('Pedro revalida el mismo actor/scope sin consumir throttle y sin recibir un token nuevo', async () => {
    stubFetch([{ id: 'staff-1', name: 'Gera', role: 'gerente' }])
    tokens.verifyBiometricRevalidationToken.mockResolvedValue({ sub: 'staff-1', cid: 'amalay', did: 'POS-A', iat: 1, exp: Date.now() + 1000 })
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req({ fingerprint_id: 'staff-1', client_id: 'amalay', device_id: 'POS-A', min_role: 'gerente' }, 'bio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.staff).toMatchObject({ id: 'staff-1', role: 'gerente' })
    expect(body.shiftToken).toBeUndefined()
    expect(body.biometricProof).toBeUndefined()
    expect(urls.some(url => url.includes('/rpc/pos_pin_throttle'))).toBe(false)
    const staffUrl = urls.find(url => url.includes('/rest/v1/pos_staff')) || ''
    expect(staffUrl).toContain('active=eq.true')
    expect(staffUrl).toContain('client_id=eq.amalay')
    expect(staffUrl).toContain('role=in.')
  })
})
