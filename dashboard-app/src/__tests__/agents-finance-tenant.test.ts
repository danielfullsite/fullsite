// Regresión: el agente de finanzas sólo puede correr para el tenant dueño de
// las tablas legacy.
//
// Qué estaba roto (hasta 2026-08-26): `wansoft_daily` y `wansoft_kpis` no tienen
// client_id — son tablas globales de AMALAY. El guardián que impedía correr
// `finance` para otro restaurante vivía SOLO en `runAllAgents`.
//
// Pero /api/agents/run acepta `agent_id` del cuerpo y llama a `runAgent`
// DIRECTO. Un usuario de otro restaurante pedía { agent_id: 'finance' } y
// recibía análisis calculados con las ventas de AMALAY, guardados como eventos
// propios. No era sólo una fuga: era información equivocada presentada como suya
// — "tus ventas de hoy están abajo del promedio", con los números de otro.
//
// La propiedad que fija este archivo: el guardián está en `runAgent`, o sea en
// la función que corre el agente, no en la que casualmente la llamaba.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const finanzasCorrio = vi.fn()

vi.mock('@/lib/agents/finance', () => ({
  runFinanceAgent: (...args: unknown[]) => {
    finanzasCorrio(...args)
    return Promise.resolve([])
  },
}))
vi.mock('@/lib/agents/operations', () => ({ runOperationsAgent: async () => [] }))
vi.mock('@/lib/agents/inventory', () => ({ runInventoryAgent: async () => [] }))
vi.mock('@/lib/agents/fraud', () => ({ runFraudAgent: async () => [] }))
vi.mock('@/lib/agents/staff', () => ({ runStaffAgent: async () => [] }))

beforeEach(() => {
  finanzasCorrio.mockClear()
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [], text: async () => '' }) as unknown as Response)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
})

describe('finance sólo corre para el dueño de las tablas legacy', () => {
  it('EL BUG: runAgent("finance") con otro restaurante NO ejecuta el agente', async () => {
    const { runAgent } = await import('@/lib/agents/engine')

    const res = await runAgent('finance', 'boruca')

    expect(finanzasCorrio).not.toHaveBeenCalled()
    expect(res.events).toEqual([])
    expect(res.error).toBeDefined()
  })

  it('para AMALAY sí lo ejecuta', async () => {
    const { runAgent } = await import('@/lib/agents/engine')

    await runAgent('finance', 'amalay')

    expect(finanzasCorrio).toHaveBeenCalledTimes(1)
    expect(finanzasCorrio.mock.calls[0][0]).toBe('amalay')
  })

  it('los demas agentes sí corren para cualquier restaurante', async () => {
    const { runAgent } = await import('@/lib/agents/engine')

    const res = await runAgent('operations', 'boruca')

    expect(res.error).toBeUndefined()
  })

  it('runAllAgents tampoco lo incluye para otro restaurante', async () => {
    const { runAllAgents } = await import('@/lib/agents/engine')

    const resultados = await runAllAgents('boruca')

    expect(finanzasCorrio).not.toHaveBeenCalled()
    expect(resultados.map(r => r.agent_id)).not.toContain('finance')
  })

  it('runAllAgents sí lo incluye para AMALAY', async () => {
    const { runAllAgents } = await import('@/lib/agents/engine')

    const resultados = await runAllAgents('amalay')

    expect(resultados.map(r => r.agent_id)).toContain('finance')
    expect(finanzasCorrio).toHaveBeenCalledTimes(1)
  })
})
