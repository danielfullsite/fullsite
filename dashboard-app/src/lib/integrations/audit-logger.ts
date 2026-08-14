// Redacted audit logger — all provider request/response payloads are scrubbed
// before storage. Secrets/tokens never reach integration_audit_log.

const REDACT_KEYS = new Set([
  'client_secret', 'client_secret_enc', 'access_token', 'access_token_enc',
  'refresh_token', 'api_key', 'password', 'secret', 'token',
  'authorization', 'x-api-key', 'webhook_secret',
])

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(i => redact(i, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '***REDACTED***' : redact(v, depth + 1)
  }
  return out
}

const sbUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const sbKey = () => process.env.SUPABASE_SERVICE_KEY || ''

export async function auditLog(entry: {
  provider: string
  client_id?: string | null
  correlation_id?: string | null
  action: string
  request?: unknown
  response?: unknown
  status_code?: number | null
  duration_ms?: number | null
}): Promise<void> {
  try {
    const key = sbKey()
    if (!sbUrl() || !key) return
    await fetch(`${sbUrl()}/rest/v1/integration_audit_log`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        provider: entry.provider,
        client_id: entry.client_id ?? null,
        correlation_id: entry.correlation_id ?? null,
        action: entry.action,
        request_summary: entry.request != null ? redact(entry.request) : null,
        response_summary: entry.response != null ? redact(entry.response) : null,
        status_code: entry.status_code ?? null,
        duration_ms: entry.duration_ms ?? null,
      }),
    })
  } catch { /* best-effort — audit must never throw */ }
}
