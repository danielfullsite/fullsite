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

// Kitchen-only projection — no total/subtotal/iva/propina/metodo_pago/pagos.
const KITCHEN_SELECT =
  'id,mesa,mesero,status,items,kds_item_status,comanda_batches,created_at,updated_at,notas,order_revision,order_number'

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) {
    return Response.json({ error: 'client_id inválido' }, { status: 400 })
  }

  // Token de cocina por-tenant (solo se exige si KITCHEN_TOKEN_SECRET está activo).
  if (kitchenTokenEnabled() && !verifyKitchenToken(clientId, request.headers.get('x-kitchen-token'))) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  // Qué muestra el KDS — regla de la junta 2026-09-01: las comandas del TURNO
  // ABIERTO, y nada más. Tres casos:
  //
  //   1. Turno abierto  → filtro exacto `turno_id = <turno abierto>`. La versión
  //      anterior filtraba `updated_at >= opened_at`, y una orden de AYER que
  //      cocina tocaba (toggle de item escribe kds_item_status) actualizaba su
  //      updated_at y SE RECALIFICABA como de hoy — ese era el mecanismo del
  //      "empalme" de órdenes de días distintos en el tablero.
  //   2. Sin turno abierto (tras el Corte Z, o antes de abrir) → tablero VACÍO.
  //      El POS no puede mandar comandas sin turno (TurnoGate + save-order las
  //      rechaza), así que aquí no hay nada legítimo que mostrar; la ventana de
  //      12 h que había de respaldo era la que resucitaba órdenes viejas.
  //   3. Turno IRRESOLUBLE (falló la consulta) → modo degradado: ventana de
  //      12 h por updated_at, como antes, para que un blip de red no deje a
  //      cocina ciega en plena operación.
  let turnoFilter: string | null = null
  let degradado = false
  try {
    const tRes = await fetch(
      `${SB_URL}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(clientId)}` +
      `&closed_at=is.null&select=id&order=opened_at.desc&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
    )
    if (tRes.ok) {
      const tRows = await tRes.json().catch(() => []) as Array<{ id?: string }>
      const turnoId = Array.isArray(tRows) ? tRows[0]?.id : undefined
      if (turnoId) {
        turnoFilter = `&turno_id=eq.${encodeURIComponent(turnoId)}`
      } else {
        // Caso 2: el server CONFIRMÓ que no hay turno → tablero limpio.
        return Response.json([], { headers: { 'Cache-Control': 'no-store' } })
      }
    } else {
      degradado = true
    }
  } catch { degradado = true }
  const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const url =
    `${SB_URL}/rest/v1/pos_orders` +
    `?status=in.(enviada,preparando,lista)` +
    `&client_id=eq.${encodeURIComponent(clientId)}` +
    (degradado ? `&updated_at=gte.${encodeURIComponent(cutoff12h)}` : turnoFilter!) +
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
