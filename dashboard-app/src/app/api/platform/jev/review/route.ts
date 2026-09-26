import { NextRequest } from 'next/server'
import { isRecord } from '@/lib/jev/platform-evidence'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog, rateLimit } from '@/lib/platform-writes'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited
  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido.' }, { status: 400 }) }
  const decisionId = isRecord(body) && typeof body.decision_id === 'string' ? body.decision_id : ''
  const disposition = isRecord(body) && (body.disposition === 'accepted' || body.disposition === 'rejected') ? body.disposition : null
  if (!/^[a-f0-9-]{36}$/.test(decisionId) || !disposition) return Response.json({ error: 'Revisión inválida.' }, { status: 400 })
  const res = await platformServiceFetch('platform_jev_reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{ decision_id: decisionId, disposition, reviewed_by: gate.ctx.userId }]),
  })
  if (!res.ok) return Response.json({ error: 'No se pudo registrar la revisión.' }, { status: 502 })
  await auditLog(gate.ctx, { action: 'jev.decision.review', scope: 'global', detail: { decision_id: decisionId, disposition, executable: false } })
  return Response.json({ ok: true }, { status: 201 })
}
