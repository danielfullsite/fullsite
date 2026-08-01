// Uber Eats — Store status management (pause / activate / get).

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export async function pauseStore(
  storeId: string,
  correlationId: string,
  durationMinutes?: number
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  const body: Record<string, unknown> = { pause_type: 'MANUAL' }
  if (durationMinutes) body.duration = durationMinutes * 60
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/status`, {
        method: 'POST', storeId, body: JSON.stringify(body),
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'store.pause',
      request: { store_id: storeId, duration_minutes: durationMinutes },
      response: errText ? { error: errText } : { status: 'paused' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function activateStore(
  storeId: string,
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/status`, { method: 'DELETE', storeId }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'store.activate',
      request: { store_id: storeId },
      response: errText ? { error: errText } : { status: 'active' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getStoreStatus(
  storeId: string,
  correlationId: string
): Promise<{ ok: boolean; is_open?: boolean; pause_type?: string; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/stores/${storeId}/status`, { method: 'GET', storeId }),
      { maxAttempts: 2, baseDelayMs: 300 }
    )
    if (!r.ok) return { ok: false, error: await r.text() }
    const data = await r.json() as { open?: boolean; is_open?: boolean; pause_type?: string }
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'store.get_status',
      request: { store_id: storeId },
      response: { open: data.open ?? data.is_open, pause_type: data.pause_type },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return { ok: true, is_open: data.open ?? data.is_open, pause_type: data.pause_type }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
