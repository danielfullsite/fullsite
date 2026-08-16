import { type NextRequest, NextResponse } from 'next/server'
import { getRappiAccessToken, rappiConfigStatus, RappiConfigError, RappiHttpError } from '@/lib/integrations/rappi/auth'

function requireAdmin(request: NextRequest): Response | null {
  const expected = process.env.INTEGRATION_ADMIN_SECRET || ''
  if (!expected) return NextResponse.json({ ok: false, error: 'INTEGRATION_ADMIN_SECRET_REQUIRED' }, { status: 503 })
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-integration-admin-secret')
  if (bearer !== expected && header !== expected) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  return null
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  const probe = request.nextUrl.searchParams.get('probe') === 'oauth'
  const status = rappiConfigStatus()
  if (!probe) return NextResponse.json({ ok: true, provider: 'rappi', ...status })

  try {
    await getRappiAccessToken()
    return NextResponse.json({ ok: true, provider: 'rappi', ...status, oauth_ok: true })
  } catch (error) {
    const code = error instanceof RappiConfigError
      ? error.code
      : error instanceof RappiHttpError
        ? `RAPPI_HTTP_${error.status}`
        : 'RAPPI_OAUTH_FAILED'
    return NextResponse.json({ ok: false, provider: 'rappi', ...status, oauth_ok: false, error: code }, { status: 502 })
  }
}
