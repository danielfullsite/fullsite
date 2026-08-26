// Uber Basic Production Validation — automated lifecycle runner.
//
// Drives the real Uber sandbox lifecycle THROUGH the deployed sandbox app's
// server-side endpoints (never calls Uber directly, never handles Uber creds):
//   probe   → POST /api/integrations/uber-eats/sandbox {action:'scope_probe'}
//   get     → POST /api/integrations/uber-eats/sandbox {action:'delivery_order_get'}
//   accept  → POST /api/integrations/uber-eats/sandbox {action:'delivery_order_accept'}
//   ready   → POST /api/integrations/uber-eats/sandbox {action:'delivery_order_ready'}
//   resolve → POST /api/integrations/uber-eats/order   {action:'resolve_fulfillment'}
//   cancel  → POST /api/integrations/uber-eats/sandbox {action:'delivery_order_cancel'}
//
// Fail-closed exit codes:
//   0  → every step PASS (only when a real order/item exercised the full lifecycle)
//   1  → at least one executed step FAILED an assertion (hard failure)
//   2  → no failures but some steps BLOCKED (e.g. no Uber test order yet) — INCOMPLETE
//   3  → configuration error (missing SANDBOX_URL / INTEGRATION_ADMIN_SECRET)
//
// SECURITY: this runner never prints tokens, service keys, refresh tokens, the
// admin secret, or Authorization headers. Every emitted string passes through
// sanitize(). Secrets are read from env and used only in request headers.

const SANDBOX_ACTION_PATH = '/api/integrations/uber-eats/sandbox'
const ORDER_PATH = '/api/integrations/uber-eats/order'
// Store de prueba vigente. Uber recreo el store el 2026-08-25 (caso #59499952) porque
// el anterior estaba roto; el 401 de Menu y el invalid_scope se observaron contra el viejo.
const DEFAULT_STORE_ID = 'a4f298f4-202f-47f5-b375-d2eefec0126c'

// ─── Sanitizer ────────────────────────────────────────────────────────────────
// Redacts anything token/secret-shaped from any string before it is emitted.

export function makeSanitizer(secrets = []) {
  const literals = secrets.filter(Boolean).map(String)
  return function sanitize(value) {
    let s = typeof value === 'string' ? value : JSON.stringify(value)
    for (const lit of literals) {
      if (lit.length >= 4) s = s.split(lit).join('***REDACTED***')
    }
    s = s
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***REDACTED***')
      .replace(/("(?:access_token|refresh_token|client_secret|apikey|authorization)"\s*:\s*)"[^"]*"/gi, '$1"***REDACTED***"')
      .replace(/\b(eyJ[A-Za-z0-9._\-]{20,})\b/g, '***REDACTED_JWT***') // JWT-shaped
      .replace(/\b([A-Za-z0-9_\-]{60,})\b/g, '***REDACTED_LONG***')    // long opaque blobs
    return s
  }
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

async function postJson(fetchImpl, url, adminSecret, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify(body),
  })
  let parsed = null
  const text = await res.text().catch(() => '')
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
  return { http: res.status, body: parsed }
}

// ─── Assertions per step ────────────────────────────────────────────────────────

function probePassed(http, body) {
  if (http !== 200 || !body) return false
  const p2 = body?.phases?.phase2_marketplace
  const granted = String(p2?.token_probe?.granted_scope ?? '')
  return p2?.token_probe?.ok === true && granted.split(/\s+/).includes('eats.order')
}

// delivery_order_* and /order responses carry result.ok (adapter result).
function lifecyclePassed(http, body) {
  if (http !== 200) return false
  const ok = body?.result?.ok ?? body?.ok
  return ok === true
}

// ─── Core (pure, testable) ──────────────────────────────────────────────────────

