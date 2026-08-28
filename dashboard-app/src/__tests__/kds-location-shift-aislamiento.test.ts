// El KDS nunca mezcla sucursal ni turno, y el histórico no reaparece como activo.
//
// El aislamiento vive en la consulta que el endpoint construye: se ejerce el handler REAL y se
// inspecciona la URL que le manda a PostgREST (mismo patrón que los tests de rutas del repo).
// Autocontenido: sólo se moquea fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let urls: string[] = []

beforeEach(() => {
  urls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  delete process.env.KITCHEN_TOKEN_SECRET // token opt-in apagado en este test
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url))
    return { ok: true, json: async () => [] } as unknown as Response
  }))
})
afterEach(() => vi.unstubAllGlobals())

async function pedir(qs: string) {
  const { GET } = await import('@/app/api/pos/kitchen/route')
  const req = { nextUrl: new URL(`https://app.fullsite.mx/api/pos/kitchen?${qs}`), headers: { get: () => null } }
  return GET(req as unknown as import('next/server').NextRequest)
}

describe('aislamiento por sucursal', () => {
  it('con location_id, la consulta filtra por esa sucursal', async () => {
    await pedir('client_id=diezmex&location_id=diezmex-rosta')
    expect(urls[0]).toContain('location_id=eq.diezmex-rosta')
  })

  it('otra sucursal del mismo tenant produce OTRO filtro (no se cruzan)', async () => {
    await pedir('client_id=diezmex&location_id=diezmex-rosta')
    await pedir('client_id=diezmex&location_id=diezmex-macadam')
    expect(urls[0]).toContain('location_id=eq.diezmex-rosta')
    expect(urls[0]).not.toContain('diezmex-macadam')
    expect(urls[1]).toContain('location_id=eq.diezmex-macadam')
    expect(urls[1]).not.toContain('diezmex-rosta')
  })

  it('sin location_id: legacy tenant-wide (no filtra por sucursal)', async () => {
    await pedir('client_id=diezmex')
    expect(urls[0]).not.toContain('location_id=eq')
  })

  it('location_id inválido → 400, sin consultar', async () => {
    const res = await pedir('client_id=diezmex&location_id=' + encodeURIComponent('a b'))
    expect(res.status).toBe(400)
    expect(urls).toHaveLength(0)
  })
})

describe('aislamiento por turno', () => {
  it('con shift_id, filtra por el turno operativo', async () => {
    await pedir('client_id=diezmex&location_id=diezmex-rosta&shift_id=turno-hoy')
    expect(urls[0]).toContain('turno_id=eq.turno-hoy')
  })

  it('dos turnos no se cruzan', async () => {
    await pedir('client_id=diezmex&shift_id=turno-manana')
    await pedir('client_id=diezmex&shift_id=turno-tarde')
    expect(urls[0]).toContain('turno_id=eq.turno-manana')
    expect(urls[0]).not.toContain('turno-tarde')
    expect(urls[1]).toContain('turno_id=eq.turno-tarde')
  })
})

describe('histórico no reaparece como activo', () => {
  it('la consulta SIEMPRE excluye cerrada/cancelada (sólo enviada/preparando/lista)', async () => {
    await pedir('client_id=diezmex&location_id=diezmex-rosta&shift_id=turno-hoy')
    expect(urls[0]).toContain('status=in.(enviada,preparando,lista)')
    expect(urls[0]).not.toContain('cerrada')
    expect(urls[0]).not.toContain('cancelada')
  })

  it('el turno acota la otra dimensión: una orden de otro turno no entra', async () => {
    // Aunque una orden vieja se reabriera (status activo), su turno_id no es el operativo.
    await pedir('client_id=diezmex&shift_id=turno-hoy')
    expect(urls[0]).toContain('turno_id=eq.turno-hoy')
  })

  it('la proyección incluye location_id y turno_id para verificar en el cliente', async () => {
    await pedir('client_id=diezmex')
    expect(urls[0]).toContain('location_id')
    expect(urls[0]).toContain('turno_id')
  })
})
