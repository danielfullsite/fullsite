// Uber Eats Sandbox — test order simulation endpoint.
// POST /api/integrations/uber-eats/sandbox
//
// Requires Authorization: Bearer <INTEGRATION_ADMIN_SECRET>
// Uses Vercel-side UBER_CLIENT_ID/SECRET to get a token and POST to
// /v1/eats/sandbox/store/{store_id}/order on test-api.uber.com.
// Not reachable in production (UBER_ENV must be sandbox).

import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

function checkAuth(request: NextRequest): boolean {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return false
  const raw = request.headers.get('authorization') ?? ''
  const provided = raw.replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
  } catch { return false }
}

async function getToken(): Promise<string | null> {
  const clientId = process.env.UBER_CLIENT_ID || process.env.UBER_SANDBOX_CLIENT_ID || ''
  const clientSecret = process.env.UBER_CLIENT_SECRET || process.env.UBER_SANDBOX_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) return null

  // Try without scope first — sandbox utility endpoints may not need eats.pos_provisioning
  const r = await fetch('https://sandbox-login.uber.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  if (!r.ok) return null
  const data = (await r.json()) as { access_token?: string }
  return data.access_token ?? null
}

export async function POST(request: NextRequest) {
  if (process.env.UBER_ENV !== 'sandbox') {
    return NextResponse.json({ error: 'sandbox_only' }, { status: 403 })
  }
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { store_id } = (await request.json().catch(() => ({}))) as { store_id?: string }
  const storeId = store_id || '633b57d4-237a-5a32-b249-7ceb795f1d35'

  const token = await getToken()
  if (!token) {
    return NextResponse.json({ error: 'token_failed' }, { status: 502 })
  }

  const r = await fetch(`https://test-api.uber.com/v1/eats/sandbox/store/${storeId}/order`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'delivery' }),
  })

  const body = await r.text()
  return NextResponse.json(
    { ok: r.ok, status: r.status, body },
    { status: r.ok ? 200 : 422 }
  )
}
