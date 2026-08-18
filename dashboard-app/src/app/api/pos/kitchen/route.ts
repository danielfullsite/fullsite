import { NextRequest } from 'next/server'

// GET /api/pos/kitchen?client_id=amalay
//
// Read path for login-less kitchen displays (KDS). Two constraints make a direct
// Supabase read impossible from a KDS screen:
//   1. pos_orders RLS has no anon policy → the anon key sees 0 rows.
//   2. A KDS on a separate machine loads over https and the local-server bridge is
//      ws://<lan-ip>:7717 — a ws:// to a non-localhost host from an https page is
//      blocked as mixed content, so the LAN WebSocket never connects.
//
// This same-origin endpoint resolves the rows server-side with the service key,
// strictly scoped to one tenant's active kitchen orders. It returns ONLY
// kitchen-relevant columns — never totals, payments, tips or customer data — so the
// surface is the least-sensitive slice of the order (what is being cooked).
//
// SECURITY NOTE: this is currently gated only by client_id (like get_public_menu).
// Follow-up: bind it to a per-tenant kitchen token so it cannot be enumerated across
// tenants. Tracked as a post-install hardening item.
export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

// Kitchen-only projection — no total/subtotal/iva/propina/metodo_pago/pagos.
const KITCHEN_SELECT =
  'id,mesa,mesero,status,items,kds_item_status,comanda_batches,created_at,notas,order_revision,order_number'

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) {
    return Response.json({ error: 'client_id inválido' }, { status: 400 })
  }

  // Last 12h of active orders — mirrors getKitchenOrders() so ancient "enviada"
  // rows don't pile up on the screen.
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const url =
    `${SB_URL}/rest/v1/pos_orders` +
    `?status=in.(enviada,preparando,lista)` +
    `&client_id=eq.${encodeURIComponent(clientId)}` +
    `&created_at=gte.${encodeURIComponent(cutoff)}` +
    `&select=${KITCHEN_SELECT}` +
    `&order=created_at.desc`

  try {
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[pos/kitchen] supabase', res.status)
      return Response.json({ error: 'No se pudieron leer las órdenes' }, { status: 502 })
    }
    const rows = await res.json()
    return Response.json(Array.isArray(rows) ? rows : [], {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[pos/kitchen]', e)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
