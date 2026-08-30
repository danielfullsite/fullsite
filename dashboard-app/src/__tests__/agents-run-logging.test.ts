// Agentes — constancia de corrida.
//
// EL PROBLEMA QUE ESTO PREVIENE
// -----------------------------
// Hasta el 2026-08-30 los cinco agentes del dashboard no escribían en `agent_runs`. Un
// `agent_events` vacío podía significar "corrió y no halló nada" o "nunca corrió", y no
// había forma de distinguirlo desde afuera. Resultó ser lo segundo —nada los disparaba— y
// nadie lo notó en nueve días.
//
// Lo que se prueba aquí es que las tres situaciones dejen filas DISTINTAS:
//   corrió y halló       → status ok,      skip_reason null,  rows_processed > 0
//   corrió y no halló    → status ok,      skip_reason puesto, rows_processed 0
//   no aplica al tenant  → status skipped, skip_reason puesto
//
// Sin esa distinción, "silencio" y "salud" se leen igual, que es exactamente el bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const inserts: Array<{ table: string; row: Record<string, unknown> }> = []

vi.mock('@/lib/agents/operations', () => ({ runOperationsAgent: vi.fn() }))
vi.mock('@/lib/agents/inventory', () => ({ runInventoryAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/fraud', () => ({ runFraudAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/staff', () => ({ runStaffAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/finance', () => ({ runFinanceAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/wansoft-legacy', () => ({ esDuenoDelHistoricoWansoft: vi.fn() }))

import { runAgent } from '@/lib/agents/engine'
import { runOperationsAgent } from '@/lib/agents/operations'
import { esDuenoDelHistoricoWansoft } from '@/lib/wansoft-legacy'

/** Captura los INSERT a Supabase sin salir a la red. */
function stubSupabase() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && init.body) {
      const table = u.split('/rest/v1/')[1]?.split('?')[0] ?? '?'
      try { inserts.push({ table, row: JSON.parse(String(init.body)) }) } catch { /* ignore */ }
    }
    return new Response('[]', { status: 200 })
  }))
}

const corrida = () => inserts.find(i => i.table === 'agent_runs')?.row

beforeEach(() => {
  inserts.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_KEY = 'k'
  vi.mocked(esDuenoDelHistoricoWansoft).mockResolvedValue(true)
  stubSupabase()
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const unHallazgo = [{
  client_id: 'amalay', agent_id: 'operations' as const, type: 'x', severity: 'warning' as const,
  title: 't', explanation: 'e', evidence: {}, suggested_action: 'a', confidence: 0.9, status: 'new' as const,
}]

describe('Agentes — toda corrida deja constancia en agent_runs', () => {
  it('corrió y halló → status ok, sin skip_reason, rows_processed > 0', async () => {
    vi.mocked(runOperationsAgent).mockResolvedValue(unHallazgo)
    await runAgent('operations', 'amalay', 'cron')
    const r = corrida()
    expect(r, 'debe escribir en agent_runs').toBeDefined()
    expect(r!.status).toBe('ok')
    expect(r!.skip_reason).toBeNull()
    expect(r!.rows_processed).toBe(1)
  })

  it('corrió y NO halló → status ok pero CON skip_reason: distinguible de "todo bien"', async () => {
    vi.mocked(runOperationsAgent).mockResolvedValue([])
    await runAgent('operations', 'amalay', 'cron')
    const r = corrida()!
    expect(r.status).toBe('ok')
    expect(r.rows_processed).toBe(0)
    expect(r.skip_reason).toBeTruthy()   // ← la diferencia que faltaba
  })

  it('no aplica al tenant → status skipped, no error: no debe disparar alertas diarias', async () => {
    vi.mocked(esDuenoDelHistoricoWansoft).mockResolvedValue(false)
    await runAgent('finance', 'nomada', 'cron')
    const r = corrida()!
    expect(r.status).toBe('skipped')
    expect(r.status).not.toBe('error')
    expect(String(r.skip_reason)).toMatch(/histórico/i)
  })

  it('el agente truena → status error con el mensaje, no silencio', async () => {
    vi.mocked(runOperationsAgent).mockRejectedValue(new Error('supabase caído'))
    await runAgent('operations', 'amalay', 'cron')
    const r = corrida()!
    expect(r.status).toBe('error')
    expect(String(r.error_message)).toMatch(/supabase caído/)
  })

  it('registra el trigger_type — separa lo que corre solo de lo que alguien apretó', async () => {
    vi.mocked(runOperationsAgent).mockResolvedValue([])
    await runAgent('operations', 'amalay', 'cron')
    expect(corrida()!.trigger_type).toBe('cron')

    inserts.length = 0
    await runAgent('operations', 'amalay')   // sin trigger explícito
    expect(corrida()!.trigger_type).toBe('manual')
  })

  it('prefija dashboard: para no confundirse con los agentes de Python', async () => {
    // Sin prefijo, 'fraud' (dashboard) y 'fraud-watcher' (Python) se mezclan en cualquier
    // consulta agregada sobre agent_runs.
    vi.mocked(runOperationsAgent).mockResolvedValue([])
    await runAgent('operations', 'amalay', 'cron')
    expect(corrida()!.agent_id).toBe('dashboard:operations')
  })

  it('si falla el registro, el agente NO truena — perder la bitácora no puede costar el hallazgo', async () => {
    vi.mocked(runOperationsAgent).mockResolvedValue(unHallazgo)
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('agent_runs')) throw new Error('insert falló')
      return new Response('[]', { status: 200 })
    }))
    const res = await runAgent('operations', 'amalay', 'cron')
    expect(res.events).toHaveLength(1)
    expect(res.error).toBeUndefined()
  })
})
