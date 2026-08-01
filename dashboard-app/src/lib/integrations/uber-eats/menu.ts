// Uber Eats — Menu management: upload, update, OOS, restore.
// All operations log to integration_audit_log with redacted payloads.

import { uberFetch } from './oauth'
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

export interface OOSItem {
  item_id: string
  /** ISO 8601 — omit to suspend indefinitely. */
  suspend_until?: string
}

export async function uploadMenu(
  storeId: string,
  menu: UberMenuUpload,
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/menus`, {
        method: 'PUT',
        scope: 'eats.pos_provisioning',
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

export async function markItemsOOS(
  storeId: string,
  items: OOSItem[],
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/items/deactivations`, {
        method: 'POST', scope: 'eats.pos_provisioning',
        body: JSON.stringify({ items }),
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'menu.oos',
      request: { store_id: storeId, item_ids: items.map(i => i.item_id) },
      response: errText ? { error: errText } : { status: 'deactivated' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function restoreItems(
  storeId: string,
  itemIds: string[],
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/items/activations`, {
        method: 'POST', scope: 'eats.pos_provisioning',
        body: JSON.stringify({ item_ids: itemIds }),
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'menu.restore',
      request: { store_id: storeId, item_ids: itemIds },
      response: errText ? { error: errText } : { status: 'activated' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
