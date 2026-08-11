import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · /api/platform/tenants ─────────────────────────────────────
// Reproduce lo que src/app/platform/tenants/page.tsx leía con la anon key, pero
// server-side + admin-gated + service_role. OCM: freshness desde ops_daily (canónico).

export const dynamic = 'force-dynamic'

interface Tenant {
  id: string
  name: string
  lastData: string | null
  hoursAgo: number | null
  openEvents: number
}

function hoursSince(dateStr: string): number {
  const then = new Date(dateStr + 'T23:59:00')
  return Math.max(0, Math.round((Date.now() - then.getTime()) / 3_600_000))
}

async function sb(path: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await platformServiceFetch(path)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error

  const [clients, daily, events] = await Promise.all([
    sb('clients?select=id,display_name&order=display_name'),
    sb('ops_daily?select=client_id,fecha&order=fecha.desc&limit=2000'),
    sb('agent_events?select=client_id,status&status=eq.open&limit=5000'),
  ])

  const latest = new Map<string, string>()
  for (const r of daily) {
    const cid = r.client_id as string
    if (cid && !latest.has(cid)) latest.set(cid, r.fecha as string)
  }
  const eventCount = new Map<string, number>()
  for (const e of events) {
    const cid = e.client_id as string
    if (cid) eventCount.set(cid, (eventCount.get(cid) || 0) + 1)
  }

  const tenants: Tenant[] = clients.map(c => {
    const id = c.id as string
    const fecha = latest.get(id) || null
    return {
      id,
      name: (c.display_name as string) || id,
      lastData: fecha,
      hoursAgo: fecha ? hoursSince(fecha) : null,
      openEvents: eventCount.get(id) || 0,
    }
  })

  return Response.json({ tenants })
}
