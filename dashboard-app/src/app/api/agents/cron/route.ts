/**
 * Agent cron endpoint — lo dispara `.github/workflows/agentes-dashboard-cron.yml` cada
 * 30 min en horario de servicio. Corre los 5 agentes para CADA restaurante activo
 * (`clients.active = true`) y guarda los hallazgos en agent_events.
 *
 * Hasta el 2026-09-28 corría sólo para NEXT_PUBLIC_DEFAULT_CLIENT_ID: cualquier otro
 * restaurante tenía agentes que nunca corrían solos.
 *
 * Agents are time-aware and return [] outside service hours, so this is a no-op
 * when the restaurant is closed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAllAgents, sbGet } from '@/lib/agents/engine'
import type { AgentResult } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
  //
  // Falla CERRADO. La version anterior era `if (cronSecret && ...)`: sin la
  // variable, la condicion entera se saltaba y cualquiera podia disparar la
  // corrida de los 5 agentes — quemando cuota de Groq, escribiendo en
  // agent_events y mandando avisos por Telegram. CRON_SECRET no estaba puesta en
  // produccion, asi que ese era el estado real desde que existe la ruta.
  //
  // Sin secreto la ruta no existe, en vez de existir sin puerta. Mismo patron
  // que /api/onboarding, que ya devolvia 503 cuando le falta el suyo.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron no configurado' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Restaurantes a correr ────────────────────────────────────────────────
  // Si la lista no se puede leer NO se interpreta como "no hay restaurantes": se
  // reporta el error y se corre al menos el restaurante por defecto, como antes.
  let clientIds: string[] = []
  let errorTenants: string | undefined
  try {
    const rows = await sbGet<{ id: string }>('clients', 'active=is.true&select=id&order=id.asc')
    clientIds = rows.map(r => r.id).filter(Boolean)
  } catch (err) {
    errorTenants = err instanceof Error ? err.message : String(err)
    const def = process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID
    if (def) clientIds = [def]
  }
  if (clientIds.length === 0) {
    return NextResponse.json(
      errorTenants
        ? { error: 'No se pudo leer la lista de restaurantes', detalle: errorTenants }
        : { ok: true, tenants: 0, total_events: 0 },
      { status: errorTenants ? 500 : 200 },
    )
  }

  // Por lotes y con presupuesto de tiempo: cada restaurante lanza 5 agentes en paralelo,
  // y la función tiene `maxDuration`. Lo que no alcance se reporta como pendiente —
  // nunca se da por corrido.
  const LOTE = 3
  const PRESUPUESTO_MS = (maxDuration - 15) * 1000
  const inicio = Date.now()
  const porTenant: Array<{ client_id: string; results?: AgentResult[]; error?: string }> = []
  const pendientes: string[] = []
  for (let i = 0; i < clientIds.length; i += LOTE) {
    const lote = clientIds.slice(i, i + LOTE)
    if (Date.now() - inicio > PRESUPUESTO_MS) { pendientes.push(...clientIds.slice(i)); break }
    const salidas = await Promise.allSettled(lote.map(id => runAllAgents(id, 'cron')))
    salidas.forEach((s, j) => porTenant.push(
      s.status === 'fulfilled'
        ? { client_id: lote[j], results: s.value }
        : { client_id: lote[j], error: String(s.reason) },
    ))
  }

  const totalEvents = porTenant.reduce((s, t) => s + (t.results ?? []).reduce((a, r) => a + r.events.length, 0), 0)
  const errors = porTenant.flatMap(t => [
    ...(t.error ? [{ client_id: t.client_id, agent: '*', error: t.error }] : []),
    ...(t.results ?? []).filter(r => r.error).map(r => ({ client_id: t.client_id, agent: r.agent_id, error: r.error })),
  ])
  return NextResponse.json({
    ok: errors.length === 0 && pendientes.length === 0 && !errorTenants,
    tenants: clientIds.length,
    total_events: totalEvents,
    por_tenant: porTenant.map(t => ({
      client_id: t.client_id,
      agents: (t.results ?? []).map(r => ({ agent: r.agent_id, events: r.events.length, ms: r.duration_ms })),
    })),
    errors: errors.length > 0 ? errors : undefined,
    pendientes: pendientes.length > 0 ? pendientes : undefined,
    error_tenants: errorTenants,
  })
}
