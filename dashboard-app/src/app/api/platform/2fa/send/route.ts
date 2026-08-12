import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit } from '@/lib/platform-writes'
import { generateOtp, hashCode, maskEmail, CODE_TTL_MS } from '@/lib/platform-2fa'
import { sendEmail, otpEmailHtml, resendConfigured } from '@/lib/resend'

// POST /api/platform/2fa/send — genera un OTP de 6 dígitos, lo guarda (hash) y lo
// manda al correo del admin. Invalida los OTP previos no consumidos.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited
  const { userId, email } = gate.ctx

  if (!resendConfigured()) {
    return Response.json({ error: 'Envío de correo no configurado (RESEND_API_KEY)' }, { status: 503 })
  }
  if (!email) {
    return Response.json({ error: 'La cuenta admin no tiene correo asociado' }, { status: 422 })
  }

  const code = generateOtp()
  const nowIso = new Date().toISOString()
  const expIso = new Date(Date.now() + CODE_TTL_MS).toISOString()

  // Invalida OTP previos no consumidos (consume=ahora) para que sólo el último valga.
  await platformServiceFetch(
    `platform_2fa_codes?user_id=eq.${userId}&consumed_at=is.null`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ consumed_at: nowIso }),
    }
  )

  const ins = await platformServiceFetch('platform_2fa_codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([{ user_id: userId, code_hash: hashCode(code), expires_at: expIso }]),
  })
  if (!ins.ok) {
    const detail = await ins.text().catch(() => '')
    return Response.json({ error: `No se pudo generar el código (${ins.status})`, detail }, { status: 502 })
  }

  const sent = await sendEmail({
    to: email,
    subject: 'Tu código de acceso a Fullsite Control Plane',
    html: otpEmailHtml(code),
    text: `Tu código de verificación es: ${code} (expira en 10 minutos).`,
  })
  if (!sent.ok) {
    return Response.json({ error: 'No se pudo enviar el correo', detail: sent.detail }, { status: sent.status })
  }

  return Response.json({ ok: true, to: maskEmail(email) })
}
