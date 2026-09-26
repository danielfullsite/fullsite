import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
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
  const gate = await requirePlatformAdmin2FA(req)
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

  // F-04 (contención 2026-09-23): sin rollout en el body se CONSERVA el actual.
  // Antes `rollout ?? {}` convertía una cohorte en "todos" (el copiloto manda
  // sólo {key, enabled}). Flag nuevo sin rollout → {} como siempre. Si no se
  // puede leer la fila actual, no se escribe (falla cerrado).
  // H6 (revisión PR5): un rollout EXPLÍCITO tiene que ser inequívoco. `{}` se
  // evaluaba como "todos" sin decirlo → 400. Global = {cohort:'all'} o {mode:'all'}
  // (se guarda como {cohort:'all'}); cohorte = {client_ids: string[]} ([] = nadie);
  // porcentaje = {percentage: 0..100}.
  if (rollout !== undefined && rollout !== null) {
    const r = rollout as Record<string, unknown>
    if (typeof r !== 'object' || Array.isArray(r) || Object.keys(r).length === 0) {
      return Response.json({ error: 'rollout vacío o inválido: usa {cohort:"all"} para todos, {client_ids:[…]} para una cohorte, u omítelo para conservar el actual' }, { status: 400 })
    }
    if ('client_ids' in r && (!Array.isArray(r.client_ids) || !r.client_ids.every(x => typeof x === 'string'))) {
      return Response.json({ error: 'rollout.client_ids debe ser un arreglo de strings' }, { status: 400 })
    }
    if ('percentage' in r && (typeof r.percentage !== 'number' || r.percentage < 0 || r.percentage > 100)) {
      return Response.json({ error: 'rollout.percentage debe ser un número entre 0 y 100' }, { status: 400 })
    }
    const global = r.mode === 'all' || r.cohort === 'all'
    if (!global && !('client_ids' in r) && !('percentage' in r)) {
      return Response.json({ error: 'rollout sin alcance explícito: usa {cohort:"all"}, {client_ids:[…]} o {percentage:n}' }, { status: 400 })
    }
  }

  const explicit = rollout as (Rollout & { mode?: string }) | undefined | null
  let effectiveRollout: Rollout = explicit
    ? (explicit.mode === 'all' ? { cohort: 'all' } : explicit)
    : {}
  if (rollout === undefined || rollout === null) {
    const cur = await platformServiceFetch(`feature_flags?key=eq.${encodeURIComponent(key)}&select=rollout`, {
      headers: { Accept: 'application/json' },
    }).catch(() => null)
    const curRows = cur && cur.ok ? await cur.json().catch(() => null) : null
    if (!Array.isArray(curRows)) {
      return Response.json({ error: 'No se pudo leer el rollout actual; el flag no se modificó' }, { status: 502 })
    }
    effectiveRollout = (curRows[0]?.rollout as Rollout | null | undefined) ?? {}
  }

  const row: Record<string, unknown> = {
    key,
    enabled,
    rollout: effectiveRollout,
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
  // Cohorte vacía = nadie (platform-config.ts:56): se audita como tenant con 0.
  const isCohort = Array.isArray(effectiveRollout.client_ids)
  const scope: 'global' | 'tenant' = isCohort ? 'tenant' : 'global'
  const affected = isCohort ? effectiveRollout.client_ids!.length : await clientsCount()

  const audited = await auditLog(gate.ctx, {
    action: 'flag.update',
    scope,
    detail: { key, enabled, rollout: effectiveRollout, rollout_conservado: rollout === undefined || rollout === null },
    affected_count: affected,
  })

  return Response.json({ ok: true, key, affected_count: affected, audited })
}
