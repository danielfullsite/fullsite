import { timingSafeEqual } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { RappiConfigError } from '@/lib/integrations/rappi/auth'
import { buildAuthorizeUrl, generatePkce, randomState, rappiSelfClientId } from '@/lib/integrations/rappi/self-onboarding'

export const dynamic = 'force-dynamic'

// Step 2 of Rappi self-onboarding: kick off the merchant OAuth2 (Authorization Code +
// PKCE) flow on Portal Partners. Admin-gated because it starts a privileged provisioning
// flow — open it in a browser as:
//   /api/integrations/rappi/onboarding/authorize?secret=<INTEGRATION_ADMIN_SECRET>
// then authenticate with the MERCHANT's Rappi Portal Partners credentials. Rappi redirects
// back to the whitelisted callback with ?code=, where the code is exchanged and the
// merchant's un-integrated stores are provisioned.
function authorized(request: NextRequest): boolean {
  const expected = process.env.INTEGRATION_ADMIN_SECRET?.trim()
  if (!expected) return false
  const received = (request.nextUrl.searchParams.get('secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '').trim()
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!process.env.INTEGRATION_ADMIN_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: 'INTEGRATION_ADMIN_SECRET_REQUIRED' }, { status: 503 })
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (!rappiSelfClientId()) {
    return NextResponse.json({ ok: false, error: 'RAPPI_SELF_CLIENT_ID_REQUIRED' }, { status: 503 })
  }

  try {
    const { verifier, challenge } = generatePkce()
    const state = randomState()
    const authorizeUrl = buildAuthorizeUrl(challenge, state)

    const res = NextResponse.redirect(authorizeUrl, 302)
    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/api/integrations/rappi/onboarding',
      maxAge: 600,
    }
    res.cookies.set('rap_so_v', verifier, cookieOpts)
    res.cookies.set('rap_so_s', state, cookieOpts)
    return res
  } catch (error) {
    if (error instanceof RappiConfigError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 503 })
    }
    const message = error instanceof Error ? error.message : 'RAPPI_AUTHORIZE_FAILED'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
