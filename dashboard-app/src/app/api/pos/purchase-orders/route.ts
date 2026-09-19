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
  // `created_by` es PROCEDENCIA. Quién hizo esto lo sabe la sesión, no el
  // cuerpo: aceptarlo del cliente permitiría firmar una orden a nombre de otra
  // persona. Si hiciera falta registrar a un tercero, sería OTRO campo.
  if ('created_by' in header) return Response.json({ error: 'CREATED_BY_NOT_ACCEPTED' }, { status: 400 })
  // Los importes y la tasa los calcula el servidor desde las líneas y la
  // configuración del restaurante. El cliente no declara su propio total.
  for (const campo of ['iva', 'total', 'subtotal', 'iva_rate', 'tax_rate']) {
    if (campo in header) return Response.json({ error: 'AMOUNTS_NOT_ACCEPTED' }, { status: 400 })
  }
  // UN NÚMERO TIENE QUE SER UN NÚMERO.
  //
  // En PostgreSQL el tipo `numeric` ordena NaN por ENCIMA de todo número, no
  // fuera del orden: `NaN <= 0` es FALSE. Así que la guarda de cantidad de
  // `pos_create_purchase_order` lo dejaba pasar, y el 2026-09-18 una OC enviada
  // con `quantity_ordered: "NaN"` se guardó con `subtotal = NaN` y
  // `total = NaN`. La fila se ve normal hasta que alguien suma.
  //
  // La RPC ya lo rechaza. Esto lo para una capa antes —sin abrir transacción— y
  // con un código que dice QUÉ renglón, que es lo que la pantalla necesita para
  // señalarlo. `Number('')` es 0, por eso la cadena vacía se descarta aparte.
  const finito = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  for (const [i, cruda] of lines.entries()) {
    if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) {
      return Response.json({ error: 'INVALID_LINE', renglon: i + 1 }, { status: 400 })
    }
    const linea = cruda as Record<string, unknown>
    const cantidad = finito(linea.quantity_ordered)
    if (cantidad === null || cantidad <= 0) {
      return Response.json({ error: 'INVALID_QUANTITY', renglon: i + 1 }, { status: 400 })
    }
    const costo = finito(linea.unit_cost)
    if (costo === null || costo < 0) {
      return Response.json({ error: 'INVALID_UNIT_COST', renglon: i + 1 }, { status: 400 })
    }
  }
  const actor = auth.staffName?.trim() || auth.staffId
  if (!actor) return Response.json({ error: 'ACTOR_REQUIRED' }, { status: 403 })

  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'PURCHASE_ORDER_UNAVAILABLE' }, { status: 503 })
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/pos_create_purchase_order`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: auth.clientId, p_created_by: actor, p_header: header, p_lines: lines }),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    })
    const result = await res.json()
    if (!res.ok) {
      // Estos errores prueban que la transacción NO aplicó: el ROLLBACK ya
      // ocurrió en PostgreSQL, así que reintentar es seguro y no deja restos.
      const conocidos = ['SCOPE_REQUIRED', 'INVALID_HEADER', 'INVALID_LINES', 'INVALID_LINE',
        'SUPPLIER_REQUIRED', 'CREATED_BY_REQUIRED', 'CLIENT_ID_NOT_ACCEPTED', 'ORDER_ID_TAKEN',
        'INGREDIENT_REQUIRED', 'INGREDIENT_SCOPE_CONFLICT', 'INVALID_QUANTITY', 'INVALID_UNIT_COST',
        'UNIT_REQUIRED', 'STATUS_NOT_ACCEPTED', 'CREATED_BY_NOT_ACCEPTED', 'AMOUNTS_NOT_ACCEPTED']
      const error = conocidos.includes(result?.message) ? result.message : 'PURCHASE_ORDER_UNCONFIRMED'
      return Response.json({ error }, { status: error === 'PURCHASE_ORDER_UNCONFIRMED' ? 503 : 409 })
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'PURCHASE_ORDER_UNCONFIRMED' }, { status: 503 }) }
}
