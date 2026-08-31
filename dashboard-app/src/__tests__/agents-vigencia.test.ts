// Agentes — vigencia de los hallazgos.
//
// EL PROBLEMA MEDIDO
// ------------------
// El engine cerraba TODO hallazgo a las 6 horas, ignorando el `expires_at` que cada agente
// declara. Sobre los 18 `expires_at` que hay en el código, eso estaba mal en las dos
// direcciones:
//
//   · 8 declaran 8h, 12h, 24h o 48h → se cerraban antes de tiempo y el agente los volvía a
//     emitir en la corrida siguiente. Así aparecieron 4 copias de `fuente_sin_datos` en 12
//     horas; con el cron completo serían ~34 al día del mismo texto.
//   · Uno declara 45 min (mesa esperando cobro) → seguía marcado como pendiente 6 horas
//     después, cuando ya se había cobrado. Una alerta que dejó de ser cierta es peor que
//     ninguna: entrena a no creerle al tablero.
//
// Y el dedupe preguntaba "¿es reciente?" en vez de "¿sigue vigente?", que es la pregunta
// que de verdad decide si vale la pena repetir algo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const llamadas: Array<{ url: string; method: string; body?: unknown }> = []

vi.mock('@/lib/agents/operations', () => ({ runOperationsAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/inventory', () => ({ runInventoryAgent: vi.fn() }))
vi.mock('@/lib/agents/fraud', () => ({ runFraudAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/staff', () => ({ runStaffAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/agents/finance', () => ({ runFinanceAgent: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/wansoft-legacy', () => ({ esDuenoDelHistoricoWansoft: vi.fn().mockResolvedValue(true) }))

import { runAgent } from '@/lib/agents/engine'
import { runInventoryAgent } from '@/lib/agents/inventory'

const unHallazgo = (expiresAt?: string) => ([{
  client_id: 'amalay', agent_id: 'inventory' as const, type: 'out_of_stock',
  severity: 'critical' as const, title: 't', explanation: 'e', evidence: {},
  suggested_action: 'a', confidence: 0.9, status: 'new' as const,
  ...(expiresAt ? { expires_at: expiresAt } : {}),
}])

beforeEach(() => {
  llamadas.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_KEY = 'k'
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    llamadas.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
    return new Response('[]', { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const patchDeExpiracion = () =>
  llamadas.find(c => c.method === 'PATCH' && c.url.includes('agent_events'))
const getDeDedupe = () =>
  llamadas.find(c => c.method === 'GET' && c.url.includes('agent_events') && c.url.includes('status=eq.new'))

describe('Agentes — el expires_at del agente manda sobre el TTL del engine', () => {
  it('cierra por expires_at vencido, no sólo por antigüedad', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    const patch = patchDeExpiracion()
    expect(patch, 'debe haber un PATCH que resuelve vencidos').toBeDefined()
    expect(decodeURIComponent(patch!.url)).toContain('expires_at.lt.')
  })

  it('conserva el respaldo de 6h SÓLO para los que no declaran vigencia', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    const u = decodeURIComponent(patchDeExpiracion()!.url)
    // La condición de antigüedad va acompañada de "y no declara expires_at".
    expect(u).toContain('expires_at.is.null')
    expect(u).toContain('created_at.lt.')
  })

  it('no cierra por antigüedad a secas — eso pisaba las vigencias de 8h, 12h, 24h y 48h', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    const u = decodeURIComponent(patchDeExpiracion()!.url)
    // Si `created_at.lt.` apareciera suelto, sin el `and(...)`, volveríamos al bug.
    expect(u).toMatch(/and\(expires_at\.is\.null,created_at\.lt\./)
  })
})

describe('Agentes — el dedupe pregunta si sigue vigente, no si es reciente', () => {
  it('considera vigentes los hallazgos cuyo expires_at aún no llega', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    const u = decodeURIComponent(getDeDedupe()!.url)
    expect(u).toContain('expires_at.gte.')
  })

  it('mantiene la ventana de 30 min para los que no declaran vigencia', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    expect(decodeURIComponent(getDeDedupe()!.url)).toContain('created_at.gte.')
  })

  it('sólo mira hallazgos sin resolver — uno ya atendido no debe bloquear el nuevo', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'amalay', 'cron')
    expect(getDeDedupe()!.url).toContain('status=eq.new')
  })

  it('el dedupe es por agente y por restaurante — no se cruzan tenants', async () => {
    vi.mocked(runInventoryAgent).mockResolvedValue(unHallazgo())
    await runAgent('inventory', 'nomada', 'cron')
    const u = decodeURIComponent(getDeDedupe()!.url)
    expect(u).toContain('client_id=eq.nomada')
    expect(u).toContain('agent_id=eq.inventory')
  })
})
