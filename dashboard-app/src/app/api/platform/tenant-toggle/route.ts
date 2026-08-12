import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'

// ── Control Plane · POST /api/platform/tenant-toggle ─────────────────────────
// Activar/desactivar un tenant (clients.active). Admin-gated + service_role +
// audit + rate-limit.
// Body: { clientId, active }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { clientId?: string; active?: boolean }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { clientId, active } = body
  if (!clientId || typeof active !== 'boolean') {
    return Response.json({ error: 'clientId (string) y active (boolean) requeridos' }, { status: 400 })
  }

  const res = await platformServiceFetch(
    `clients?id=eq.${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active }),
    }
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo actualizar el tenant (${res.status})`, detail }, { status: 502 })
  }

  const audited = await auditLog(gate.ctx, {
    action: 'tenant.toggle',
    scope: 'tenant',
    target_tenant: clientId,
    detail: { active },
    affected_count: 1,
  })

  return Response.json({ ok: true, clientId, active, audited })
}
