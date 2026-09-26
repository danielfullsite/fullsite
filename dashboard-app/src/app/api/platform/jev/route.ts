import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog, rateLimit } from '@/lib/platform-writes'
import { isRecord, parseP19GateExport, parseTaskDoneEvidence } from '@/lib/jev/platform-evidence'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  try {
    const [evidence, decisions, reviews] = await Promise.all([
      platformServiceFetch('platform_jev_evidence?select=id,source_ref,source_sha256,decision_input,created_at&order=created_at.desc&limit=30'),
      platformServiceFetch('platform_jev_decisions?select=id,evidence_id,recommendation,audit_record,created_at&order=created_at.desc&limit=50'),
      platformServiceFetch('platform_jev_reviews?select=decision_id,disposition,created_at&order=created_at.desc&limit=100'),
    ])
    // La migración es pendiente en entornos actuales. El panel debe mostrarlo, no inventar ceros como estado real.
    if (![evidence, decisions, reviews].every((result) => result.ok)) {
      return Response.json({ ready: false, evidence: [], decisions: [], reviews: [] })
    }
    const payloads = await Promise.all([evidence.json(), decisions.json(), reviews.json()])
    return Response.json({
      ready: true,
      evidence: Array.isArray(payloads[0]) ? payloads[0] : [],
      decisions: Array.isArray(payloads[1]) ? payloads[1] : [],
      reviews: Array.isArray(payloads[2]) ? payloads[2] : [],
    })
  } catch {
    return Response.json({ ready: false, evidence: [], decisions: [], reviews: [] })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited
  const size = Number(req.headers.get('content-length') || '0')
  if (size > 10_000) return Response.json({ error: 'Paquete demasiado grande.' }, { status: 413 })

  let raw: unknown
  try { raw = await req.json() } catch { return Response.json({ error: 'JSON inválido.' }, { status: 400 }) }
  const parsed = isRecord(raw) && 'p19_manifest' in raw
    ? parseP19GateExport(raw.p19_manifest, raw.source_sha256)
    : parseTaskDoneEvidence(raw)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const sourceRef = 'value' in parsed ? parsed.value.source_ref : parsed.source_ref
  const sourceSha256 = 'value' in parsed ? parsed.value.source_sha256 : parsed.source_sha256

  const res = await platformServiceFetch('platform_jev_evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      source_ref: sourceRef,
      source_sha256: sourceSha256,
      decision_input: parsed.input,
      created_by: gate.ctx.userId,
    }]),
  })
  if (!res.ok) return Response.json({ error: 'No se pudo registrar la fuente.' }, { status: 502 })
  const rows: unknown = await res.json()
  const evidence = Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : null
  await auditLog(gate.ctx, {
    action: isRecord(raw) && 'p19_manifest' in raw ? 'jev.evidence.import_p19' : 'jev.evidence.register', scope: 'global',
    detail: { source_ref: sourceRef, source_sha256: sourceSha256, input_hash_only: true },
  })
  return Response.json({ evidence }, { status: 201 })
}
