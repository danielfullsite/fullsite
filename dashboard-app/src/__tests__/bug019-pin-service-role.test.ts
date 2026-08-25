// BUG-019 — El login por PIN debe leer pos_staff con la SERVICE ROLE key
// (server-side, bypassa RLS), NO con la anon key (que ya no puede leer pos_staff
// bajo RLS tenant-scoped). Ejerce el handler REAL POST de /api/pos/pin; solo se
// moquean fronteras: issueShiftToken y fetch (la llamada REST a Supabase).
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shift-token', () => ({
  issueShiftToken: vi.fn(async () => 'SHIFT_TOKEN_XYZ'),
}))

const SERVICE = 'SERVICE_ROLE_SENTINEL'
const ANON = 'ANON_SENTINEL'

let outbound: { url: string; apikey: string | null; authorization: string | null }[] = []

// El stub responde SEGÚN LA URL. Antes devolvía el mismo payload a todo, y desde
// que el route llama primero al RPC pos_pin_throttle y al config del tenant, esas
// llamadas recibían el array de staff: el throttle lo leía como bloqueo y cortaba
// con 429 ANTES de tocar pos_staff. El test seguía "verde por índice" contra la
// URL equivocada y dejó de proteger la propiedad de BUG-019.
function stubFetch(rows: unknown) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const headers = new Headers(init?.headers as HeadersInit)
    outbound.push({ url: u, apikey: headers.get('apikey'), authorization: headers.get('authorization') })

    // Throttle: el contrato del RPC es { allowed, retry_after } (pin-throttle.ts:63).
    // allowed:true = esta fuente puede intentar el PIN ahora.
    if (u.includes('/rpc/pos_pin_throttle')) {
      return { ok: true, json: async () => ({ allowed: true }) } as unknown as Response
    }
    // Config del tenant: sin device binding obligatorio (default del producto).
    if (u.includes('/rest/v1/clients')) {
      return { ok: true, json: async () => [{ pos_settings: {} }] } as unknown as Response
    }
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

    // Se selecciona la llamada a pos_staff por URL, NO por índice: desde que el
    // route hace primero el RPC pos_pin_throttle, outbound[0] es el throttle y el
    // assert por índice dejó de verificar la propiedad de seguridad (pasaba a ser
    // un test roto que sólo comparaba la URL equivocada). Seleccionar por URL
    // mantiene la guarda viva ante cualquier llamada que se agregue después.
    const staffCall = outbound.find(c => c.url.includes('pos_staff'))
    expect(staffCall, 'no hubo consulta a pos_staff').toBeDefined()
    expect(staffCall!.apikey).toBe(SERVICE)
    expect(staffCall!.authorization).toBe(`Bearer ${SERVICE}`)
    // NO se usó la anon key para el lookup privilegiado.
    expect(staffCall!.apikey).not.toBe(ANON)
    expect(staffCall!.authorization).not.toBe(`Bearer ${ANON}`)
    // El tenant se fuerza explícitamente en el filtro de la query.
    expect(staffCall!.url).toContain('client_id=eq.tenantA')
    // Y NINGUNA llamada saliente puede ir con la anon key en este path privilegiado.
    expect(outbound.every(c => c.apikey !== ANON)).toBe(true)
    // Éxito → staff + shiftToken; la service key nunca viaja al cliente.
    expect(json.staff).toMatchObject({ id: 's1', role: 'mesero' })
    expect(json.shiftToken).toBe('SHIFT_TOKEN_XYZ')
    expect(JSON.stringify(json)).not.toContain(SERVICE)
  })

  it('el path de fingerprint también usa la service key para el lookup de pos_staff', async () => {
    stubFetch([{ id: 's2', name: 'Hector', role: 'cajero' }])
    const { POST } = await import('@/app/api/pos/pin/route')

    await POST(makeReq({ fingerprint_id: 'fp-abc', client_id: 'tenantB' }))

    const staffCall = outbound.find(c => c.url.includes('pos_staff'))
    expect(staffCall, 'no hubo consulta a pos_staff en el path de huella').toBeDefined()
    expect(staffCall!.authorization).toBe(`Bearer ${SERVICE}`)
    expect(staffCall!.url).toContain('client_id=eq.tenantB')
    expect(outbound.every(c => c.apikey !== ANON)).toBe(true)
  })
})
