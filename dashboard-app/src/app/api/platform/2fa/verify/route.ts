import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog } from '@/lib/platform-writes'
import {
  hashCode, signStepUp, stepUpSetCookie, MAX_CODE_ATTEMPTS,
} from '@/lib/platform-2fa'

// POST /api/platform/2fa/verify — valida un OTP de correo o un recovery code.
// En éxito emite el token step-up (cookie fs-2fa, 12h). Body: { code }
export const dynamic = 'force-dynamic'

interface OtpRow { id: string; code_hash: string; expires_at: string; attempts: number }
interface Enrollment { recovery_codes: string[] }

function ok(userId: string): Response {
  const token = signStepUp(userId, Date.now())
  return new Response(JSON.stringify({ ok: true, verified: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': stepUpSetCookie(token) },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error
  const { userId } = gate.ctx

  let body: { code?: string } = {}
  try { body = await req.json() } catch { /* noop */ }
  const raw = String(body.code || '').trim()
  if (!raw) return Response.json({ error: 'Código requerido' }, { status: 400 })

  const isOtp = /^\d{6}$/.test(raw)
  const nowMs = Date.now()

  if (isOtp) {
    // OTP de correo: el más reciente no consumido.
    const res = await platformServiceFetch(
      `platform_2fa_codes?user_id=eq.${userId}&consumed_at=is.null&order=created_at.desc&limit=1&select=id,code_hash,expires_at,attempts`,
      { headers: { Accept: 'application/json' } }
    )
    const rows: OtpRow[] = res.ok ? await res.json().catch(() => []) : []
    const row = rows[0]
    if (!row) return Response.json({ error: 'No hay un código activo. Solicita uno nuevo.' }, { status: 400 })
    if (new Date(row.expires_at).getTime() < nowMs) {
      return Response.json({ error: 'El código expiró. Solicita uno nuevo.' }, { status: 400 })
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await platformServiceFetch(`platform_2fa_codes?id=eq.${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ consumed_at: new Date().toISOString() }),
      })
      return Response.json({ error: 'Demasiados intentos. Solicita un código nuevo.' }, { status: 429 })
    }
    if (hashCode(raw) === row.code_hash) {
      await platformServiceFetch(`platform_2fa_codes?id=eq.${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ consumed_at: new Date().toISOString() }),
      })
      await auditLog(gate.ctx, { action: '2fa.verify.otp', scope: 'global' })
      return ok(userId)
    }
    // fallo: incrementa intentos
    await platformServiceFetch(`platform_2fa_codes?id=eq.${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ attempts: row.attempts + 1 }),
    })
    return Response.json({ error: 'Código incorrecto.' }, { status: 400 })
  }

  // Recovery code (single-use).
  const res = await platformServiceFetch(
    `platform_2fa_enrollment?user_id=eq.${userId}&select=recovery_codes`,
    { headers: { Accept: 'application/json' } }
  )
  const rows: Enrollment[] = res.ok ? await res.json().catch(() => []) : []
  const enrollment = rows[0]
  if (!enrollment) return Response.json({ error: 'No tienes recovery codes.' }, { status: 400 })

  const h = hashCode(raw.toLowerCase())
  if (!enrollment.recovery_codes.includes(h)) {
    return Response.json({ error: 'Código de recuperación inválido.' }, { status: 400 })
  }
  const remaining = enrollment.recovery_codes.filter(c => c !== h)
  const upd = await platformServiceFetch(`platform_2fa_enrollment?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ recovery_codes: remaining, updated_at: new Date().toISOString() }),
  })
  if (!upd.ok) {
    return Response.json({ error: 'No se pudo consumir el recovery code.' }, { status: 502 })
  }
  await auditLog(gate.ctx, { action: '2fa.verify.recovery', scope: 'global', detail: { remaining: remaining.length } })
  return ok(userId)
}
