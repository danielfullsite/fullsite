import { NextRequest } from 'next/server'
import { requirePlatformAdmin, platformServiceFetch } from '@/lib/platform-auth'
import { is2FAEnforced, verifyStepUp, STEPUP_COOKIE, maskEmail } from '@/lib/platform-2fa'
import { resendConfigured } from '@/lib/resend'

// GET /api/platform/2fa/status — estado del segundo factor para el admin actual.
// { enforced, enrolled, verified, emailConfigured, email }
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate) return gate.error
  const { userId, email } = gate.ctx

  const res = await platformServiceFetch(
    `platform_2fa_enrollment?user_id=eq.${userId}&select=user_id`,
    { headers: { Accept: 'application/json' } }
  )
  const rows = res.ok ? await res.json().catch(() => []) : []
  const enrolled = Array.isArray(rows) && rows.length > 0

  const token = req.cookies.get(STEPUP_COOKIE)?.value
  const verified = verifyStepUp(token, Date.now()) === userId

  return Response.json({
    enforced: is2FAEnforced(),
    enrolled,
    verified,
    emailConfigured: resendConfigured(),
    email: maskEmail(email),
  })
}
