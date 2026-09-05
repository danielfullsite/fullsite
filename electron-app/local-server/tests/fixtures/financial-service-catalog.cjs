'use strict'
const { CatalogStore } = require('../../core/catalog-store')

// Shared preparation for money integration tests. Orders still go through the
// real domain, persisted catalog, save/send and NDJSON transaction boundary.
module.exports = async function prepareFinancialCatalog(directory, restaurantId, branchId = null) {
  const catalog = new CatalogStore({ directory, restaurantId, branchId, fetchImpl: async () => Response.json({
    schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: restaurantId,
    refreshed_at: '2026-09-05T01:00:00Z',
    categories: [{ id: 'food', name: 'Comida', items: [{ id: 'soup', name: 'Sopa', price: 100 }] }],
    config: { id: restaurantId, display_name: 'Laboratorio financiero', timezone: 'America/Monterrey', mesas: 10, iva_rate: 0 },
    settings: { 'pos.station_routing': { cocina: ['food'], barra: [], caja: [] }, 'pos.no_print_stations': ['cocina', 'barra', 'caja'] },
    modifiers: { groups: [], mods: [], item_links: [], category_links: [] },
    payment_methods: [{ id: 'cash', name: 'Efectivo', type: 'cash', commission_pct: 0 }],
  }) })
  if (!catalog.status().ready) await catalog.refresh('synthetic-fixture-session')
  return catalog
}
