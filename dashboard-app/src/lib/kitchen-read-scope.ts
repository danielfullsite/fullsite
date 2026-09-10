/** Identidad de lectura capturada antes del trabajo asíncrono; no autoriza escrituras. */
export type KitchenReadScope = { clientId: string; locationId: string }
export function readKitchenScope(clientId: string): KitchenReadScope {
  return { clientId, locationId: typeof window !== 'undefined' ? localStorage.getItem('FULLSITE_LOCATION_ID') || '' : '' }
}
export function kitchenOrderInScope(row: Record<string, unknown>, scope: KitchenReadScope): boolean {
  return !!scope.clientId && row.client_id === scope.clientId &&
    (scope.locationId ? row.location_id === scope.locationId : row.location_id == null || row.location_id === '')
}

export function currentKitchenScope(): KitchenReadScope {
  return readKitchenScope(typeof window !== 'undefined' ? localStorage.getItem('fullsite_client_id') || '' : '')
}
export function kitchenScopeIsCurrent(scope: KitchenReadScope): boolean {
  const current = currentKitchenScope()
  return !!scope.clientId && current.clientId === scope.clientId && current.locationId === scope.locationId
}
/** Fast offline read. Unscoped legacy rows cannot establish tenant provenance. */
export async function readScopedKitchenCache(scope = currentKitchenScope()) {
  if (!kitchenScopeIsCurrent(scope)) return []
  const { getCachedOrders } = await import('./pos-offline-db')
  const rows = (await Promise.all(['enviada', 'preparando', 'lista'].map(status => getCachedOrders(status)))).flat()
  if (!kitchenScopeIsCurrent(scope)) return []
  const cutoff = Date.now() - 12 * 60 * 60 * 1000
  return rows.filter(row => kitchenOrderInScope(row, scope) &&
    new Date(String(row.created_at || row.updated_at || '')).getTime() >= cutoff)
}
