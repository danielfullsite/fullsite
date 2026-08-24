// BUG-019 — El login por PIN debe leer pos_staff con la SERVICE ROLE key
// (server-side, bypassa RLS), NO con la anon key (que ya no puede leer pos_staff
// bajo RLS tenant-scoped). Ejerce el handler REAL POST de /api/pos/pin; solo se
// moquean fronteras: issueShiftToken y fetch (la llamada REST a Supabase).
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shift-token', () => ({
  issueShiftToken: vi.fn(async () => 'SHIFT_TOKEN_XYZ'),
}))

// Throttling has its own contract tests. Keep this suite focused on the
// privileged tenant-scoped staff lookup instead of consuming its RPC calls.
vi.mock('@/lib/pin-throttle', () => ({
  pinGate: vi.fn(async () => ({ allowed: true })),
  pinRecord: vi.fn(async () => undefined),
}))

const SERVICE = 'SERVICE_ROLE_SENTINEL'
const ANON = 'ANON_SENTINEL'

let outbound: { url: string; apikey: string | null; authorization: string | null }[] = []

function stubFetch(rows: unknown) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    outbound.push({
      url: String(url),
      apikey: headers.get('apikey'),
      authorization: headers.get('authorization'),
    })
    return { ok: true, json: async () => rows } as unknown as Response
  })
}

function makeReq(body: Record<string, unknown>) {
  return {
    headers: { get: (_k: string) => null },
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  outbound = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON
  process.env.SUPABASE_SERVICE_KEY = SERVICE
})

describe('BUG-019 — PIN lookup usa service role, no anon', () => {
  it('con SUPABASE_SERVICE_KEY configurada, la consulta a pos_staff usa la SERVICE key (no anon)', async () => {
    stubFetch([{ id: 's1', name: 'Omar', role: 'mesero' }])
    const { POST } = await import('@/app/api/pos/pin/route')

    const res = await POST(makeReq({ pin: '1234', client_id: 'tenantA' }))
    const json = await res.json()

    const staffLookup = outbound.find(call => call.url.includes('/pos_staff?'))
    expect(staffLookup).toBeDefined()
    expect(staffLookup!.apikey).toBe(SERVICE)
    expect(staffLookup!.authorization).toBe(`Bearer ${SERVICE}`)
    // NO se usó la anon key para el lookup privilegiado.
    expect(staffLookup!.apikey).not.toBe(ANON)
    expect(staffLookup!.authorization).not.toBe(`Bearer ${ANON}`)
    // El tenant se fuerza explícitamente en el filtro de la query.
    expect(staffLookup!.url).toContain('client_id=eq.tenantA')
    // Éxito → staff + shiftToken; la service key nunca viaja al cliente.
    expect(json.staff).toMatchObject({ id: 's1', role: 'mesero' })
    expect(json.shiftToken).toBe('SHIFT_TOKEN_XYZ')
    expect(JSON.stringify(json)).not.toContain(SERVICE)
  })

  it('el path de fingerprint también usa la service key para el lookup de pos_staff', async () => {
    stubFetch([{ id: 's2', name: 'Hector', role: 'cajero' }])
    const { POST } = await import('@/app/api/pos/pin/route')

    await POST(makeReq({ fingerprint_id: 'fp-abc', client_id: 'tenantB' }))

    const staffLookup = outbound.find(call => call.url.includes('/pos_staff?'))
    expect(staffLookup).toBeDefined()
    expect(staffLookup!.authorization).toBe(`Bearer ${SERVICE}`)
    expect(staffLookup!.url).toContain('client_id=eq.tenantB')
  })
})
