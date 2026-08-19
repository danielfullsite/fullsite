// Uber Eats POS Provisioning — outbound calls to Uber's /pos_data API.
//
// Fullsite calls these; Uber does not call Fullsite's /pos_data.
//
//   GET   /v1/eats/stores/{store_id}/pos_data — fetch current Uber-side POS config
//   POST  /v1/eats/stores/{store_id}/pos_data — register / activate integration
//   PATCH /v1/eats/stores/{store_id}/pos_data — update existing config
//
// All three require a USL token obtained via the authorization_code flow with
// scope eats.pos_provisioning. client_credentials tokens are NOT valid here.
//
// getPosData() is called automatically from handleProvisioned() in webhook/route.ts
// so every store.provisioned event generates a Uber-visible GET with a real timestamp.
//
// Bootstrap order: USL flow first (creates integration_store_mappings row and stores
// the USL token) → Uber sends store.provisioned → handleProvisioned calls getPosData.
// If store.provisioned arrives before USL completes, the webhook handler quarantines
// the event in integration_webhook_dlq for manual replay after USL.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PosDataConfig {
  integrator_store_id: string
  integrator_brand_id: string
  is_order_manager: boolean
  integration_enabled?: boolean
  // No PII — address, customer names, phone numbers must not appear here.
  store_configuration_data?: Record<string, unknown>
  webhook_config?: {
    version?: string
    endpoint?: string
  }
}

export interface PosDataResult {
  ok: boolean
  data?: unknown
  error?: string
  status_code?: number
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function getPosData(
  storeId: string,
  correlationId: string
): Promise<PosDataResult> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, {
        method: 'GET',
        storeId,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const body = await r.json().catch(() => null)
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.get_pos_data',
      request: { store_id: storeId },
      response: r.ok ? { store_id: storeId, fields: body ? Object.keys(body) : [] } : { error: body },
      status_code: r.status,
      duration_ms: Date.now() - t0,
    })
    return r.ok
      ? { ok: true, data: body, status_code: r.status }
      : { ok: false, error: JSON.stringify(body), status_code: r.status }
  } catch (e) {
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.get_pos_data',
      request: { store_id: storeId },
      response: { error: String(e) },
      duration_ms: Date.now() - t0,
    })
    return { ok: false, error: String(e) }
  }
}

// ─── POST — register / activate ──────────────────────────────────────────────

export async function activateIntegration(
  storeId: string,
  config: PosDataConfig,
  correlationId: string
): Promise<PosDataResult> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      // POST pos_data requiere el token USL del merchant (eats.pos_provisioning),
      // NO el M2M marketplace (default de uberFetch). Sin esto → 401. Verbo POST/DELETE
      // = provisioning; GET/PATCH = eats.store (M2M) — ver openapi Uber.
      () => uberFetch(`/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, {
        method: 'POST',
        body: JSON.stringify(config),
        storeId,
        tokenType: 'provisioning',
      }),
      { maxAttempts: 3, baseDelayMs: 1000 }
    )
    const body = await r.json().catch(() => null)
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.activate',
      request: {
        store_id: storeId,
        integrator_store_id: config.integrator_store_id,
        integrator_brand_id: config.integrator_brand_id,
        is_order_manager: config.is_order_manager,
        integration_enabled: config.integration_enabled,
      },
      response: r.ok ? { status: 'activated' } : { error: body },
      status_code: r.status,
      duration_ms: Date.now() - t0,
    })
    return r.ok
      ? { ok: true, data: body, status_code: r.status }
      : { ok: false, error: JSON.stringify(body), status_code: r.status }
  } catch (e) {
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.activate',
      request: { store_id: storeId },
      response: { error: String(e) },
      duration_ms: Date.now() - t0,
    })
    return { ok: false, error: String(e) }
  }
}

// ─── PATCH — update ──────────────────────────────────────────────────────────

export async function updatePosData(
  storeId: string,
  patch: Partial<PosDataConfig>,
  correlationId: string
): Promise<PosDataResult> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        storeId,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const body = await r.json().catch(() => null)
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.update_pos_data',
      request: { store_id: storeId, patch_keys: Object.keys(patch) },
      response: r.ok ? { status: 'updated' } : { error: body },
      status_code: r.status,
      duration_ms: Date.now() - t0,
    })
    return r.ok
      ? { ok: true, data: body, status_code: r.status }
      : { ok: false, error: JSON.stringify(body), status_code: r.status }
  } catch (e) {
    await auditLog({
      provider: 'ubereats',
      correlation_id: correlationId,
      action: 'provisioning.update_pos_data',
      request: { store_id: storeId, patch_keys: Object.keys(patch) },
      response: { error: String(e) },
      duration_ms: Date.now() - t0,
    })
    return { ok: false, error: String(e) }
  }
}
