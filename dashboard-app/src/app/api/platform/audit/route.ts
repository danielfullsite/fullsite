import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · GET /api/platform/audit ──────────────────────────────────
// Últimos 200 registros de platform_audit_log (append-only), created_at desc.
// Admin-gated + service_role (cross-tenant, solo server-side).

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error

  try {
    const res = await platformServiceFetch(
      'platform_audit_log?select=actor_email,actor_user_id,action,scope,target_tenant,detail,affected_count,created_at&order=created_at.desc&limit=200'
    )
    if (!res.ok) return Response.json({ entries: [] })
    const data = await res.json()
    return Response.json({ entries: Array.isArray(data) ? data : [] })
  } catch {
    return Response.json({ entries: [] })
  }
}
