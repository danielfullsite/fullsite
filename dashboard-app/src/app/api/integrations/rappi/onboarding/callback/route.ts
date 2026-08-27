import { type NextRequest, NextResponse } from 'next/server'
import { isRappiProvisioningEvent, verifyRappiOnboardingSignature } from '@/lib/integrations/rappi/onboarding-signature'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'fullsite-rappi-self-onboarding-callback',
    event: 'STORE_PROVISIONING_STATUS',
  })
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const verification = verifyRappiOnboardingSignature(rawBody, request.headers.get('rappi-signature'))
  if (!verification.ok) {
    const status = verification.reason === 'NO_SECRET_CONFIGURED' ? 503 : 401
    return NextResponse.json({ ok: false, error: verification.reason }, { status })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  if (!isRappiProvisioningEvent(payload)) {
    return NextResponse.json({ ok: false, error: 'INVALID_STORE_PROVISIONING_STATUS' }, { status: 422 })
  }

  // Do not log merchant tokens, webhook secrets, or full upstream bodies. This
  // summary is enough to correlate Rappi certification attempts by batch/store.
  console.info('[rappi-self-onboarding]', {
    batchId: payload.batchId,
    integrationId: payload.integrationId,
    operation: payload.operation,
    results: payload.results.map(({ storeId, status, httpCode }) => ({ storeId, status, httpCode })),
    timestamp: payload.timestamp,
  })

  return NextResponse.json({ ok: true, accepted: true, batchId: payload.batchId })
}
