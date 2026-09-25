// CONTENCIÓN PR5 · F-06 (segunda mitad): /api/chat escribía "Q: <pregunta> | A: <respuesta>"
// en agent_runs, una tabla SIN columna de tenant y legible por cualquier usuario
// autenticado (política agent_runs_read USING (true)). La pregunta de un dueño de
// tenant-a quedaba a la vista de cualquier otro restaurante.
//
// Contrato: agent_runs sólo recibe metadatos (agent_id, status, tentacle…) sin
// contenido. La conversación completa sigue en chat_logs, que sí lleva client_id.
// fetch simulado: nada sale a la red.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fixture.local'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  process.env.SUPABASE_SERVICE_KEY = 'svc-fixture'
  process.env.SHIFT_TOKEN_SECRET = 'fixture-secret-0123456789abcdef0123456789abcdef'
})

const RESPUESTA = 'No tengo el dato RESPUESTA-SECRETA-B7 en mis registros.'
vi.mock('@/lib/groq', () => ({ groqChat: async () => RESPUESTA }))
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({}) }))

import { issueShiftToken } from '@/lib/shift-token'

const posts: { url: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  posts.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if ((init.method || 'GET').toUpperCase() === 'POST' && init.body) {
      const b = JSON.parse(String(init.body))
      posts.push({ url: String(input), body: Array.isArray(b) ? b[0] : b })
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('F-06 · /api/chat no guarda pregunta/respuesta en agent_runs', () => {
  it('una respuesta "no tengo" deja telemetría SIN el contenido de la conversación', async () => {
    const token = await issueShiftToken('staff-gerente', 'tenant-a', 'gerente', 'Gerente A')
    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(new NextRequest('https://app.fullsite.mx/api/chat', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'cuanto vendio PREGUNTA-SECRETA-A1 ayer' }),
    }))
    expect(res.status).toBe(200)

    const runs = posts.filter(p => p.url.includes('/rest/v1/agent_runs'))
    // la señal para Hermes se conserva como metadato (si no, la prueba no probaría nada)
    expect(runs).toHaveLength(1)
    expect(runs[0].body.agent_id).toBe('chat-feedback')
    expect(runs[0].body.status).toBe('no_data')
    for (const r of runs) {
      const txt = JSON.stringify(r.body)
      expect(txt).not.toContain('PREGUNTA-SECRETA-A1')
      expect(txt).not.toContain('RESPUESTA-SECRETA-B7')
      expect(String(r.body.output_summary ?? '')).not.toMatch(/Q:|A:/)
    }

    // control: la conversación sigue registrada donde corresponde (chat_logs, con tenant)
    const log = posts.find(p => p.url.includes('/rest/v1/chat_logs'))
    expect(log?.body.client_id).toBe('tenant-a')
    expect(String(log?.body.user_message)).toContain('PREGUNTA-SECRETA-A1')
  })
})
