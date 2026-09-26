import { NextRequest } from 'next/server'
import { createMemoryAuditSink } from '@/lib/jev/audit'
import { createJevAdapter } from '@/lib/jev/adapter'
import type { DecisionInput } from '@/lib/jev/contract'
import { evaluateDecision } from '@/lib/jev/engine'
import { isRecord } from '@/lib/jev/platform-evidence'
import { checkInput } from '@/lib/jev/redaction'
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
  const evidenceId = isRecord(body) && typeof body.evidence_id === 'string' ? body.evidence_id : ''
  if (!/^[a-f0-9-]{36}$/.test(evidenceId)) return Response.json({ error: 'Identificador de evidencia inválido.' }, { status: 400 })

  const lookup = await platformServiceFetch(`platform_jev_evidence?id=eq.${encodeURIComponent(evidenceId)}&select=id,decision_input&limit=1`)
  if (!lookup.ok) return Response.json({ error: 'No se pudo cargar la fuente.' }, { status: 502 })
  const rows: unknown = await lookup.json()
  const evidence = Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : null
  if (!evidence || !isRecord(evidence.decision_input)) return Response.json({ error: 'Fuente no encontrada.' }, { status: 404 })
  // También se valida al leer: una fila corrupta o inyectada no llega al gateway.
  if (!checkInput(evidence.decision_input).ok) return Response.json({ error: 'La fuente almacenada ya no cumple el contrato.' }, { status: 409 })

  const audit = createMemoryAuditSink()
  const recommendation = await evaluateDecision(evidence.decision_input as unknown as DecisionInput, {
    jev: createJevAdapter(),
    audit,
  })
  const [auditRecord] = audit.readAll()
  if (!auditRecord) return Response.json({ error: 'No se pudo auditar el veredicto.' }, { status: 503 })

  const stored = await platformServiceFetch('platform_jev_decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      evidence_id: evidenceId,
      recommendation,
      audit_record: auditRecord,
      created_by: gate.ctx.userId,
    }]),
  })
  if (!stored.ok) return Response.json({ error: 'No se pudo registrar el veredicto.' }, { status: 502 })
  const storedRows: unknown = await stored.json()
  const decision = Array.isArray(storedRows) && isRecord(storedRows[0]) ? storedRows[0] : null
  await auditLog(gate.ctx, {
    action: 'jev.decision.evaluate', scope: 'global',
    detail: { evidence_id: evidenceId, authority: recommendation.authority, input_hash: recommendation.input_hash, executable: false },
  })
  return Response.json({ decision }, { status: 201 })
}
