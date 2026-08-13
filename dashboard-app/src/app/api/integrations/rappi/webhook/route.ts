import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const configured = Boolean(process.env.RAPPI_WEBHOOK_SECRET)

  // Rappi integration is intentionally fail-closed until Rappi confirms the
  // exact Rappi-Signature format and signed-string contract in writing.
  // Do not ingest, normalize, or persist orders from this route before that.
  if (!configured) {
    return Response.json({ ok: false, error: 'RAPPI_WEBHOOK_NOT_CONFIGURED' }, { status: 503 })
  }

  const signature = request.headers.get('rappi-signature')
  if (!signature) {
    return Response.json({ ok: false, error: 'MISSING_SIGNATURE' }, { status: 401 })
  }

  return Response.json(
    { ok: false, error: 'RAPPI_SIGNATURE_CONTRACT_PENDING' },
    { status: 501 }
  )
}
