// El agente de finanzas corre para CUALQUIER restaurante y sólo lee SUS datos.
//
// Historia: hasta 2026-09-27 leía `wansoft_daily`/`wansoft_kpis` SIN filtro de
// cliente (tablas "globales de AMALAY"). Por eso existía un guardián que sólo lo
// dejaba correr para el dueño del histórico de Wansoft — sin él, otro restaurante
// recibía "tus ventas están abajo del promedio" con los números de AMALAY (bug del
// 2026-08-26). Y aun así llevaba desde el 2026-07-20 ciego: esa fuente murió.
//
// Ahora lee del POS de Fullsite vía `ventasFullsitePrimero` (histórico importado sólo
// hasta su último día, filtrado por client_slug). La protección se movió al DATO:
// cada consulta lleva el restaurante. Este archivo fija esa propiedad.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Llamada = { url: string; body: string }
let llamadas: Llamada[] = []

beforeEach(() => {
  llamadas = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response('[]', { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('finance lee sólo del propio restaurante', () => {
  it('toda consulta del agente va filtrada por el restaurante que lo corre', async () => {
    const { runFinanceAgent } = await import('@/lib/agents/finance')
    const { sbGet } = await import('@/lib/agents/engine')
    await runFinanceAgent('boruca', sbGet)

    expect(llamadas.length).toBeGreaterThan(0)
    for (const { url, body } of llamadas) {
      const filtrada =
        url.includes('client_id=eq.boruca') ||
        // La configuración del propio restaurante (zona e inicio del día de venta).
        url.includes('/clients?id=eq.boruca&') ||
        url.includes('client_slug=eq.boruca') ||
        body.includes('"p_client_id":"boruca"')
      expect(filtrada, `consulta sin filtro de restaurante: ${url} ${body}`).toBe(true)
    }
  })

  it('ya no toca las tablas globales wansoft_kpis ni wansoft_daily sin cliente', async () => {
    const { runFinanceAgent } = await import('@/lib/agents/finance')
    const { sbGet } = await import('@/lib/agents/engine')
    await runFinanceAgent('amalay', sbGet)

    expect(llamadas.some(l => l.url.includes('/wansoft_kpis'))).toBe(false)
    for (const l of llamadas.filter(l => l.url.includes('/wansoft_daily'))) {
      expect(l.url).toContain('client_slug=eq.amalay')
    }
  })

  it('sin ventas no se calla: emite "fuente sin datos" en vez de devolver vacío', async () => {
    const { runFinanceAgent } = await import('@/lib/agents/finance')
    const { sbGet } = await import('@/lib/agents/engine')
    const eventos = await runFinanceAgent('boruca', sbGet)
    expect(eventos.some(e => e.type === 'fuente_sin_datos' && e.client_id === 'boruca')).toBe(true)
  })

  it('runAllAgents incluye finance para cualquier restaurante', async () => {
    vi.resetModules()
    vi.doMock('@/lib/agents/operations', () => ({ runOperationsAgent: async () => [] }))
    vi.doMock('@/lib/agents/inventory', () => ({ runInventoryAgent: async () => [] }))
    vi.doMock('@/lib/agents/fraud', () => ({ runFraudAgent: async () => [] }))
    vi.doMock('@/lib/agents/staff', () => ({ runStaffAgent: async () => [] }))
    vi.doMock('@/lib/agents/finance', () => ({ runFinanceAgent: async () => [] }))
    const { runAllAgents } = await import('@/lib/agents/engine')
    const resultados = await runAllAgents('boruca')
    expect(resultados.map(r => r.agent_id)).toContain('finance')
    vi.doUnmock('@/lib/agents/finance')
  })
})
