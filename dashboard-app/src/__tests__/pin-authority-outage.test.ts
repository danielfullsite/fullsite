import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/pos/pin/route'
import { issueShiftToken } from '@/lib/shift-token'
vi.mock('@/lib/shift-token', () => ({ issueShiftToken: vi.fn(async () => 'synthetic-token') }))
vi.mock('@/lib/pin-throttle', () => ({ pinGate: vi.fn(async () => ({ allowed: true })), pinRecord: vi.fn(async () => {}) }))
const request = () => ({ headers: new Headers(), json: async () => ({ pin: '1234567890', client_id: 'lab', device_id: 'POS-A' }) }) as unknown as import('next/server').NextRequest
beforeEach(() => { vi.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'; process.env.SUPABASE_SERVICE_KEY = 'synthetic-key' })
describe('PIN authority distinguishes outages from employee rejection', () => {
  it('cannot grant access when required enrollment policy cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(issueShiftToken).not.toHaveBeenCalled()
  })
  it('cannot treat an unavailable terminal registry as a definitive terminal revocation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/clients?')
      ? Response.json([{ pos_settings: { 'pos.require_enrolled_terminal': true } }])
      : Response.json({}, { status: 503 })))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(issueShiftToken).not.toHaveBeenCalled()
  })
  it('cannot label unavailable staff storage as a bad PIN and revoke a prepared local employee', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/clients?')
      ? Response.json([{ pos_settings: {} }]) : Response.json({}, { status: 503 })))
    expect((await POST(request())).status).toBe(503)
    expect(issueShiftToken).not.toHaveBeenCalled()
  })
  it('an explicit empty enrollment result still rejects the terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/clients?')
      ? Response.json([{ pos_settings: { 'pos.require_enrolled_terminal': true } }]) : Response.json([])))
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'terminal_not_enrolled' })
  })
})
