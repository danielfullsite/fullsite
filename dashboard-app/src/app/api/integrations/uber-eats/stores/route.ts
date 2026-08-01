// Uber Eats — List stores accessible to this app (sandbox + production).
// GET /api/integrations/uber-eats/stores
//
// Uses client_credentials (eats.store scope) to call GET /v1/eats/stores.
// Returns store_id list — used during B-3 setup to discover the provider_store_id
// and during dashboard onboarding to let operators select their store.

import { NextResponse } from 'next/server'
import { uberFetch } from '@/lib/integrations/uber-eats/oauth'

interface UberStore {
  store_id: string
  name?: string
  status?: string
  location?: { address?: string }
}

interface UberStoresResponse {
  stores?: UberStore[]
  next_page_token?: string
}

export async function GET() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_KEY not configured' }, { status: 503 })
  }

  try {
    const r = await uberFetch('/v1/eats/stores', { scope: 'eats.store' })
    if (!r.ok) {
      const body = await r.text()
      return NextResponse.json(
        { error: `Uber API ${r.status}`, detail: body, env: process.env.UBER_ENV ?? 'unset' },
        { status: 502 }
      )
    }
    const data = (await r.json()) as UberStoresResponse
    const stores = (data.stores ?? []).map((s) => ({
      store_id: s.store_id,
      name: s.name,
      status: s.status,
      address: s.location?.address,
    }))
    return NextResponse.json({
      env: process.env.UBER_ENV ?? 'unset',
      count: stores.length,
      stores,
      next_page_token: data.next_page_token ?? null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: String(e), env: process.env.UBER_ENV ?? 'unset' },
      { status: 500 }
    )
  }
}
