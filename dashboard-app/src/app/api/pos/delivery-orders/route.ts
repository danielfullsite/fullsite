import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

// Server-side read/update of delivery_orders (Uber/Rappi) for the POS/KDS.
//
// WHY THIS EXISTS: delivery_orders is RLS tenant-scoped for `authenticated` via
// private.user_has_client_access(client_id) (see docs/release/delivery-orders-rls.sql,
// mirror of validated staging). The kitchen used to read it with the ANON key,
// which is denied under that model → the delivery comanda never appeared.
// This endpoint reads/writes with service_role and resolves client_id from the
// authenticated session (withPOSAuth) — NEVER from a client-supplied value
// (the old _cid()/getClientId() were client-side and spoofeable).

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!

function svcHeaders() {
  const k = process.env.SUPABASE_SERVICE_KEY!
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }
}

// PostgREST filter fragments are built from validated inputs only.
const CSV_RE = /^[a-z0-9_,-]{1,120}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  }

  const sp = request.nextUrl.searchParams
  const filters: string[] = [
    `client_id=eq.${encodeURIComponent(auth.clientId)}`, // server-resolved tenant
    'select=*',
    'order=created_at.desc',
  ]
  const status = sp.get('status')
  if (status && CSV_RE.test(status)) filters.push(`status=in.(${status})`)
  const platform = sp.get('platform')
  if (platform && CSV_RE.test(platform)) filters.push(`platform=in.(${platform})`)
  const since = sp.get('since')
  if (since && ISO_RE.test(since)) filters.push(`created_at=gte.${encodeURIComponent(since)}`)

  const res = await fetch(`${SB_URL()}/rest/v1/delivery_orders?${filters.join('&')}`, {
    headers: svcHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[delivery-orders] read error', res.status)
    return Response.json({ error: 'DB_ERROR' }, { status: 502 })
  }
  // Same shape as the previous direct REST read (array of rows) — callers unchanged.
  return Response.json(await res.json())
}

// Whitelisted columns the POS delivery screen may update. client_id/id/platform
// are never mutable from the client.
const PATCHABLE = new Set([
  'status', 'updated_at', 'ready_at', 'picked_up_at', 'cancelled_at',
  'en_route_at', 'delivered_at', 'closed_at', 'notes', 'driver_name', 'driver_phone',
])

export async function PATCH(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  }

  const body = (await request.json().catch(() => null)) as { id?: string; patch?: Record<string, unknown> } | null
  if (!body?.id || typeof body.id !== 'string' || !body.patch || typeof body.patch !== 'object') {
    return Response.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body.patch)) if (PATCHABLE.has(k)) safe[k] = v
  if (Object.keys(safe).length === 0) {
    return Response.json({ error: 'NO_ALLOWED_FIELDS' }, { status: 400 })
  }

  // Scoped to the authenticated tenant — an order from another client_id won't match.
  const res = await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?id=eq.${encodeURIComponent(body.id)}&client_id=eq.${encodeURIComponent(auth.clientId)}`,
    { method: 'PATCH', headers: { ...svcHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(safe) }
  )
  if (!res.ok) {
    console.error('[delivery-orders] patch error', res.status)
    return Response.json({ error: 'DB_ERROR' }, { status: 502 })
  }
  return Response.json({ ok: true })
}
