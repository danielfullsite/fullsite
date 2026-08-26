// Uber Delivery V1 Store API — store management via Delivery Store endpoints.
// Parallel to store.ts (which uses Eats v2 API); same shape, different URL paths.
//
//   GET  /v1/delivery/stores                           — list all delivery stores
//   GET  /v1/delivery/store/{id}                       — get specific store
//   GET  /v1/delivery/store/{id}/status                — get store open/closed status
//   POST /v1/delivery/store/{id}/update-store-status   — pause or activate store
//
// Token: client_credentials / marketplace (eats.store, eats.store.status.write).
// NOT the USL authorization_code token — eats.store is an M2M scope.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export async function listDeliveryStores(
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; stores?: unknown[]; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch('/v1/delivery/stores', { method: 'GET', tokenType: 'marketplace' }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    if (!r.ok) {
      const err = await r.text()
      await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.list', response: { error: err }, status_code: r.status, duration_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const data = (await r.json()) as unknown[] | { stores?: unknown[] }
    const stores = Array.isArray(data) ? data : (data as { stores?: unknown[] }).stores ?? []
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.list', response: { count: stores.length }, status_code: r.status, duration_ms: Date.now() - t0 })
    return { ok: true, stores }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getDeliveryStore(
  storeId: string,
  correlationId: string
): Promise<{ ok: boolean; store?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/store/${encodeURIComponent(storeId)}`, { method: 'GET', tokenType: 'marketplace' }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    if (!r.ok) {
      const err = await r.text()
      await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.get', request: { store_id: storeId }, response: { error: err }, status_code: r.status, duration_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const store = await r.json()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.get', request: { store_id: storeId }, response: { store_id: storeId }, status_code: r.status, duration_ms: Date.now() - t0 })
    return { ok: true, store }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getDeliveryStoreStatus(
  storeId: string,
  correlationId: string
): Promise<{ ok: boolean; is_open?: boolean; status?: string; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/store/${encodeURIComponent(storeId)}/status`, { method: 'GET', tokenType: 'marketplace' }),
      { maxAttempts: 2, baseDelayMs: 300 }
    )
    if (!r.ok) {
      const err = await r.text()
      await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.get_status', request: { store_id: storeId }, response: { error: err }, status_code: r.status, duration_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const data = (await r.json()) as { is_open?: boolean; status?: string; store_status?: string }
    const isOpen = data.is_open !== undefined ? data.is_open : (data.store_status ?? data.status) === 'ACTIVE'
    const statusStr = data.store_status ?? data.status
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.get_status', request: { store_id: storeId }, response: { is_open: isOpen, status: statusStr }, status_code: r.status, duration_ms: Date.now() - t0 })
    return { ok: true, is_open: isOpen, status: statusStr }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export type DeliveryStoreStatusAction = 'PAUSE' | 'ACTIVATE'

export async function updateDeliveryStoreStatus(
  storeId: string,
  action: DeliveryStoreStatusAction,
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  // Uber espera el campo `status` con el estado deseado (no `action`); un body sin `status`
  // lo interpreta como "invalid store status: UNKNOWN".
  //
  // OJO — el enum de LECTURA y el de ESCRITURA no son el mismo. El GET .../status reporta
  // PAUSED, y de ahí se tomó el valor para el POST; pero el POST lo rechaza:
  //   {"error":"error transforming request: ... toField: status, error: unknown enum
  //     value string:PAUSED"}
  // Evidencia: run day3 32943685915 (2026-08-26) — `pause` era la ÚNICA de las 5 Delivery
  // Store APIs que fallaba (4/5 OK), y el sumario nunca decía cuál. ACTIVATE->ONLINE sí
  // pasa, así que la contraparte del par es OFFLINE, no PAUSED.
  // Override por env si Uber vuelve a cambiar el enum, sin necesidad de deploy.
  const status = action === 'PAUSE'
    ? (process.env.UBER_STORE_STATUS_PAUSED || 'OFFLINE')
    : (process.env.UBER_STORE_STATUS_ACTIVE || 'ONLINE')
  // Poner la tienda OFFLINE exige decir HASTA CUANDO. Uber lo pide explícito:
  //   {"code":"bad_request", ... "field_violations":[{"field":"is_offline_until",
  //     "description":"is_offline_until timestamp is needed when setting store offline"}]}
  // (evidencia: run day3 32944479542, 2026-08-26 — el enum OFFLINE ya lo aceptó y el
  // error avanzó a este.) Ventana configurable por env; el default de 60 min es una pausa
  // operativa normal (cocina saturada, se acabó un insumo), no un cierre indefinido.
  const body: Record<string, unknown> = { status }
  if (action === 'PAUSE') {
    const minutos = Number(process.env.UBER_STORE_PAUSE_MINUTES) || 60
    body.is_offline_until = new Date(Date.now() + minutos * 60_000).toISOString()
  }
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/store/${encodeURIComponent(storeId)}/update-store-status`, {
        method: 'POST',
        body: JSON.stringify(body),
        tokenType: 'marketplace',
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.store.update_status', request: { store_id: storeId, action }, response: errText ? { error: errText } : { status: action === 'PAUSE' ? 'paused' : 'active' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
