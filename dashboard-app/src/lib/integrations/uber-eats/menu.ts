// Uber Eats — Menu management: upload, single-item update, OOS, restore.
// All operations log to integration_audit_log with redacted payloads.
//
// Endpoints (verified against developer.uber.com, 2026-08-06):
//   PUT  /v2/eats/stores/{store_id}/menus                    — full menu upload (scope eats.store)
//   POST /v2/eats/stores/{store_id}/menus/items/{item_id}    — sparse Update Item, 204 (scope eats.store)
//        Out-of-stock is expressed via suspension_info.suspension.suspend_until
//        (unix seconds; null/past = available). Menu must exist first or Uber 404s.
//
// The previous /items/deactivations and /items/activations endpoints do NOT
// exist in Uber's current documentation (audit finding #2 BROKEN) — removed.

import { uberFetch, SCOPE_STORE } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export interface UberMenuUpload {
  menus: Array<{
    id: string
    title: Record<string, string>
    service_availability: Array<{
      day_of_week: string[]
      time_period: Array<{ start_time: string; end_time: string }>
    }>
    category_ids: string[]
  }>
  categories: Array<{
    id: string
    title: Record<string, string>
    entities: Array<{ id: string; type: 'ITEM' }>
  }>
  items: Array<{
    id: string
    external_data: string
    title: Record<string, string>
    description?: Record<string, string>
    price_info: { price: number; currency_code: string }
    modifier_group_ids?: string[]
    tax_info?: { tax_rate: number }
  }>
  modifier_groups?: Array<{
    id: string
    title: Record<string, string>
    quantity_info: { quantity: { min_permitted: number; max_permitted: number } }
    modifier_options: Array<{
      id: string
      title: Record<string, string>
      price_info: { price: number; currency_code: string }
    }>
  }>
}

// ─── Update Item (sparse) — official UpdateItemConfiguration subset ──────────

export interface UberSuspension {
  /** Unix timestamp in seconds; null or past time = item available. */
  suspend_until: number | null
  reason?: string | null
}

export interface UpdateItemConfiguration {
  price_info?: { price: number; core_price?: number }
  suspension_info?: {
    suspension: UberSuspension | null
    overrides?: Array<{
      context_type: string
      context_value: string
      suspension: UberSuspension
    }>
  }
  menu_type?: 'MENU_TYPE_FULFILLMENT_DELIVERY' | 'MENU_TYPE_FULFILLMENT_PICK_UP' | 'MENU_TYPE_FULFILLMENT_DINE_IN'
}

export interface OOSItem {
  item_id: string
  /** ISO 8601 — omit to suspend indefinitely. */
  suspend_until?: string
}

// Far-future unix timestamp used for "suspend indefinitely" (Uber's own docs
// example uses a large epoch for open-ended suspensions).
const SUSPEND_INDEFINITELY = 8640000000

export async function uploadMenu(
  storeId: string,
  menu: UberMenuUpload,
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v2/eats/stores/${storeId}/menus`, {
        method: 'PUT',
        tokenType: 'marketplace',
        scope: SCOPE_STORE,
        body: JSON.stringify(menu),
      }),
      { maxAttempts: 3, baseDelayMs: 1000 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'menu.upload',
      request: { store_id: storeId, items_count: menu.items.length, categories_count: menu.categories.length },
      response: errText ? { error: errText } : { status: 'accepted' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'menu.upload', response: { error: String(e) }, duration_ms: Date.now() - t0 })
    return { ok: false, error: String(e) }
  }
}

/**
 * Sparse update of a single item (price, suspension, fulfillment type).
 * POST /v2/eats/stores/{store_id}/menus/items/{item_id} → 204 No Content.
 * This is the endpoint Uber's "Menu — Update Item/modifier" validation observes.
 */
export async function updateItem(
  storeId: string,
  itemId: string,
  config: UpdateItemConfiguration,
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v2/eats/stores/${encodeURIComponent(storeId)}/menus/items/${encodeURIComponent(itemId)}`, {
        method: 'POST',
        tokenType: 'marketplace',
        scope: SCOPE_STORE,
        body: JSON.stringify(config),
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'menu.update_item',
      request: { store_id: storeId, item_id: itemId, fields: Object.keys(config) },
      response: errText ? { error: errText } : { status: 'updated' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'menu.update_item', request: { store_id: storeId, item_id: itemId }, response: { error: String(e) }, duration_ms: Date.now() - t0 })
    return { ok: false, error: String(e) }
  }
}

function toUnixSeconds(iso?: string): number {
  if (!iso) return SUSPEND_INDEFINITELY
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : SUSPEND_INDEFINITELY
}

/** Mark items out-of-stock via per-item suspension (official Update Item mechanism). */
export async function markItemsOOS(
  storeId: string,
  items: OOSItem[],
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const failures: string[] = []
  for (const item of items) {
    const result = await updateItem(storeId, item.item_id, {
      suspension_info: {
        suspension: { suspend_until: toUnixSeconds(item.suspend_until), reason: 'OUT_OF_STOCK' },
      },
    }, correlationId)
    if (!result.ok) failures.push(`${item.item_id}: ${result.error}`)
  }
  await auditLog({
    provider: 'ubereats', correlation_id: correlationId, action: 'menu.oos',
    request: { store_id: storeId, item_ids: items.map(i => i.item_id) },
    response: failures.length ? { error: failures.join('; ') } : { status: 'suspended' },
  })
  return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true }
}

/** Restore items to availability by clearing their suspension. */
export async function restoreItems(
  storeId: string,
  itemIds: string[],
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const failures: string[] = []
  for (const itemId of itemIds) {
    const result = await updateItem(storeId, itemId, {
      suspension_info: { suspension: null },
    }, correlationId)
    if (!result.ok) failures.push(`${itemId}: ${result.error}`)
  }
  await auditLog({
    provider: 'ubereats', correlation_id: correlationId, action: 'menu.restore',
    request: { store_id: storeId, item_ids: itemIds },
    response: failures.length ? { error: failures.join('; ') } : { status: 'restored' },
  })
  return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true }
}
