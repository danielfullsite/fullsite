// Uber Eats — Get Integration Details (manual trigger for validation evidence).
// GET /api/integrations/uber-eats/pos-data?store_id=xxx
//
// Wraps GET /v1/eats/stores/{store_id}/pos_data (scope eats.store) so the
// "Integration Config — Get Integration Details" requirement can be exercised
// on demand — the automatic path only fires on the store.provisioned webhook.
//
// Guarded by INTEGRATION_ADMIN_SECRET (same contract as /stores). Response
// carries Uber's pos_data body — it contains integration config, never tokens.

import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getPosData } from '@/lib/integrations/uber-eats/provisioning'

function checkAuth(request: NextRequest): boolean {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return false
  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()

  if (!process.env.INTEGRATION_ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured', correlation_id: correlationId }, { status: 503 })
  }
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'unauthorized', correlation_id: correlationId }, { status: 401 })
  }

  const storeId = request.nextUrl.searchParams.get('store_id') ?? ''
  if (!storeId) {
    return NextResponse.json({ error: 'store_id required', correlation_id: correlationId }, { status: 400 })
  }

  const result = await getPosData(storeId, correlationId)
  return NextResponse.json(
    { ...result, correlation_id: correlationId },
    { status: result.ok ? 200 : 422 }
  )
}
