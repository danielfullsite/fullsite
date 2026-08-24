// Uber Eats — Menu management: upload, update, OOS, restore.
// All operations log to integration_audit_log with redacted payloads.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export type UberLocalizedText =
  | Record<string, string>
  | { translations: Record<string, string> }

export interface UberMenuUpload {
  menus: Array<{
    id: string
    title: UberLocalizedText
    service_availability: Array<{
      day_of_week: string | string[]
      time_periods?: Array<{ start_time: string; end_time: string }>
      /** Legacy Fullsite field kept only so persisted payloads can be repaired at upload time. */
      time_period?: Array<{ start_time: string; end_time: string }>
    }>
    category_ids: string[]
  }>
  categories: Array<{
    id: string
    title: UberLocalizedText
    entities: Array<{ id: string; type: 'ITEM' }>
  }>
  items: Array<{
    id: string
    external_data: string
    title: UberLocalizedText
    description?: UberLocalizedText
    price_info: { price: number; currency_code: string }
    modifier_group_ids?: string[]
    tax_info?: { tax_rate: number }
  }>
  modifier_groups?: Array<{
    id: string
    title: UberLocalizedText
    quantity_info: { quantity: { min_permitted: number; max_permitted: number } }
    modifier_options: Array<{
      id: string
      title: UberLocalizedText
      price_info: { price: number; currency_code: string }
    }>
  }>
}

function withDefaultLocale(text: UberLocalizedText): { translations: Record<string, string> } {
  const nested = (text as { translations?: unknown }).translations
  const translations = nested && typeof nested === 'object'
    ? nested as Record<string, string>
    : text as Record<string, string>
  const fallback = translations.default || translations.es_mx || translations.es ||
    translations.en_us || translations.en || Object.values(translations).find(value => value?.trim())
  // Uber's MultiLanguageText contract nests locale values under `translations`.
  // Its validator asks specifically for a non-empty `default` translation.
  return { translations: fallback ? { default: fallback } : {} }
}

/** Repair persisted/legacy Fullsite menus to Uber's current localized-text contract. */
export function normalizeMenuPayload(menu: UberMenuUpload): UberMenuUpload {
  return {
    ...menu,
    menus: menu.menus.map(menuSection => ({
      ...menuSection,
      title: withDefaultLocale(menuSection.title),
      service_availability: menuSection.service_availability.flatMap(availability => {
        const days = Array.isArray(availability.day_of_week)
          ? availability.day_of_week
          : [availability.day_of_week]
        const timePeriods = availability.time_periods ?? availability.time_period ?? []
        return days.map(day => ({ day_of_week: day, time_periods: timePeriods }))
      }),
    })),
    categories: menu.categories.map(category => ({
      ...category,
      title: withDefaultLocale(category.title),
    })),
    items: menu.items.map(item => ({
      ...item,
      title: withDefaultLocale(item.title),
      description: item.description ? withDefaultLocale(item.description) : undefined,
    })),
    modifier_groups: menu.modifier_groups?.map(group => ({
      ...group,
      title: withDefaultLocale(group.title),
      modifier_options: group.modifier_options.map(option => ({
        ...option,
        title: withDefaultLocale(option.title),
      })),
    })),
  }
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
      () => uberFetch(`/v2/eats/stores/${storeId}/menus`, {
        method: 'PUT',
        storeId,
        body: JSON.stringify(normalizeMenuPayload(menu)),
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
      () => uberFetch(`/v2/eats/stores/${storeId}/items/deactivations`, {
        method: 'POST', storeId,
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
      () => uberFetch(`/v2/eats/stores/${storeId}/items/activations`, {
        method: 'POST', storeId,
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
