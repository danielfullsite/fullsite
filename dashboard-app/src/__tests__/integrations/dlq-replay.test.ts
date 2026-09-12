import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const processRappiOrder = vi.fn()
vi.mock('@/lib/integrations/rappi/ingest', () => ({ processRappiOrder }))
vi.mock('@/lib/integrations/uber-eats/webhook/route', () => ({ processVerifiedUberPayload: vi.fn() }))

const row = {
  id: '11111111-1111-4111-8111-111111111111', provider: 'rappi', event_type: 'order.webhook',
  client_id: null, payload: { id: 'rappi-1', store_id: 'store-1' }, failure_reason: 'db down',
  status: 'pending', attempts: 0, created_at: '2026-09-12T00:00:00Z',
}

describe('DLQ de integraciones', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.INTEGRATION_ADMIN_SECRET = 'admin-test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test'
    process.env.SUPABASE_SERVICE_KEY = 'service-test'
    processRappiOrder.mockReset()
  })

  it('falla cerrado sin secreto administrativo', async () => {
    const { GET } = await import('@/app/api/integrations/dlq/route')
    const res = await GET(new NextRequest('https://app.example.test/api/integrations/dlq'))
    expect(res.status).toBe(401)
  })

  it('reclama una fila, la reprocesa y conserva evidencia como resuelta', async () => {
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') return Response.json([row])
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patches.push(body)
        if (url.includes('status=in.')) return Response.json([{ ...row, ...body }])
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 204 })
    }))
    processRappiOrder.mockResolvedValue({ action: 'new', orderId: 'rappi-rappi-1' })

    const { POST } = await import('@/app/api/integrations/dlq/route')
    const res = await POST(new NextRequest('https://app.example.test/api/integrations/dlq', {
      method: 'POST', headers: { authorization: 'Bearer admin-test' }, body: JSON.stringify({ id: row.id }),
    }))

    expect(res.status).toBe(200)
    expect(processRappiOrder).toHaveBeenCalledWith(row.payload, 'manual', expect.any(String), { quarantine: false })
    expect(patches).toContainEqual(expect.objectContaining({ status: 'resolved' }))
  })
})
