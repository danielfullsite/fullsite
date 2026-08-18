import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// Esqueleton · Vista de hardware (Feature 2) · GET /api/platform/devices?clientId=X
// Agrega la topología de un cliente: el Local Server (Pedro, de local_server_heartbeats)
// + sesiones activas (pos_sessions) + terminales enroladas (pos_terminals, si existe).
// Admin-gated (2FA) + service_role. Read-only.

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  const clientId = req.nextUrl.searchParams.get('clientId') || ''
  if (!CLIENT_RE.test(clientId)) return Response.json({ error: 'clientId inválido' }, { status: 400 })
  const cid = encodeURIComponent(clientId)

  async function q(path: string): Promise<unknown[]> {
    try {
      const r = await platformServiceFetch(path, { headers: { Accept: 'application/json' } })
      if (!r.ok) return []
      const j = await r.json().catch(() => [])
      return Array.isArray(j) ? j : []
    } catch { return [] }
  }

  const [heartbeats, sessions, terminals] = await Promise.all([
    q(`local_server_heartbeats?restaurant_id=eq.${cid}&order=reported_at.desc`),
    q(`pos_sessions?client_id=eq.${cid}&select=terminal_id,staff_name,last_heartbeat,started_at&order=last_heartbeat.desc`),
    q(`pos_terminals?client_id=eq.${cid}&order=label`),
  ])

  return Response.json({ heartbeats, sessions, terminals })
}
