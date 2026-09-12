import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const stampCfdi = vi.fn()
const emailCfdi = vi.fn(async () => true)
let role = 'gerente'

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: async () => ({ clientId: 'tenant-a', role }),
  unauthorized: () => Response.json({}, { status: 401 }),
  POS_ROLE_LVL: { mesero: 1, cajero: 2, gerente: 4 },
  checkPosRole: (auth: { role: string }, minimum: number) => ({
    ok: (({ mesero: 1, cajero: 2, gerente: 4 } as Record<string, number>)[auth.role] || 0) >= minimum,
  }),
}))

vi.mock('@/lib/facturama', () => ({
  isFacturamaConfigured: () => true,
  stampCfdi,
  emailCfdi,
}))

const requestRow = {
  id: 'cfdi-1', client_id: 'tenant-a', status: 'pendiente', rfc: 'XAXX010101000',
  razon_social: 'PUBLICO EN GENERAL', regimen_fiscal: '616', uso_cfdi: 'S01',
  codigo_postal: '64000', email: 'cliente@example.test', subtotal: 100, iva: 16, total: 116,
}

describe('timbrado CFDI concurrente', () => {
  beforeEach(() => {
    vi.resetModules()
    stampCfdi.mockReset()
    emailCfdi.mockReset()
    emailCfdi.mockResolvedValue(true)
    role = 'gerente'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test'
    process.env.SUPABASE_SERVICE_KEY = 'service-test'
  })

  it('un mesero no puede reclamar ni timbrar una solicitud', async () => {
    role = 'mesero'
    vi.stubGlobal('fetch', vi.fn())
    const { POST } = await import('@/app/api/factura/timbrar/route')
    const res = await POST(new NextRequest('https://app.example.test/api/factura/timbrar', {
      method: 'POST', body: JSON.stringify({ id: 'cfdi-1' }),
    }))
    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
    expect(stampCfdi).not.toHaveBeenCalled()
  })

  it('sólo permite que un POST reclame y timbre la solicitud', async () => {
    let claimed = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') return Response.json([requestRow])
      if (url.includes('status=in.') && init?.method === 'PATCH') {
        if (claimed) return Response.json([])
        claimed = true
        return Response.json([{ ...requestRow, status: 'procesando' }])
      }
      return new Response(null, { status: 204 })
    }))
    stampCfdi.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return { ok: true, facturamaId: 'fid-1', uuid: 'uuid-1' }
    })

    const { POST } = await import('@/app/api/factura/timbrar/route')
    const makeReq = () => new NextRequest('https://app.example.test/api/factura/timbrar', {
      method: 'POST', body: JSON.stringify({ id: 'cfdi-1' }),
    })
    const responses = await Promise.all([POST(makeReq()), POST(makeReq())])

    expect(stampCfdi).toHaveBeenCalledTimes(1)
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  })

  it('marca resultado incierto cuando la conexión se pierde durante el PAC', async () => {
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') return Response.json([requestRow])
      if (url.includes('status=in.') && init?.method === 'PATCH') {
        return Response.json([{ ...requestRow, status: 'procesando' }])
      }
      if (init?.method === 'PATCH' && init.body) patches.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    }))
    stampCfdi.mockRejectedValue(new TypeError('connection reset'))

    const { POST } = await import('@/app/api/factura/timbrar/route')
    const res = await POST(new NextRequest('https://app.example.test/api/factura/timbrar', {
      method: 'POST', body: JSON.stringify({ id: 'cfdi-1' }),
    }))

    expect(res.status).toBe(502)
    expect(patches).toContainEqual(expect.objectContaining({ status: 'incierto' }))
    expect(await res.json()).toMatchObject({ ok: false, uncertain: true })
  })

  it('si el PAC confirma pero guardar el folio falla, intenta persistir incierto y prohíbe reintento', async () => {
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('status=in.') && init?.method === 'PATCH') return Response.json([{ ...requestRow, status: 'procesando' }])
      if (init?.method === 'PATCH' && init.body) {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(patch)
        if (patch.status === 'emitida') return Response.json({}, { status: 500 })
      }
      return new Response(null, { status: 204 })
    }))
    stampCfdi.mockResolvedValue({ ok: true, facturamaId: 'fid-confirmado', uuid: 'uuid-confirmado' })

    const { POST } = await import('@/app/api/factura/timbrar/route')
    const res = await POST(new NextRequest('https://app.example.test/api/factura/timbrar', {
      method: 'POST', body: JSON.stringify({ id: 'cfdi-1' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toMatchObject({ ok: false, uncertain: true })
    expect(body.error).toMatch(/No reintentes/i)
    expect(patches.map(patch => patch.status)).toEqual(['emitida', 'incierto'])
  })

  it('un fallo de correo no revierte una factura ya timbrada', async () => {
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('status=in.') && init?.method === 'PATCH') return Response.json([{ ...requestRow, status: 'procesando' }])
      if (init?.method === 'PATCH' && init.body) patches.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    }))
    stampCfdi.mockResolvedValue({ ok: true, facturamaId: 'fid-1', uuid: 'uuid-1' })
    emailCfdi.mockRejectedValue(new Error('mail down'))

    const { POST } = await import('@/app/api/factura/timbrar/route')
    const res = await POST(new NextRequest('https://app.example.test/api/factura/timbrar', {
      method: 'POST', body: JSON.stringify({ id: 'cfdi-1' }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, emailed: false, folio_fiscal: 'uuid-1' })
    expect(patches.some(patch => patch.status === 'incierto')).toBe(false)
  })
})
