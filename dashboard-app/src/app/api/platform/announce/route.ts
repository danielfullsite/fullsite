import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit, auditLog, clientsCount } from '@/lib/platform-writes'

// ── Control Plane · POST /api/platform/announce ──────────────────────────────
// Upsert platform_settings key 'announcement' with value { text, active }.
// One row change → todos los tenants ven el aviso. Admin-gated + service_role +
// audit + rate-limit.
// Body: { text, active }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { text?: string; active?: boolean }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { text, active } = body
  if (typeof text !== 'string' || typeof active !== 'boolean') {
    return Response.json({ error: 'text (string) y active (boolean) requeridos' }, { status: 400 })
  }

  const res = await platformServiceFetch('platform_settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      key: 'announcement',
      value: { text, active },
      updated_by: gate.ctx.email,
      updated_at: new Date().toISOString(),
    }]),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo publicar el aviso (${res.status})`, detail }, { status: 502 })
  }

  const affected = await clientsCount()
  const audited = await auditLog(gate.ctx, {
    action: 'announcement.push',
    scope: 'global',
    detail: { text, active },
    affected_count: affected,
  })

  return Response.json({ ok: true, affected_count: affected, audited })
}
