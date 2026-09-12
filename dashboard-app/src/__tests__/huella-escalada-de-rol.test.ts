import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueShiftToken } from '@/lib/shift-token'

vi.mock('@/lib/shift-token', () => ({ issueShiftToken: vi.fn(async () => 'TOKEN') }))

let urls: string[] = []

function stubFetch() {
  urls = []
  vi.stubGlobal('fetch', async (url: string) => {
    const value = String(url)
    urls.push(value)
    if (value.includes('/rpc/pos_pin_throttle')) return Response.json({ allowed: true })
    if (value.includes('/rest/v1/clients')) return Response.json([{ pos_settings: {} }])
    return Response.json([{ id: 'gerente-1', name: 'Gerente', role: 'gerente' }])
  })
}

const req = (body: Record<string, unknown>) => ({
  headers: { get: () => null },
  json: async () => body,
}) as unknown as import('next/server').NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'service-role'
  stubFetch()
})

describe('un identificador de huella nunca se convierte en sesión', () => {
  it.each([
    { fingerprint_id: 'gerente-1', client_id: 'amalay' },
    { fingerprint_id: 'gerente-1', client_id: 'amalay', manager: true },
    { fingerprint_id: 'gerente-1', client_id: 'amalay', min_role: 'gerente' },
  ])('rechaza %o antes de consultar personal o firmar token', async body => {
    const { POST } = await import('@/app/api/pos/pin/route')
    const res = await POST(req(body))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'biometric_proof_required' })
    expect(urls.some(url => url.includes('/rest/v1/pos_staff'))).toBe(false)
    expect(issueShiftToken).not.toHaveBeenCalled()
  })
})
