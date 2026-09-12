export type DeliveryProvider = 'ubereats' | 'rappi'
export type DeliveryProviderAction = 'ready' | 'cancel'

export interface DeliveryActionRequest {
  localOrderId: string
  platformOrderId: string
  platform: DeliveryProvider
  action: DeliveryProviderAction
  reason?: string
  localPatch: Record<string, unknown>
  authHeaders: Record<string, string>
  /** Only true after this exact action already received a positive provider response. */
  providerAlreadyConfirmed?: boolean
}

export type DeliveryActionFailure = {
  ok: false
  stage: 'provider' | 'local'
  /** True means the remote side may have applied the action despite the failure. */
  uncertain: boolean
  /** A confirmed provider action must never be sent again just because local persistence failed. */
  retry: 'provider_then_local' | 'local_only'
  status?: number
}

export type DeliveryActionResult = { ok: true } | DeliveryActionFailure

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const PROVIDER_TIMEOUT_MS = 10_000

function providerRequest(request: DeliveryActionRequest, signal: AbortSignal): [string, RequestInit] {
  const rappi = request.platform === 'rappi'
  return [
    rappi ? '/api/integrations/rappi/order' : '/api/integrations/uber-eats/order',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...request.authHeaders },
      body: JSON.stringify({
        order_id: request.platformOrderId,
        action: request.action,
        ...(request.reason ? { reason: request.reason } : {}),
        // The browser persists the local status only after it has verified the
        // provider response. Keep Rappi's backwards-compatible route from doing
        // the same write a second time.
        ...(rappi ? { update_local_status: false } : {}),
      }),
      signal,
    },
  ]
}

async function responseSaysOk(response: Response): Promise<boolean> {
  if (!response.ok) return false
  const body = await response.clone().json().catch(() => null) as { ok?: unknown } | null
  return body?.ok !== false
}

/**
 * Applies an outbound provider action before changing Fullsite's local truth.
 * A lost provider response is reported as uncertain and leaves the local order
 * untouched. If the provider is confirmed but the local write fails, callers
 * can retry with providerAlreadyConfirmed=true to avoid sending it twice.
 */
export async function applyDeliveryAction(
  request: DeliveryActionRequest,
  options: { fetcher?: FetchLike; timeoutMs?: number } = {},
): Promise<DeliveryActionResult> {
  const fetcher = options.fetcher ?? fetch

  if (!request.providerAlreadyConfirmed) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    try {
      const [url, init] = providerRequest(request, controller.signal)
      const response = await fetcher(url, init)
      if (!await responseSaysOk(response)) {
        return {
          ok: false,
          stage: 'provider',
          // A 5xx can be emitted after an upstream side effect. A 4xx is a
          // definitive rejection from our authenticated provider route.
          uncertain: response.status >= 500,
          retry: 'provider_then_local',
          status: response.status,
        }
      }
    } catch {
      // A timeout/network error does not prove whether the provider received
      // the request. Never advance local state in this branch.
      return { ok: false, stage: 'provider', uncertain: true, retry: 'provider_then_local' }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const response = await fetcher('/api/pos/delivery-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...request.authHeaders },
      body: JSON.stringify({ id: request.localOrderId, patch: request.localPatch }),
    })
    if (!response.ok) {
      return { ok: false, stage: 'local', uncertain: false, retry: 'local_only', status: response.status }
    }
  } catch {
    return { ok: false, stage: 'local', uncertain: false, retry: 'local_only' }
  }

  return { ok: true }
}
