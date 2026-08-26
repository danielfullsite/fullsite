// Regresión: /api/agents/cron falla CERRADO.
//
// Qué estaba roto (hasta 2026-08-26):
//
//   const cronSecret = process.env.CRON_SECRET
//   if (cronSecret && authHeader !== `Bearer ${cronSecret}`) { ...401 }
//
// Sin la variable, la condición entera se saltaba. Y `CRON_SECRET` NO estaba
// configurada en producción, así que ése era el estado real desde que existe la
// ruta: cualquiera podía disparar la corrida de los 5 agentes — quemando cuota
// de Groq, escribiendo en agent_events y mandando avisos por Telegram.
//
// No hay ningún llamador legítimo: no aparece en el repo y no hay `crons` en
// vercel.json. El trabajo real de agendar agentes lo hacen los workflows de
// GitHub Actions.
//
// La propiedad que fija este archivo: sin secreto la ruta NO existe (503), en
// vez de existir sin puerta.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const agentesCorrieron = vi.fn()

vi.mock('@/lib/agents/engine', () => ({
  runAllAgents: (...args: unknown[]) => {
    agentesCorrieron(...args)
    return Promise.resolve([])
  },
}))

function req(auth?: string) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth ?? null : null) },
  } as unknown as import('next/server').NextRequest
}

const SECRETO = 'cron-secreto-de-pruebas-0123456789'

beforeEach(() => {
  vi.resetModules()
  agentesCorrieron.mockClear()
  process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'amalay'
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('/api/agents/cron falla cerrado', () => {
  it('EL BUG: sin CRON_SECRET la ruta NO corre los agentes', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/agents/cron/route')

    const res = await GET(req())

    expect(res.status).toBe(503)
    expect(agentesCorrieron).not.toHaveBeenCalled()
  })

  it('sin CRON_SECRET tampoco corre aunque manden cualquier cabecera', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/agents/cron/route')

    const res = await GET(req('Bearer lo-que-sea'))

    expect(res.status).toBe(503)
    expect(agentesCorrieron).not.toHaveBeenCalled()
  })

  it('con secreto y sin cabecera → 401, sin correr agentes', async () => {
    process.env.CRON_SECRET = SECRETO
    const { GET } = await import('@/app/api/agents/cron/route')

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(agentesCorrieron).not.toHaveBeenCalled()
  })

  it('con secreto y cabecera equivocada → 401', async () => {
    process.env.CRON_SECRET = SECRETO
    const { GET } = await import('@/app/api/agents/cron/route')

    const res = await GET(req('Bearer otro-secreto-distinto-pero-largo'))

    expect(res.status).toBe(401)
    expect(agentesCorrieron).not.toHaveBeenCalled()
  })

  it('con secreto y cabecera correcta sí corre', async () => {
    process.env.CRON_SECRET = SECRETO
    const { GET } = await import('@/app/api/agents/cron/route')

    const res = await GET(req(`Bearer ${SECRETO}`))

    expect(res.status).toBe(200)
    expect(agentesCorrieron).toHaveBeenCalledWith('amalay')
  })
})
