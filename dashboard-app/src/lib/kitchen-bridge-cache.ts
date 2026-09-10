import { kitchenScopeIsCurrent, type KitchenReadScope } from './kitchen-read-scope'

/** Scope must come from the authenticated bridge callback, never from event fields. */
export async function cacheKitchenBridgeOrder(p: Record<string, unknown>, scope: KitchenReadScope): Promise<boolean> {
  const { cacheOrder } = await import('./pos-offline-db')
  if (!kitchenScopeIsCurrent(scope)) return false
  if ((p.client_id && p.client_id !== scope.clientId) || (p.location_id && p.location_id !== scope.locationId)) return false
  await cacheOrder({
    client_id: scope.clientId,
    location_id: scope.locationId || null,
    id: p.order_id as string,
    mesa: p.mesa,
    mesero: p.mesero,
    status: 'enviada',
    items: typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []),
    personas: p.personas || 1,
    total: p.total || 0,
    turno_id: p.turno_id || null,
    notas: p.notas || null,
    comanda_batches: p.comanda_batches ? JSON.stringify(p.comanda_batches) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // Llegó por el bridge (offline): aún no está en Supabase. La marca hace que
    // getKitchenOrders la conserve en la vista aunque el poll online no la traiga,
    // hasta que sincronice (ahí se re-cachea sin la marca). Mata el "clobber".
    _bridge_unsynced: true,
  })
  return kitchenScopeIsCurrent(scope)
}
