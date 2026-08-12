import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'

// ── Control Plane · POST /api/platform/settings ──────────────────────────────
// Upsert a platform_settings row (global). Admin-gated + service_role + audit + rate-limit.
// Body: { key, value, description? }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { key?: string; value?: unknown; description?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { key, value, description } = body
  if (!key || typeof key !== 'string' || value === undefined) {
    return Response.json({ error: 'key (string) y value requeridos' }, { status: 400 })
  }

  const row: Record<string, unknown> = {
    key,
    value,
    updated_by: gate.ctx.email,
    updated_at: new Date().toISOString(),
  }
  if (typeof description === 'string') row.description = description

  const res = await platformServiceFetch('platform_settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo guardar el setting (${res.status})`, detail }, { status: 502 })
  }

  const audited = await auditLog(gate.ctx, {
    action: 'setting.update',
    scope: 'global',
    detail: { key, value },
  })

  return Response.json({ ok: true, key, audited })
}
