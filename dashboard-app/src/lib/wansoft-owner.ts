// BUG-019 — ownership gate for the AMALAY legacy Wansoft dataset.
//
// wansoft_daily / wansoft_waiter_categories are single-tenant AMALAY legacy tables with NO
// client_id column. Only the EXACT owner tenant may read them. Ownership is a server-side
// identifier (WANSOFT_LEGACY_CLIENT_ID), never a browser value and never `data_source` (which
// does not prove ownership — a second tenant could also be data_source='wansoft').
//
// FAIL CLOSED: if WANSOFT_LEGACY_CLIENT_ID is absent, empty, or blank, NO tenant is authorized
// (not even AMALAY). There is no dev/prod/runtime fallback — a missing security variable must
// deny, never grant.
//
// voice/coach must call ownsLegacyWansoft() AFTER withPOSAuth (server-resolved auth.clientId)
// and BEFORE any service-role query against the legacy tables.

let _warnedMissing = false

/**
 * Exact owner tenant id from server config, or null if unconfigured/blank. Returns null →
 * everything denies. Logs once, server-side, without revealing an owner (there is none to reveal).
 */
export function legacyWansoftOwner(): string | null {
  const raw = process.env.WANSOFT_LEGACY_CLIENT_ID
  const v = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (!v) {
    if (!_warnedMissing) {
      _warnedMissing = true
      console.warn('[wansoft-owner] WANSOFT_LEGACY_CLIENT_ID not configured — legacy Wansoft features denied for ALL tenants (fail closed)')
    }
    return null
  }
  return v
}

/**
 * True ONLY for the exact owner tenant. `clientId` MUST be the server-resolved auth.clientId
 * (from withPOSAuth). Absent/blank owner config → false. Any other tenant — including a
 * hypothetical second tenant with data_source='wansoft' — is denied.
 */
export function ownsLegacyWansoft(clientId: unknown): boolean {
  const owner = legacyWansoftOwner()
  if (!owner) return false
  if (typeof clientId !== 'string' || clientId.length === 0) return false
  return clientId.toLowerCase().trim() === owner
}
