// Uber Eats — List stores accessible to this app.
// GET /api/integrations/uber-eats/stores
//
// Sandbox-only endpoint. Requires:
//   Authorization: Bearer <INTEGRATION_ADMIN_SECRET>
//
// INTEGRATION_ADMIN_SECRET is a dedicated secret for internal admin endpoints.
// It must NOT be SUPABASE_SERVICE_KEY — that key is for DB operations only.
//
// Returns: store_id, name, env, count — no tokens, no credentials, no POS data.
// Used during B-3 setup to discover provider_store_id before inserting
// integration_store_mappings (B-5). Also supports dashboard store-selection UI.

import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { uberFetch } from '@/lib/integrations/uber-eats/oauth'
import { auditLog } from '@/lib/integrations/audit-logger'

interface UberStoreRow {
  store_id?: string
  name?: string
}

async function checkAuth(request: NextRequest): Promise<boolean> {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return false

  const raw = request.headers.get('authorization') ?? ''
  const provided = raw.replace(/^Bearer\s+/i, '').trim()
  if (!provided) return false

  if (provided.length !== expected.length) return false

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()

  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'not_configured', correlation_id: correlationId }, { status: 503 })
  }
  if (!process.env.INTEGRATION_ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured', correlation_id: correlationId }, { status: 503 })
  }

  if (!await checkAuth(request)) {
    return NextResponse.json({ error: 'unauthorized', correlation_id: correlationId }, { status: 401 })
  }

  const env = process.env.UBER_ENV ?? 'unset'
  if (env !== 'sandbox') {
    return NextResponse.json({ error: 'sandbox_only', env, correlation_id: correlationId }, { status: 403 })
  }

  if (!process.env.UBER_CLIENT_ID || !process.env.UBER_CLIENT_SECRET) {
    return NextResponse.json({ error: 'uber_credentials_missing', correlation_id: correlationId }, { status: 503 })
  }

  try {
    const r = await uberFetch('/v1/eats/stores', {
      method: 'GET',
      scope: 'eats.pos_provisioning',
      headers: { 'Accept-Encoding': 'gzip' },
    })

    if (!r.ok) {
      await auditLog({
        provider: 'ubereats',
        correlation_id: correlationId,
        action: 'uber.stores.list',
        response: { uber_status: r.status, ok: false },
      })
      return NextResponse.json(
        { error: 'uber_api_error', uber_status: r.status, correlation_id: correlationId },
        { status: 502 }
      )
    }

    const data = (await r.json()) as { stores?: UberStoreRow[]; next_page_token?: string }
    const stores = (data.stores ?? []).map((s) => ({
      store_id: s.store_id ?? null,
      name: s.name ?? null,
    }))

    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'uber.stores.list',
      response: { count: stores.length, env },
    })

    return NextResponse.json({ env, count: stores.length, stores, correlation_id: correlationId })
  } catch (e) {
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'uber.stores.list',
      response: { error: String(e) },
    })
    return NextResponse.json(
      { error: 'internal_error', correlation_id: correlationId },
      { status: 500 }
    )
  }
}
