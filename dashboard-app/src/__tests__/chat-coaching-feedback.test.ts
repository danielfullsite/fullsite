import { describe, expect, it, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', () => ({
  requireTenant: vi.fn(async () => ({ clientId: 'tenant-a', staffId: 'staff-a' })),
}))

import { POST } from '@/app/api/chat/feedback/route'

const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('feedback de coaching', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rechaza antes de escribir una calificación inválida', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const r = await POST(new NextRequest('http://local/api/chat/feedback', {
      method: 'POST', body: JSON.stringify({ chat_log_id: 'no', verdict: 'bad' }),
    }))
    expect(r.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('vincula la corrección al log del mismo tenant y actor autenticado', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'secret')
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json([{ id: ID }]))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    vi.stubGlobal('fetch', fetch)

    const r = await POST(new NextRequest('http://local/api/chat/feedback', {
      method: 'POST', body: JSON.stringify({ chat_log_id: ID, verdict: 'not_useful', note: 'Comparar a la misma hora', category: 'missing_data' }),
    }))

    expect(r.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [patchUrl, patchInit] = fetch.mock.calls[0]
    expect(String(patchUrl)).toContain('client_id=eq.tenant-a')
    expect(patchInit.method).toBe('PATCH')
    const [coachingUrl, coachingInit] = fetch.mock.calls[1]
    expect(String(coachingUrl)).toContain('/chat_coaching_feedback')
    expect(JSON.parse(coachingInit.body)).toMatchObject({
      client_id: 'tenant-a', chat_log_id: ID, coach_user_id: 'staff-a',
      verdict: 'not_useful', category: 'missing_data', correction: 'Comparar a la misma hora',
    })
  })

  it('no crea coaching para un log que no pertenece al restaurante autenticado', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'secret')
    const fetch = vi.fn().mockResolvedValueOnce(Response.json([]))
    vi.stubGlobal('fetch', fetch)
    const r = await POST(new NextRequest('http://local/api/chat/feedback', {
      method: 'POST', body: JSON.stringify({ chat_log_id: ID, verdict: 'useful' }),
    }))
    expect(r.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
