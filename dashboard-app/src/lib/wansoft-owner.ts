// BUG-019 — ownership gate for the AMALAY legacy Wansoft dataset.
//
// wansoft_daily / wansoft_waiter_categories are single-tenant AMALAY legacy tables with NO
// client_id column. Only the EXACT owner tenant may read them. Ownership is a server-side
// identifier (env config), never a browser value and never `data_source` (which does not
// prove ownership — a second tenant could also be data_source='wansoft'). Default deny.
//
// voice/coach must call this AFTER withPOSAuth (server-resolved auth.clientId) and BEFORE
// any service-role query against the legacy tables.

/** Exact owner tenant id of the legacy Wansoft dataset (server config; defaults to amalay). */
export function legacyWansoftOwner(): string {
  return (process.env.WANSOFT_LEGACY_CLIENT_ID || 'amalay').toLowerCase().trim()
}

/**
 * True only for the exact owner tenant. `clientId` MUST be the server-resolved auth.clientId
 * (from withPOSAuth). Any other tenant — including a hypothetical second tenant with
 * data_source='wansoft' — is denied.
 */
export function ownsLegacyWansoft(clientId: unknown): boolean {
  if (typeof clientId !== 'string' || clientId.length === 0) return false
  return clientId.toLowerCase().trim() === legacyWansoftOwner()
}
