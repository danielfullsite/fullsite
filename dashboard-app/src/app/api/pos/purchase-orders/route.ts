import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { isManager } from '@/lib/pos-db-policy'

/**
 * CREAR UNA ORDEN DE COMPRA — cabecera y renglones, o nada.
 *
 * El flujo viejo hacía dos POST independientes. Cuando el segundo fallaba la
 * cabecera quedaba sola: reproducido el 2026-09-18 con la orden `5529bb4c`, que
 * quedó con total $10 y cero renglones mientras la pantalla decía «Error al
 * crear la orden de compra».
 *
 * Aquí sólo se transporta. Quien garantiza la atomicidad es
 * `pos_create_purchase_order`, que valida TODAS las líneas antes de escribir y
 * commitea las dos inserciones juntas. Compensar con un DELETE no se contempla:
 * si el DELETE falla, o el navegador muere antes, el huérfano queda igual.
 *
 * El tenant lo resuelve la sesión. El cuerpo no puede traerlo.
 */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!isManager(auth.role)) return Response.json({ error: 'MANAGER_REQUIRED' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })

  const header = body.header as Record<string, unknown> | undefined
  const lines = body.lines
  if (!header || typeof header !== 'object' || Array.isArray(header) ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 200) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }
  // EL TENANT NUNCA ES ENTRADA DEL CLIENTE — en ningún nivel del cuerpo, ni
  // aunque coincida con la sesión. Una sola fuente: `withPOSAuth`.
  if ('client_id' in body) return Response.json({ error: 'CLIENT_ID_NOT_ACCEPTED' }, { status: 400 })
  if ('client_id' in header) return Response.json({ error: 'CLIENT_ID_NOT_ACCEPTED' }, { status: 400 })
  if (lines.some(l => l && typeof l === 'object' && 'client_id' in (l as Record<string, unknown>))) {
    return Response.json({ error: 'CLIENT_ID_NOT_ACCEPTED' }, { status: 400 })
  }
  // El estado tampoco: una OC nueva nace en borrador y punto.
  if ('status' in header) return Response.json({ error: 'STATUS_NOT_ACCEPTED' }, { status: 400 })

  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'PURCHASE_ORDER_UNAVAILABLE' }, { status: 503 })
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/pos_create_purchase_order`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: auth.clientId, p_header: header, p_lines: lines }),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    })
    const result = await res.json()
    if (!res.ok) {
      // Estos errores prueban que la transacción NO aplicó: el ROLLBACK ya
      // ocurrió en PostgreSQL, así que reintentar es seguro y no deja restos.
      const conocidos = ['SCOPE_REQUIRED', 'INVALID_HEADER', 'INVALID_LINES', 'INVALID_LINE',
        'SUPPLIER_REQUIRED', 'CREATED_BY_REQUIRED', 'CLIENT_ID_NOT_ACCEPTED', 'ORDER_ID_TAKEN',
        'INGREDIENT_REQUIRED', 'INGREDIENT_SCOPE_CONFLICT', 'INVALID_QUANTITY', 'INVALID_UNIT_COST',
        'UNIT_REQUIRED', 'STATUS_NOT_ACCEPTED']
      const error = conocidos.includes(result?.message) ? result.message : 'PURCHASE_ORDER_UNCONFIRMED'
      return Response.json({ error }, { status: error === 'PURCHASE_ORDER_UNCONFIRMED' ? 503 : 409 })
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'PURCHASE_ORDER_UNCONFIRMED' }, { status: 503 }) }
}
