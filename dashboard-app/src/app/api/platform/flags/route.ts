import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit, auditLog, clientsCount } from '@/lib/platform-writes'

// ── Control Plane · POST /api/platform/flags ─────────────────────────────────
// Upsert a feature_flags row (global). Admin-gated + service_role + audit + rate-limit.
// Body: { key, enabled, rollout?, description? }
// One row change → todos los tenants la ven (via getPlatformConfig / anon read).

export const dynamic = 'force-dynamic'

interface Rollout {
  cohort?: string
  client_ids?: string[]
  percentage?: number
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { key?: string; enabled?: boolean; rollout?: Rollout; description?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { key, enabled, rollout, description } = body
  if (!key || typeof key !== 'string' || typeof enabled !== 'boolean') {
    return Response.json({ error: 'key (string) y enabled (boolean) requeridos' }, { status: 400 })
  }

  const row: Record<string, unknown> = {
    key,
    enabled,
    rollout: rollout ?? {},
    updated_by: gate.ctx.email,
    updated_at: new Date().toISOString(),
  }
  if (typeof description === 'string') row.description = description

  const res = await platformServiceFetch('feature_flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo guardar el flag (${res.status})`, detail }, { status: 502 })
  }

  // Scope tenant si el rollout está acotado a client_ids; si no, global.
  const isCohort = Array.isArray(rollout?.client_ids) && rollout!.client_ids!.length > 0
  const scope: 'global' | 'tenant' = isCohort ? 'tenant' : 'global'
  const affected = isCohort ? rollout!.client_ids!.length : await clientsCount()

  const audited = await auditLog(gate.ctx, {
    action: 'flag.update',
    scope,
    detail: { key, enabled, rollout: rollout ?? {} },
    affected_count: affected,
  })

  return Response.json({ ok: true, key, affected_count: affected, audited })
}
