import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { rappiFetch } from '@/lib/integrations/rappi/auth'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const expected = process.env.RAPPI_SECRET_ROTATION_TOKEN?.trim()
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!expected || !provided) return false

  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const response = await rappiFetch(
    '/api/v2/restaurants-integrations-public-api/webhook/NEW_ORDER/reset-secret',
    { method: 'PUT' },
  )
  const payload = await response.json().catch(() => ({})) as { secret?: unknown }

  if (!response.ok || typeof payload.secret !== 'string' || !payload.secret) {
    return NextResponse.json(
      { ok: false, error: 'RAPPI_SECRET_ROTATION_FAILED', upstreamStatus: response.status },
      { status: 502 },
    )
  }

  return NextResponse.json(
    { ok: true, secret: payload.secret },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
