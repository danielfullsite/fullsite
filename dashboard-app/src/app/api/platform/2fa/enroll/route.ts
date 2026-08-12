import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'
import { generateRecoveryCodes, hashCode } from '@/lib/platform-2fa'
import { auditLog } from '@/lib/platform-writes'

// POST /api/platform/2fa/enroll — genera (o rota) los recovery codes del admin.
// Los códigos en claro se devuelven UNA sola vez; en BD sólo se guardan sus hashes.
// Body: { regenerate?: boolean }  — si ya está inscrito, requiere regenerate:true.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error
  const { userId, email } = gate.ctx

  let body: { regenerate?: boolean } = {}
  try { body = await req.json() } catch { /* body opcional */ }

  const existing = await platformServiceFetch(
    `platform_2fa_enrollment?user_id=eq.${userId}&select=user_id`,
    { headers: { Accept: 'application/json' } }
  )
  const rows = existing.ok ? await existing.json().catch(() => []) : []
  const alreadyEnrolled = Array.isArray(rows) && rows.length > 0

  if (alreadyEnrolled && !body.regenerate) {
    return Response.json(
      { error: 'Ya tienes recovery codes. Envía { regenerate: true } para rotarlos (invalida los anteriores).' },
      { status: 409 }
    )
  }

  const codes = generateRecoveryCodes()
  const hashes = codes.map(hashCode)

  const upsert = await platformServiceFetch('platform_2fa_enrollment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{
      user_id: userId,
      email,
      recovery_codes: hashes,
      updated_at: new Date().toISOString(),
    }]),
  })
  if (!upsert.ok) {
    const detail = await upsert.text().catch(() => '')
    return Response.json({ error: `No se pudo guardar la inscripción (${upsert.status})`, detail }, { status: 502 })
  }

  await auditLog(gate.ctx, {
    action: alreadyEnrolled ? '2fa.recovery.rotate' : '2fa.enroll',
    scope: 'global',
    detail: { count: codes.length },
  })

  // Los códigos en claro SÓLO se devuelven aquí, nunca se vuelven a mostrar.
  return Response.json({ ok: true, recovery_codes: codes })
}