export async function runValidation({ fetchImpl = fetch, config }) {
  const { sandboxUrl, adminSecret, storeId = DEFAULT_STORE_ID, orderId = null, itemId = null } = config
  const sanitize = makeSanitizer([adminSecret, config.serviceKey])
  const steps = []

  const record = (name, status, http, body, note) => {
    steps.push({
      name,
      status, // 'PASS' | 'FAIL' | 'BLOCKED'
      http: http ?? null,
      correlation: body?.correlation_id ?? body?.result?.correlation_id ?? null,
      detail: sanitize(note ?? (body ? JSON.stringify(body).slice(0, 300) : '')),
    })
  }

  // 1. PROBE — proves the Test Client now carries eats.order (G2 real)
  try {
    const { http, body } = await postJson(fetchImpl, sandboxUrl + SANDBOX_ACTION_PATH, adminSecret, { action: 'scope_probe', store_id: storeId })
    record('probe', probePassed(http, body) ? 'PASS' : 'FAIL', http, body,
      probePassed(http, body) ? 'eats.order granted (marketplace M2M)' : 'eats.order NOT granted / probe error')
  } catch (e) {
    record('probe', 'FAIL', null, null, 'probe request threw: ' + sanitize(String(e)))
  }

  // 2-6. Lifecycle — require a real Uber-generated order (and item for resolve)
  const lifecycle = [
    { name: 'get',     path: SANDBOX_ACTION_PATH, body: { action: 'delivery_order_get', store_id: storeId, order_id: orderId } },
    { name: 'accept',  path: SANDBOX_ACTION_PATH, body: { action: 'delivery_order_accept', store_id: storeId, order_id: orderId } },
    { name: 'ready',   path: SANDBOX_ACTION_PATH, body: { action: 'delivery_order_ready', store_id: storeId, order_id: orderId } },
    { name: 'resolve', path: ORDER_PATH, needsItem: true, body: {
        order_id: orderId, action: 'resolve_fulfillment',
        issues: [{ issue_type: 'OUT_OF_STOCK', action_type: 'REMOVE_ITEM', item: { id: itemId, name: 'item' }, store_response: 'validation run' }],
      } },
    { name: 'cancel',  path: SANDBOX_ACTION_PATH, body: { action: 'delivery_order_cancel', store_id: storeId, order_id: orderId } },
  ]

  for (const step of lifecycle) {
    if (!orderId) { record(step.name, 'BLOCKED', null, null, 'no UBER_TEST_ORDER_ID — Uber must generate a sandbox order'); continue }
    if (step.needsItem && !itemId) { record(step.name, 'BLOCKED', null, null, 'no UBER_TEST_ITEM_ID — needs a real item id from the order'); continue }
    try {
      const { http, body } = await postJson(fetchImpl, sandboxUrl + step.path, adminSecret, step.body)
      record(step.name, lifecyclePassed(http, body) ? 'PASS' : 'FAIL', http, body)
    } catch (e) {
      record(step.name, 'FAIL', null, null, 'request threw: ' + sanitize(String(e)))
    }
  }

  const summary = {
    pass: steps.filter(s => s.status === 'PASS').length,
    fail: steps.filter(s => s.status === 'FAIL').length,
    blocked: steps.filter(s => s.status === 'BLOCKED').length,
  }
  // Fail-closed: 0 only when everything passed; 1 on any hard failure; 2 if merely incomplete.
  const exitCode = summary.fail > 0 ? 1 : summary.blocked > 0 ? 2 : 0
  return { steps, summary, exitCode }
}

// ─── CLI wrapper ─────────────────────────────────────────────────────────────────

async function main() {
  const config = {
    sandboxUrl: (process.env.SANDBOX_URL ?? '').replace(/\/$/, ''),
    adminSecret: process.env.INTEGRATION_ADMIN_SECRET ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '', // only for sanitizer redaction
    storeId: process.env.UBER_TEST_STORE_ID || DEFAULT_STORE_ID,
    orderId: process.env.UBER_TEST_ORDER_ID || null,
    itemId: process.env.UBER_TEST_ITEM_ID || null,
  }
  if (!config.sandboxUrl || !config.adminSecret) {
    console.error('[uber-runner] config error: SANDBOX_URL and INTEGRATION_ADMIN_SECRET are required')
    process.exit(3)
  }
  const { steps, summary, exitCode } = await runValidation({ config })
  console.log(`\nUber Basic Production Validation — ${new Date().toISOString()}`)
  console.log(`store=${config.storeId} order=${config.orderId ? 'provided' : 'NONE (lifecycle BLOCKED)'}\n`)
  for (const s of steps) {
    const mark = s.status === 'PASS' ? '✓' : s.status === 'FAIL' ? '✗' : '⏸'
    console.log(`${mark} ${s.name.padEnd(8)} ${String(s.http ?? '--').padEnd(4)} ${s.status.padEnd(8)} ${s.detail}`)
  }
  console.log(`\nsummary: ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.blocked} BLOCKED → exit ${exitCode}`)
  if (exitCode === 0) console.log('ALL PASS — ready to submit evidence to Uber (attach correlation IDs from audit log).')
  else if (exitCode === 2) console.log('INCOMPLETE — provide UBER_TEST_ORDER_ID (+ UBER_TEST_ITEM_ID) once Uber generates a sandbox order.')
  else console.log('FAILURE — at least one step failed; do NOT submit. Inspect the failing step.')
  process.exit(exitCode)
}

// Only run as CLI, not when imported by tests.
import { fileURLToPath } from 'node:url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
