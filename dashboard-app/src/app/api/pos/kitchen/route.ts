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
// SECURITY: el client_id es un slug adivinable, así que NO basta. La lectura se ata a un
// token por-tenant (x-kitchen-token = HMAC(client_id, KITCHEN_TOKEN_SECRET)).
//
// Se exige SIEMPRE. Sin KITCHEN_TOKEN_SECRET no se autoriza a nadie — antes era opt-in y
// sin secreto servía abierto, con el resultado de que cualquiera con un slug leía la
// operación en vivo de otro restaurante. Ver lib/kitchen-token.ts y
// docs/security/ACTIVAR-KITCHEN-TOKEN.md.
import { kitchenSecretPresente, verifyKitchenToken } from '@/lib/kitchen-token'

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

  // Token de cocina por-tenant. Se exige siempre.
  //
  // El log distingue los dos motivos porque en operación se ven igual —la pantalla dice
  // "sin comandas"— pero se arreglan distinto: uno es provisionar la pantalla, el otro es
  // que falta la variable en el despliegue y NINGUNA pantalla va a funcionar.
  if (!kitchenSecretPresente()) {
    console.error(
      '[pos/kitchen] KITCHEN_TOKEN_SECRET no está configurada: se deniega todo. ' +
        'Ver docs/security/ACTIVAR-KITCHEN-TOKEN.md'
    )
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }
  if (!verifyKitchenToken(clientId, request.headers.get('x-kitchen-token'))) {
    console.warn(`[pos/kitchen] token inválido o ausente para client_id=${clientId}`)
    return Response.json({ error: 'no autorizado' }, { status: 401 })
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
