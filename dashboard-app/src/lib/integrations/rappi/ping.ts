export interface RappiPingResponse {
  status: 'OK' | 'UNAVAILABLE'
  description?: string
}

export const PING_OK: RappiPingResponse = { status: 'OK', description: 'Store on' }

function unavailable(description: string): RappiPingResponse {
  return { status: 'UNAVAILABLE', description }
}

export function extraerStoreId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const raw = record.store_id ?? record.storeId
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  return value || null
}

export function esPing(payload: unknown, eventType: string | null): boolean {
  if (eventType && /ping/i.test(eventType)) return true
  if (!payload || typeof payload !== 'object') return false
  const keys = Object.keys(payload as Record<string, unknown>)
  return keys.length === 1 && (keys[0] === 'store_id' || keys[0] === 'storeId')
}

/** Rappi exige disponibilidad por tienda. Ante duda, falla cerrado. */
export async function responderPing(
  storeId: string | null,
  resolveTenant: (storeId: string) => Promise<string | null>,
): Promise<RappiPingResponse> {
  if (!storeId) return unavailable('missing store_id')
  try {
    return (await resolveTenant(storeId)) ? PING_OK : unavailable('store not mapped')
  } catch {
    return unavailable('mapping lookup failed')
  }
}
