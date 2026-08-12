import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · /api/platform/overview ────────────────────────────────────
// Reproduce EXACTAMENTE lo que src/app/platform/page.tsx leía antes con la anon key,
// pero server-side, admin-gated y con service_role (cross-tenant sólo aquí, nunca en el browser).
// Fail-closed vía requirePlatformAdmin2FA (503 sin service key, 401 sin sesión, 403 no admin).

export const dynamic = 'force-dynamic'

interface DayBucket {
  label: string
  date: string
  total: number
  success: number
  error: number
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
}

function hoursAgoFromDate(dateStr: string): number {
  const now = new Date()
  const then = new Date(dateStr + 'T23:59:00')
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / (1000 * 60 * 60)))
}

/** COUNT vía Prefer: count=exact + Range: 0-0 → total del header Content-Range. */
async function sbCount(table: string, filter = ''): Promise<number> {
  const path = `${table}?select=*${filter ? '&' + filter : ''}`
  try {
    const res = await platformServiceFetch(path, {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    })
    const range = res.headers.get('content-range')
    if (range) {
      const total = range.split('/')[1]
      return total === '*' ? 0 : parseInt(total, 10)
    }
    return 0
  } catch {
    return 0
  }
}

async function sbFetch(path: string): Promise<unknown[]> {
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
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  const [
    clientCount,
    totalRunCount,
    successCount,
    errorCount,
    criticalAlerts,
    warningAlerts,
    recentRuns,
    latestDaily,
    uptimeRuns,
    uptimeSuccess,
  ] = await Promise.all([
    sbCount('clients'),
    sbCount('agent_runs'),
    sbCount('agent_runs', 'status=eq.success'),
    sbCount('agent_runs', 'status=eq.error'),
    sbCount('agent_results', 'priority=eq.critical'),
    sbCount('agent_results', 'priority=eq.warning'),
    sbFetch(`agent_runs?select=created_at,status&order=created_at.desc&limit=2000&created_at=gte.${daysAgo(7)}`),
    sbFetch('wansoft_daily?select=client_slug,fecha&order=fecha.desc&limit=50'),
    sbCount('agent_runs', 'agent_id=eq.uptime-monitor'),
    sbCount('agent_runs', 'agent_id=eq.uptime-monitor&status=eq.success'),
  ])

  // Build 7-day buckets
  const buckets: DayBucket[] = []
  for (let i = 6; i >= 0; i--) {
    const date = daysAgo(i)
    buckets.push({ label: shortDay(date), date, total: 0, success: 0, error: 0 })
  }
  for (const run of recentRuns as { created_at: string; status: string }[]) {
    const runDate = run.created_at?.slice(0, 10)
    const bucket = buckets.find(b => b.date === runDate)
    if (bucket) {
      bucket.total++
      if (run.status === 'success') bucket.success++
      if (run.status === 'error') bucket.error++
    }
  }

  // Data freshness per client
  const freshnessMap = new Map<string, string>()
  for (const row of latestDaily as { client_slug: string; fecha: string }[]) {
    if (!freshnessMap.has(row.client_slug)) {
      freshnessMap.set(row.client_slug, row.fecha)
    }
  }
  const freshness = Array.from(freshnessMap.entries()).map(([client, fecha]) => ({
    client,
    hoursAgo: hoursAgoFromDate(fecha),
  }))

  const uptimePercent = uptimeRuns > 0 ? (uptimeSuccess / uptimeRuns) * 100 : 99.9
  const clients = Math.max(clientCount, 1)
  const valueCreated = clients * 80000
  const successRate = totalRunCount > 0 ? (successCount / totalRunCount) * 100 : 0

  // errorCount is folded into the chart buckets; kept in the query set for parity with the old page.
  void errorCount

  return Response.json({
    activeClients: clientCount,
    totalRuns: totalRunCount,
    successRate,
    alertsCritical: criticalAlerts,
    alertsWarning: warningAlerts,
    valueCreated,
    uptimePercent,
    freshness,
    dailyRuns: buckets,
  })
}
