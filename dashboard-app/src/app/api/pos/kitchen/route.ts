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
// SECURITY: además del client_id, se exige un token de cocina por-tenant
// (x-kitchen-token = HMAC(client_id, KITCHEN_TOKEN_SECRET)) para que no se pueda
// enumerar entre tenants. Sin secreto server el endpoint falla cerrado con 503;
// sin token válido falla con 401. El KDS conserva su fuente LAN/caché local.
import { kitchenTokenEnabled, verifyKitchenToken } from '@/lib/kitchen-token'

export const dynamic = 'force-dynamic'

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const LOCATION_RE = /^[a-z0-9_-]{1,100}$/i

function requestScope(request: NextRequest): { clientId: string; locationId: string } | Response {
  if (!kitchenTokenEnabled()) {
    return Response.json({ error: 'KDS_TOKEN_NOT_CONFIGURED' }, { status: 503 })
  }
  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) return Response.json({ error: 'client_id inválido' }, { status: 400 })
  if (!verifyKitchenToken(clientId, request.headers.get('x-kitchen-token'))) {
    return Response.json({ error: 'KDS_UNAUTHORIZED' }, { status: 401 })
  }
  const locationId = request.nextUrl.searchParams.get('location_id') || ''
  if (locationId && !LOCATION_RE.test(locationId)) {
    return Response.json({ error: 'location_id inválido' }, { status: 400 })
  }
  return { clientId, locationId }
}

// Kitchen-only projection — no total/subtotal/iva/propina/metodo_pago/pagos.
const KITCHEN_SELECT =
  'id,client_id,location_id,turno_id,mesa,mesero,status,items,kds_item_status,comanda_batches,created_at,updated_at,notas,order_revision,order_number'

export async function GET(request: NextRequest) {
  const scope = requestScope(request)
  if (scope instanceof Response) return scope
  const { clientId, locationId } = scope
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbUrl || !serviceKey) {
    return Response.json({ error: 'KDS_BACKEND_NOT_CONFIGURED' }, { status: 503 })
  }
  // Una terminal provisionada consulta exclusivamente su sucursal. Legacy sin
  // sucursal sólo puede resolver un turno inequívoco; nunca elegir "el último".
  const locationFilter = locationId ? `&location_id=eq.${encodeURIComponent(locationId)}` : ''
  let turnoId: string
  try {
    const tRes = await fetch(
      `${sbUrl}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(clientId)}` +
      locationFilter + `&closed_at=is.null&select=id&limit=2`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
    )
    if (!tRes.ok) throw new Error('turno_unavailable')
    const rows: unknown = await tRes.json()
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !row.id)) {
      throw new Error('turno_invalid')
    }
    if (rows.length === 0) return Response.json([], { headers: { 'Cache-Control': 'no-store' } })
    if (rows.length !== 1) return Response.json({ error: 'Turno ambiguo; configura la sucursal o revisa los turnos abiertos' }, { status: 409 })
    turnoId = rows[0].id
  } catch {
    // No ampliar a una ventana temporal: mezclaría turnos o sucursales. La UI
    // conserva sólo su caché identificada mientras vuelve a consultar.
    return Response.json({ error: 'No se pudo resolver el turno de cocina' }, { status: 502 })
  }
  const url =
    `${sbUrl}/rest/v1/pos_orders?status=in.(enviada,preparando,lista)` +
    `&client_id=eq.${encodeURIComponent(clientId)}` + (locationFilter || '&location_id=is.null') +
    `&turno_id=eq.${encodeURIComponent(turnoId)}` +
    `&select=${KITCHEN_SELECT}&order=created_at.desc`

  try {
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[pos/kitchen] supabase', res.status)
      return Response.json({ error: 'No se pudieron leer las órdenes' }, { status: 502 })
    }
    const rows = await res.json()
    if (!Array.isArray(rows)) throw new Error('kitchen_invalid_response')
    return Response.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[pos/kitchen]', e)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  // Lectura y escritura fallan cerrado: ninguna ruta con service_role puede
  // degradarse a autorización basada sólo en client_id.
  if (!kitchenTokenEnabled()) {
    return Response.json({ error: 'Token de cocina no configurado' }, { status: 503 })
  }
  const scope = requestScope(request)
  if (scope instanceof Response) return scope
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbUrl || !serviceKey) return Response.json({ error: 'Escritura de cocina no configurada' }, { status: 503 })

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Delta inválido' }, { status: 400 })
  const { order_id: orderId, item_index: itemIndex, done } = body as Record<string, unknown>
  if (typeof orderId !== 'string' || !orderId || orderId.length > 160 ||
      !Number.isSafeInteger(itemIndex) || Number(itemIndex) < 0 || Number(itemIndex) > 10_000 ||
      typeof done !== 'boolean') {
    return Response.json({ error: 'Delta inválido' }, { status: 400 })
  }

  try {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/pos_apply_kds_item_delta`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_client_id: scope.clientId,
        p_location_id: scope.locationId || null,
        p_order_id: orderId,
        p_item_index: itemIndex,
        p_done: done,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[pos/kitchen] delta rpc', res.status)
      return Response.json({ error: 'No se pudo guardar el avance' }, { status: 502 })
    }
    return Response.json({ ok: true, kds_item_status: await res.json() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[pos/kitchen] delta', error)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
