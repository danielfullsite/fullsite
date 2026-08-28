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
import { kitchenTokenEnabled, verifyKitchenToken } from '@/lib/kitchen-token'

export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const LOCATION_RE = /^[a-z0-9_-]{1,64}$/i
const SHIFT_RE = /^[\w-]{1,64}$/

// Kitchen-only projection — no total/subtotal/iva/propina/metodo_pago/pagos.
// location_id y turno_id se incluyen para que el KDS pueda VERIFICAR el aislamiento (no sólo
// confiar en el filtro): una fila con otra sucursal/turno sería un bug visible, no silencioso.
const KITCHEN_SELECT =
  'id,mesa,mesero,status,items,kds_item_status,comanda_batches,created_at,updated_at,notas,order_revision,order_number,location_id,turno_id'

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) {
    return Response.json({ error: 'client_id inválido' }, { status: 400 })
  }

  // Aislamiento por sucursal y turno (gate: factory.kds_location_scope en el KDS). Legacy-safe:
  // si el KDS no manda location_id/shift_id, el endpoint se comporta como antes (tenant-wide).
  // Cuando los manda, se filtra en la BASE — un KDS de la sucursal A jamás recibe comandas de
  // la B, ni de un turno que no es el operativo. Params inválidos → 400 (no se ignoran).
  const locationId = request.nextUrl.searchParams.get('location_id') || ''
  const shiftId = request.nextUrl.searchParams.get('shift_id') || ''
  if (locationId && !LOCATION_RE.test(locationId)) {
    return Response.json({ error: 'location_id inválido' }, { status: 400 })
  }
  if (shiftId && !SHIFT_RE.test(shiftId)) {
    return Response.json({ error: 'shift_id inválido' }, { status: 400 })
  }

  // Token de cocina por-tenant (solo se exige si KITCHEN_TOKEN_SECRET está activo).
  if (kitchenTokenEnabled() && !verifyKitchenToken(clientId, request.headers.get('x-kitchen-token'))) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  // Show orders with activity in the last 12h so ancient "enviada" rows don't pile
  // up — but filter on updated_at, NOT created_at: a table opened >12h ago that just
  // had an item added (e.g. a bowl) is still active and must appear. On creation
  // updated_at == created_at, so new orders are covered too.
  //
  // El status in (enviada,preparando,lista) EXCLUYE 'cerrada'/'cancelada': una orden histórica
  // no reaparece como activa. El filtro de turno lo refuerza en la otra dimensión: aunque una
  // orden vieja se reabriera, si es de un turno que no es el operativo, no entra.
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const scopeFilter =
    (locationId ? `&location_id=eq.${encodeURIComponent(locationId)}` : '') +
    (shiftId ? `&turno_id=eq.${encodeURIComponent(shiftId)}` : '')
  const url =
    `${SB_URL}/rest/v1/pos_orders` +
    `?status=in.(enviada,preparando,lista)` +
    `&client_id=eq.${encodeURIComponent(clientId)}` +
    scopeFilter +
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
