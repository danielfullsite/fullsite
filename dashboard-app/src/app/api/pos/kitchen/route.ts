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
// SECURITY: además del client_id, se ata a un token de cocina por-tenant
// (x-kitchen-token = HMAC(client_id, KITCHEN_TOKEN_SECRET)) para que no se pueda
// enumerar entre tenants. OPT-IN: si KITCHEN_TOKEN_SECRET no está seteado, opera
// abierto igual que antes (backward-compatible). Ver lib/kitchen-token.ts.
import { evaluarTokenCocina } from '@/lib/kitchen-token'

export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

// Kitchen-only projection — no total/subtotal/iva/propina/metodo_pago/pagos.
const KITCHEN_SELECT =
  'id,mesa,mesero,status,items,kds_item_status,comanda_batches,created_at,updated_at,notas,order_revision,order_number'

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) {
    return Response.json({ error: 'client_id inválido' }, { status: 400 })
  }

  // Token de cocina por-tenant. Rollout off → grace → strict: ver kitchen-token.ts.
  // Sin KITCHEN_TOKEN_SECRET el modo es `off` y esto no hace nada, igual que antes.
  const veredicto = evaluarTokenCocina(clientId, request.headers.get('x-kitchen-token'))
  if (!veredicto.permitir) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }
  if (veredicto.reportar) {
    // Modo grace: la pantalla no trae token válido pero se le sirve igual, para no
    // dejar la cocina sin comandas mientras se provisiona. Se deja rastro de CUÁL
    // pantalla falta — sin el token, que es un secreto.
    console.warn('[kitchen-token] sin token válido, servido en modo grace', {
      client_id: clientId,
      trae_token: Boolean(request.headers.get('x-kitchen-token')),
      ua: request.headers.get('user-agent')?.slice(0, 80) ?? null,
    })
  }

  // Show orders with activity in the last 12h so ancient "enviada" rows don't pile
  // up — but filter on updated_at, NOT created_at: a table opened >12h ago that just
  // had an item added (e.g. a bowl) is still active and must appear. On creation
  // updated_at == created_at, so new orders are covered too.
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const url =
    `${SB_URL}/rest/v1/pos_orders` +
    `?status=in.(enviada,preparando,lista)` +
    `&client_id=eq.${encodeURIComponent(clientId)}` +
    `&updated_at=gte.${encodeURIComponent(cutoff)}` +
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
