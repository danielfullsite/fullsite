import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const processRappiOrder = vi.fn()
vi.mock('@/lib/integrations/rappi/ingest', () => ({ processRappiOrder }))
vi.mock('@/lib/integrations/uber-eats/webhook-handler', () => ({ processVerifiedUberPayload: vi.fn() }))

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
    const patchUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') return Response.json([row])
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patches.push(body)
        patchUrls.push(url)
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
    expect(patches[0]).toMatchObject({ status: 'processing', claimed_at: expect.any(String), claim_token: expect.any(String) })
    expect(patches).toContainEqual(expect.objectContaining({ status: 'resolved' }))
    expect(patchUrls.at(-1)).toContain(`claim_token=eq.${encodeURIComponent(String(patches[0].claim_token))}`)
  })

  it('no roba un lease processing todavía vigente', async () => {
    const active = { ...row, status: 'processing', claimed_at: new Date().toISOString() }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json([active])
      return Response.json([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/integrations/dlq/route')
    const res = await POST(new NextRequest('https://app.example.test/api/integrations/dlq', {
      method: 'POST', headers: { authorization: 'Bearer admin-test' }, body: JSON.stringify({ id: row.id }),
    }))

    expect(res.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(processRappiOrder).not.toHaveBeenCalled()
  })

  it('recupera un processing abandonado y usa un token CAS nuevo', async () => {
    const expired = { ...row, status: 'processing', attempts: 2, claimed_at: '2026-01-01T00:00:00Z' }
    const patchUrls: string[] = []
    const patchBodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') return Response.json([expired])
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patchUrls.push(url)
        patchBodies.push(body)
        if (url.includes('claimed_at.lt.')) return Response.json([{ ...expired, ...body }])
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 204 })
    }))
    processRappiOrder.mockResolvedValue({ action: 'updated', orderId: 'rappi-rappi-1' })

    const { POST } = await import('@/app/api/integrations/dlq/route')
    const res = await POST(new NextRequest('https://app.example.test/api/integrations/dlq', {
      method: 'POST', headers: { authorization: 'Bearer admin-test' }, body: JSON.stringify({ id: row.id }),
    }))

    expect(res.status).toBe(200)
    expect(patchUrls[0]).toContain('status=eq.processing')
    expect(patchUrls[0]).toContain('claimed_at.lt.')
    expect(patchBodies[0]).toMatchObject({ attempts: 3, claim_token: expect.any(String) })
  })

  it('la migración añade lease y dueño CAS sin modificar payloads', () => {
    const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/PENDIENTE_20260912160000_integration_dlq_replay_lease.sql'), 'utf8')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS claimed_at timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS claim_token uuid')
    expect(migration).not.toMatch(/DROP\s|DELETE\s|TRUNCATE\s/i)
  })
})
