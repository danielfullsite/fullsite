import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { auditLog, rateLimit } from '@/lib/platform-writes'
import { IQ_CASES, findIqCase, buildProposal, type IqFinding } from '@/lib/iq-proposals'

// Fullsite IQ — propuesta read-only con preview/diff. Admin-gated (2FA).
//   GET                          → { cases }  (allowlist de casos)
//   POST { clientId, caseId, findings } → { proposal }  (read-only; NADA se ejecuta)
//
// Nada autónomo, nada de alto riesgo aplicado. La propuesta exige confirmación humana; la
// EJECUCIÓN es otro endpoint (fuera de este PR) con su propia confirmación + audit. Gate:
// factory.iq_proposals.

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  return NextResponse.json({ cases: IQ_CASES })
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { clientId?: string; caseId?: string; findings?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const clientId = body.clientId || ''
  if (!CLIENT_RE.test(clientId)) return NextResponse.json({ error: 'clientId inválido' }, { status: 400 })

  // Allowlist: sólo los casos definidos. Nada fuera de la lista.
  const iqCase = findIqCase(body.caseId)
  if (!iqCase) return NextResponse.json({ error: 'caso no permitido' }, { status: 400 })

  const findings = (Array.isArray(body.findings) ? body.findings : []) as IqFinding[]
  const proposal = buildProposal(iqCase.id, findings)

  // Auditar la GENERACIÓN de la propuesta (no una ejecución: nada se aplicó). Sin PII.
  await auditLog(gate.ctx, {
    action: `iq.propose.${iqCase.id}`,
    scope: 'tenant',
    target_tenant: clientId,
    detail: { findings: proposal.findings.length, proposedActions: proposal.proposedActions.length, risk: iqCase.risk },
  })

  return NextResponse.json({ proposal })
}
