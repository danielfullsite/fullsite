// Uber Eats — List stores accessible to this app.
// GET /api/integrations/uber-eats/stores
//
// Sandbox-only diagnostic endpoint. Requires:
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

// TEMPORARY DIAGNOSTIC — emits SHA-256 partial fingerprints to Vercel logs.
// Lets us verify whether the configured secret and the provided token hash to
// the same value without ever logging the raw strings.
// REMOVE before marking B-3 complete.
async function sha256Fp(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

async function checkAuth(request: NextRequest): Promise<boolean> {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return false

  const raw = request.headers.get('authorization') ?? ''
  // Case-insensitive Bearer prefix; trim removes accidental whitespace/newlines
  const provided = raw.replace(/^Bearer\s+/i, '').trim()
  if (!provided) return false

  // TEMPORARY DIAGNOSTIC — fingerprints only, never raw values
  const [expFp, provFp] = await Promise.all([sha256Fp(expected), sha256Fp(provided)])
  console.log(
    `[uber-stores] auth_diagnostic exp_len=${expected.length} got_len=${provided.length}` +
    ` exp_fp=${expFp} got_fp=${provFp} lengths_match=${expected.length === provided.length}`
  )

  if (provided.length !== expected.length) return false

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()

  // Guard 0: required server-side secrets must exist
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'not_configured', correlation_id: correlationId }, { status: 503 })
  }
  if (!process.env.INTEGRATION_ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured', correlation_id: correlationId }, { status: 503 })
  }

  // Guard 1: admin authentication via dedicated INTEGRATION_ADMIN_SECRET
  if (!await checkAuth(request)) {
    return NextResponse.json({ error: 'unauthorized', correlation_id: correlationId }, { status: 401 })
  }

  // Guard 2: sandbox only — prevents accidental use against production stores
  const env = process.env.UBER_ENV ?? 'unset'
  if (env !== 'sandbox') {
    return NextResponse.json({ error: 'sandbox_only', env, correlation_id: correlationId }, { status: 403 })
  }

  // Guard 3: Uber credentials must be configured
  if (!process.env.UBER_CLIENT_ID || !process.env.UBER_CLIENT_SECRET) {
    return NextResponse.json({ error: 'uber_credentials_missing', correlation_id: correlationId }, { status: 503 })
  }

  try {
    const r = await uberFetch('/v1/eats/stores', {
      method: 'GET',
      scope: 'eats.store',
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
    // Strip everything except store_id and name — no POS data, no contact emails, no tokens
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
