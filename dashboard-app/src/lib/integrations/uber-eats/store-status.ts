// Uber Eats — normalización del estado abierto/cerrado de una tienda.
//
// POR QUE EXISTE
//
// Uber usa enums distintos para LEER y para ESCRIBIR el estado de una tienda, y el
// proyecto ya se tropezó con eso una vez del lado de la escritura: `update-store-status`
// rechazaba `PAUSED` como valor desconocido porque el GET devuelve `PAUSED` pero el POST
// espera `OFFLINE` (documentado en docs/integrations/uber-eats/CERTIFICATION.md).
//
// El mismo desajuste seguía vivo del lado de la LECTURA, en dos lugares:
//
//   delivery-store.ts:79   (data.store_status ?? data.status) === 'ACTIVE'
//   webhook/route.ts:681   p.store_status === 'ACTIVE' || p.is_open === true
//
// Uber responde `ONLINE`, nunca `ACTIVE`. Evidencia de la corrida de certificación
// 33447286178 del 2026-08-31, GET /v1/delivery/store/{id}/status:
//
//   { "is_open": false, "status": "ONLINE" }
//
// Ese `is_open:false` lo calculamos nosotros, no lo manda Uber — y contradice al propio
// GET /v1/delivery/store/{id}, que en el mismo instante devolvió
// `orderability: { status:"ONLINE", is_visible:true, is_orderable:true }`.
//
// Consecuencia: toda tienda abierta se leía como cerrada, y el webhook de estado
// persistía `store_open:false` en `integration_store_mappings`.

/** Valores con los que Uber reporta una tienda disponible para ordenar. */
const ABIERTO = new Set(['ONLINE', 'ACTIVE', 'OPEN'])

/** Valores con los que Uber reporta una tienda no disponible. */
const CERRADO = new Set(['OFFLINE', 'PAUSED', 'CLOSED', 'INACTIVE'])

export interface UberStatusShape {
  /** Algunas respuestas traen el booleano ya resuelto — si viene, manda. */
  is_open?: boolean
  status?: string
  store_status?: string
}

/**
 * Decide si la tienda está abierta a partir de lo que respondió Uber.
 *
 * Precedencia:
 *   1. `is_open` explícito de Uber (si lo manda, es la fuente).
 *   2. `store_status` / `status` contra los enums conocidos.
 *   3. `null` cuando el valor no se reconoce — NO se asume cerrada.
 *
 * Devolver `null` en vez de `false` es deliberado: un enum nuevo de Uber no debe
 * traducirse en "cerrada" en silencio, que es justo como este bug pasó desapercibido.
 */
export function normalizeStoreOpen(data: UberStatusShape | null | undefined): boolean | null {
  if (!data) return null
  if (typeof data.is_open === 'boolean') return data.is_open

  const raw = (data.store_status ?? data.status ?? '').trim().toUpperCase()
  if (!raw) return null
  if (ABIERTO.has(raw)) return true
  if (CERRADO.has(raw)) return false

  console.warn('[uber] estado de tienda no reconocido:', raw)
  return null
}

/** Etiqueta cruda tal como la mandó Uber, para evidencia y auditoría. */
export function rawStoreStatus(data: UberStatusShape | null | undefined): string | undefined {
  return data?.store_status ?? data?.status
}
