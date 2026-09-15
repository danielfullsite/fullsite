// Rappi — PING de disponibilidad, POR TIENDA.
//
// CONTRATO OFICIAL (dev-portal.rappi.com/en/webhook-events/, evento PING,
// confirmado el 2026-08-29):
//
//   Rappi envía:   { "store_id": 999 }
//   Debe responder: { "status": "OK", "description": "Store on" }
//
//   · `status` es OBLIGATORIO. Si viene null o distinto de "OK", Rappi da la
//     tienda por NO DISPONIBLE.
//   · Frecuencia: cada 3 minutos. 2 strikes antes de generar incidente,
//     1 minuto de gracia.
//   · Textual del portal: *"This Ping must be implemented for each store and
//     not on a central server."*
//
// QUE ESTABA MAL
//
// 1. El webhook respondía `{ ok: true, event: 'ping' }` — **sin campo `status`**.
//    Según el contrato, eso es exactamente "tienda no disponible". Le estábamos
//    diciendo a Rappi que la tienda estaba caída cada 3 minutos.
//
// 2. `api/integrations/rappi/health` respondía `{ status: 'OK' }` **siempre**,
//    sin mirar nada, y es un endpoint CENTRAL. Eso viola la regla de por-tienda
//    y, peor, es una mentira útil: le asegura a Rappi que la tienda opera aunque
//    el tenant no esté mapeado — y entonces mandan órdenes que no podemos
//    atender, que terminan en la DLQ como `unmapped_store`.
//
// La regla aquí es la misma que en el resto del proyecto: fallar CERRADO. Si no
// sabemos a qué restaurante pertenece la tienda, se responde no-disponible.

/** Respuesta que Rappi interpreta como "tienda disponible". */
export interface RappiPingResponse {
  status: 'OK' | 'UNAVAILABLE'
  description?: string
}

export const PING_OK: RappiPingResponse = { status: 'OK', description: 'Store on' }

export function pingUnavailable(motivo: string): RappiPingResponse {
  return { status: 'UNAVAILABLE', description: motivo }
}

/** Extrae el store_id del payload del PING. Rappi lo manda numérico. */
export function extraerStoreId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>).store_id
    ?? (payload as Record<string, unknown>).storeId
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  return s.length ? s : null
}

/** ¿El payload es un PING? Rappi lo marca por `event`/`type`, y algunos sobres sólo traen store_id. */
export function esPing(payload: unknown, eventType: string | null): boolean {
  if (eventType && /ping/i.test(eventType)) return true
  if (!payload || typeof payload !== 'object') return false
  const keys = Object.keys(payload as Record<string, unknown>)
  // Un sobre que SOLO trae store_id es el PING documentado.
  return keys.length === 1 && (keys[0] === 'store_id' || keys[0] === 'storeId')
}

/**
 * Decide la respuesta del PING para una tienda concreta.
 *
 * @param storeId    el que mandó Rappi
 * @param buscarTenant  resuelve provider_store_id → client_id (null si no mapeada)
 */
export async function responderPing(
  storeId: string | null,
  buscarTenant: (storeId: string) => Promise<string | null>,
): Promise<RappiPingResponse> {
  // Sin store_id no se puede afirmar nada sobre ninguna tienda. Falla cerrado.
  if (!storeId) return pingUnavailable('missing store_id')

  let clientId: string | null
  try {
    clientId = await buscarTenant(storeId)
  } catch {
    // No poder consultar el mapeo no es lo mismo que no existir, pero desde
    // afuera es indistinguible: si no podemos servir la orden, no digamos que sí.
    return pingUnavailable('mapping lookup failed')
  }

  if (!clientId) return pingUnavailable('store not mapped')
  return PING_OK
}
