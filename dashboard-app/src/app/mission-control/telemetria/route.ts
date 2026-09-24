import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// POST /mission-control/telemetria  body { limit? } — corridas de agentes (agent_runs).
//
// F-06 (contención 2026-09-23): agent_runs NO tiene columna de tenant y su política
// RLS es `agent_runs_read ... TO authenticated USING (true)`, así que leerla desde el
// navegador con el JWT del usuario le mostraba a cualquier dueño/gerente la
// telemetría de TODOS los restaurantes. Mission Control y ROI ahora leen aquí:
// admin de plataforma (+2FA si está activo), service_role sólo en el servidor.
// Falla cerrado: 503 sin service key, 401 sin sesión, 403 si no es admin.
//
// Es POST (aunque sea lectura) a propósito: public/sw.js guarda en caché con
// stale-while-revalidate todo GET que no sea /api/*, y ese caché sobrevive al
// cambio de usuario en el mismo navegador. El SW no toca métodos distintos de GET.
export const dynamic = 'force-dynamic'

const COLS = 'agent_id,status,output_summary,duration_ms,created_at,trigger_type,error_message,tokens_in,tokens_out'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { limit?: unknown } = {}
  try { body = await req.json() } catch { /* body opcional */ }
  const raw = Number(body.limit ?? 200)
  const limit = Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 200, 1), 500)

  const res = await platformServiceFetch(`agent_runs?select=${COLS}&order=created_at.desc&limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return Response.json({ error: `No se pudo leer agent_runs (${res.status})` }, { status: 502, headers: NO_STORE })
  const runs = await res.json().catch(() => null)
  if (!Array.isArray(runs)) return Response.json({ error: 'Respuesta inválida' }, { status: 502, headers: NO_STORE })
  return Response.json({ runs }, { headers: NO_STORE })
}
