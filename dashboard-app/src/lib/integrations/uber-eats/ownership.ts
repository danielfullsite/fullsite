// BLINDAJE B1 (P0-3): verificación de propiedad de tienda para las rutas de Uber Eats.
// Antes, las rutas tomaban store_id del body/query sin auth ni scoping → un caller
// podía controlar/secuestrar la tienda Uber de CUALQUIER restaurante. Este helper
// confirma que el store_id pertenece al client_id del caller (sesión server-side)
// antes de despachar cualquier acción.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return null
  return { apikey: key, Authorization: `Bearer ${key}` }
}

/** ¿La tienda Uber `storeId` está mapeada al tenant `clientId`? */
export async function storeBelongsToClient(storeId: string, clientId: string): Promise<boolean> {
  if (!storeId || !clientId) return false
  const H = svcHeaders()
  if (!H || !SB_URL) return false
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/integration_store_mappings` +
      `?provider=eq.ubereats&provider_store_id=eq.${encodeURIComponent(storeId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}&select=client_id&limit=1`,
      { headers: H, cache: 'no-store' }
    )
    if (!res.ok) return false
    const rows = await res.json().catch(() => [])
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

/** Resuelve el client_id dueño de una tienda (o null). Para scoping de órdenes. */
export async function clientForStore(storeId: string): Promise<string | null> {
  if (!storeId) return null
  const H = svcHeaders()
  if (!H || !SB_URL) return null
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/integration_store_mappings` +
      `?provider=eq.ubereats&provider_store_id=eq.${encodeURIComponent(storeId)}&select=client_id&limit=1`,
      { headers: H, cache: 'no-store' }
    )
    if (!res.ok) return null
    const rows = await res.json().catch(() => [])
    return Array.isArray(rows) && rows[0]?.client_id ? rows[0].client_id : null
  } catch {
    return null
  }
}
