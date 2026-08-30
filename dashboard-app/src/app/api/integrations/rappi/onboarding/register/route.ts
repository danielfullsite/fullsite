import { timingSafeEqual } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { assertRappiConfigured, getRappiAccessToken, rappiBaseUrl } from '@/lib/integrations/rappi/auth'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const expected = process.env.RAPPI_ONBOARDING_REGISTRATION_TOKEN?.trim()
  const authorization = request.headers.get('authorization') || ''
  const received = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!expected || !received) return false

  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const onboardingSecret = process.env.RAPPI_ONBOARDING_WEBHOOK_SECRET?.trim()
  if (!onboardingSecret) {
    return NextResponse.json({ ok: false, error: 'RAPPI_ONBOARDING_WEBHOOK_SECRET_REQUIRED' }, { status: 503 })
  }

  try {
    const { clientId } = assertRappiConfigured()
    const token = await getRappiAccessToken()
    const upstream = await fetch(
      `${rappiBaseUrl()}/api/v2/restaurants-integrations-public-api/clients/${encodeURIComponent(clientId)}/webhooks`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          event: 'STORE_PROVISIONING_STATUS',
          url: 'https://app.fullsite.mx/api/integrations/rappi/onboarding/callback',
          secret: onboardingSecret,
        }),
        cache: 'no-store',
      },
    )

    const responseText = await upstream.text()
    let message: string | undefined
    try {
      const payload = JSON.parse(responseText) as { message?: unknown }
      if (typeof payload.message === 'string') message = payload.message
    } catch {
      message = responseText.slice(0, 300) || undefined
    }

    return NextResponse.json({
      ok: upstream.ok,
      provider: 'rappi',
      event: 'STORE_PROVISIONING_STATUS',
      upstream_status: upstream.status,
      ...(message ? { message } : {}),
    }, { status: upstream.ok ? 200 : 502 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPPI_ONBOARDING_REGISTRATION_FAILED'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
