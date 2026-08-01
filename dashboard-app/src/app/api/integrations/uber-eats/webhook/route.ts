// Uber Eats Webhook — Integration Framework canonical handler.
//
// Flow per event:
//   1. Verify HMAC-SHA256 (x-uber-signature) → 401 on failure, 503 if unconfigured
//   2. Dedup via integration_webhook_events (provider_event_id UNIQUE) → 200 on duplicate
//   3. Get full order details from Uber API (before any side effects)
//   4. Normalize to CanonicalOrder
//   5. Persist to delivery_orders with idempotency_key (ON CONFLICT DO NOTHING)
//   6. Accept order via Uber API (Type A — RecoverableOperation scope)
//   7. On any failure → DLQ + audit log
//   8. Return 200 (Uber expects ack within timeout)
//
// Replaces: /api/webhook/ubereats/route.ts (legacy, no dedup, no retry, no DLQ)
// Replaces: cloudflare/delivery-worker (no HMAC, hardcoded client_id)

import { type NextRequest, NextResponse } from 'next/server'
import { normalizeUberOrder } from '@/lib/integrations/uber-eats/order-adapter'
import { acceptOrder, getOrderDetails } from '@/lib/integrations/uber-eats/adapter'
import { auditLog } from '@/lib/integrations/audit-logger'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function sbHeaders() {
  return {
    apikey: SB_KEY(),
    Authorization: `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
  }
}

// ─── HMAC verification ──────────────────────────────────────────────────────

async function verifySignature(rawBody: string, sigHeader: string): Promise<boolean> {
  const secret = process.env.UBER_WEBHOOK_SECRET
  if (!secret) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  )
  const hex = sigHeader.replace(/^sha256=/, '')
  const sigBytes = Buffer.from(hex, 'hex')
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(rawBody))
}

// ─── Store → Client mapping (DB-first, env fallback) ─────────────────────────

async function resolveClientId(storeId: string): Promise<string> {
  if (storeId) {
    const r = await fetch(
      `${SB_URL()}/rest/v1/integration_store_mappings?provider=eq.ubereats&provider_store_id=eq.${encodeURIComponent(storeId)}&select=client_id&limit=1`,
      { headers: sbHeaders() }
    ).catch(() => null)
    if (r?.ok) {
      const rows = (await r.json()) as Array<{ client_id: string }>
      if (rows[0]?.client_id) return rows[0].client_id
    }
  }
  // Env-var fallback for backwards compat
  try {
    const map = JSON.parse(process.env.UBER_STORE_CLIENT_MAP || '{}') as Record<string, string>
    if (storeId && map[storeId]) return map[storeId]
  } catch { /* invalid JSON */ }
  return process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || 'amalay'
}

// ─── Webhook event dedup ─────────────────────────────────────────────────────

interface WebhookEventRow {
  id: string
  status: string
  correlation_id: string
}

async function upsertWebhookEvent(
  providerEventId: string,
  eventType: string,
  storeId: string,
  clientId: string,
  payload: unknown
): Promise<{ row: WebhookEventRow; isDuplicate: boolean }> {
  const correlationId = crypto.randomUUID()

  // Attempt insert — UNIQUE(provider, provider_event_id) catches duplicates
  const r = await fetch(`${SB_URL()}/rest/v1/integration_webhook_events`, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      Prefer: 'return=representation,resolution=ignore-duplicates',
    },
    body: JSON.stringify({
      provider: 'ubereats',
      provider_event_id: providerEventId,
      event_type: eventType,
      correlation_id: correlationId,
      store_id: storeId || null,
      client_id: clientId,
      payload,
      status: 'received',
      attempts: 0,
    }),
  })

  const rows = r.ok ? (await r.json()) as WebhookEventRow[] : []
  if (rows.length > 0) {
    return { row: rows[0], isDuplicate: false }
  }

  // Row already exists — fetch it to return correlation_id
  const existing = await fetch(
    `${SB_URL()}/rest/v1/integration_webhook_events?provider=eq.ubereats&provider_event_id=eq.${encodeURIComponent(providerEventId)}&select=id,status,correlation_id&limit=1`,
    { headers: sbHeaders() }
  )
  const existingRows = existing.ok ? (await existing.json()) as WebhookEventRow[] : []
  return {
    row: existingRows[0] ?? { id: '', status: 'processed', correlation_id: correlationId },
    isDuplicate: true,
  }
}

async function markEventProcessed(eventId: string, error?: string): Promise<void> {
  if (!eventId) return
  await fetch(`${SB_URL()}/rest/v1/integration_webhook_events?id=eq.${eventId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(
      error
        ? { status: 'failed', last_error: error.slice(0, 1000), processed_at: new Date().toISOString() }
        : { status: 'processed', processed_at: new Date().toISOString() }
    ),
  }).catch(() => {})
}

async function sendToDLQ(eventId: string, eventType: string, clientId: string, payload: unknown, reason: string): Promise<void> {
  await fetch(`${SB_URL()}/rest/v1/integration_webhook_dlq`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      webhook_event_id: eventId || null,
      provider: 'ubereats',
      event_type: eventType,
      client_id: clientId,
      payload,
      failure_reason: reason.slice(0, 2000),
    }),
  }).catch(() => {})
}

// ─── Order persistence (exactly-once) ────────────────────────────────────────

async function persistOrder(
  order: ReturnType<typeof normalizeUberOrder>,
  webhookEventId: string
): Promise<{ ok: boolean; was_duplicate: boolean }> {
  const row = {
    id: `uber-${order.provider_order_id}`,
    client_id: order.client_id,
    platform: 'ubereats',
    platform_order_id: order.provider_order_id,
    status: 'nueva',
    customer_name: order.customer_name,
    customer_phone: order.customer_phone ?? null,
    phone: order.customer_phone ?? null,
    address: order.delivery_address ?? null,
    total: order.total,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    payment_method: 'ubereats',
    items: JSON.stringify(order.items.map(i => ({
      name: i.name,
      qty: i.quantity,
      price: i.unit_price,
      notes: i.notes,
      modifiers: i.modifiers.map(m => m.name).filter(Boolean).join(', '),
    }))),
    notes: order.notes ?? null,
    estimated_pickup: order.estimated_pickup_at ?? null,
    raw_payload: order.raw_payload,
    webhook_event_id: webhookEventId || null,
  }

  const r = await fetch(`${SB_URL()}/rest/v1/delivery_orders`, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      // ON CONFLICT on (platform, platform_order_id) — exactly-once
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(row),
  })

  if (!r.ok) {
    const err = await r.text()
    return { ok: false, was_duplicate: err.includes('duplicate') || err.includes('conflict') }
  }

  // 201 = created, 200 with empty body = duplicate ignored
  const responseText = await r.text()
  const wasDuplicate = responseText === '' || r.status === 200
  return { ok: true, was_duplicate: wasDuplicate }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Step 0 — Fail fast on missing required secrets
  const webhookSecret = process.env.UBER_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[uber-webhook-v2] UBER_WEBHOOK_SECRET not configured')
    return new NextResponse(null, { status: 503 })
  }
  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('[uber-webhook-v2] SUPABASE_SERVICE_KEY not configured')
    return new NextResponse(null, { status: 503 })
  }

  // Step 1 — HMAC verification

  const rawBody = await request.text()
  const sig = request.headers.get('x-uber-signature') ?? ''
  if (!sig) {
    return new NextResponse(null, { status: 401 })
  }
  const valid = await verifySignature(rawBody, sig)
  if (!valid) {
    console.warn('[uber-webhook-v2] Invalid HMAC signature')
    return new NextResponse(null, { status: 401 })
  }

  // Step 2 — Parse & extract identifiers
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const meta = (body.meta ?? {}) as Record<string, unknown>
  const resource = (meta.resource ?? {}) as Record<string, unknown>
  const store = (resource.store ?? {}) as Record<string, unknown>

  const eventType = (body.event_type ?? body.type ?? '') as string
  const orderId = (meta.resource_id ?? body.order_id ?? body.id ?? '') as string
  const storeId = (store.store_id ?? body.store_id ?? '') as string

  // Generate a stable event ID for dedup: Uber sends event_id in some versions
  const providerEventId = (body.event_id ?? body.uuid ?? `${eventType}:${orderId}`) as string

  // Step 3 — Resolve client
  const clientId = await resolveClientId(storeId)

  // Step 4 — Dedup
  const { row: eventRow, isDuplicate } = await upsertWebhookEvent(
    providerEventId, eventType, storeId, clientId, body
  )

  if (isDuplicate) {
    console.log(`[uber-webhook-v2] Duplicate event ${providerEventId} — ack without processing`)
    return new NextResponse(null, { status: 200 })
  }

  const correlationId = eventRow.correlation_id
  console.log(`[uber-webhook-v2] ${eventType} order=${orderId} correlation=${correlationId}`)

  // Step 5 — Process by event type
  try {
    if (eventType === 'orders.notification' || eventType === 'orders.created') {
      await handleNewOrder(orderId, storeId, clientId, body, eventRow.id, correlationId)
    } else if (eventType === 'orders.cancel' || eventType === 'eats.order.order_cancelled') {
      await handleCancelledOrder(orderId, eventRow.id, correlationId)
    } else if (eventType === 'orders.ready_for_pickup') {
      await handleReadyForPickup(orderId, eventRow.id, correlationId)
    } else if (eventType === 'store.status') {
      await handleStoreStatus(storeId, body, eventRow.id, correlationId)
    } else {
      // Unknown event type — mark as processed (don't DLQ unknown events)
      console.log(`[uber-webhook-v2] Unknown event type: ${eventType}`)
      await markEventProcessed(eventRow.id)
    }
  } catch (e) {
    const errMsg = String(e)
    console.error(`[uber-webhook-v2] Processing error correlation=${correlationId}:`, e)
    await markEventProcessed(eventRow.id, errMsg)
    await sendToDLQ(eventRow.id, eventType, clientId, body, errMsg)
    await auditLog({ provider: 'ubereats', client_id: clientId, correlation_id: correlationId, action: 'webhook.processing_error', response: { error: errMsg } })
  }

  return new NextResponse(null, { status: 200 })
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleNewOrder(
  orderId: string,
  storeId: string,
  clientId: string,
  rawPayload: unknown,
  eventId: string,
  correlationId: string
): Promise<void> {
  // Get full order details from Uber (required before accept per certification)
  const detailsResult = await getOrderDetails(orderId, correlationId)
  const orderPayload = detailsResult.ok && detailsResult.order
    ? detailsResult.order as Record<string, unknown>
    : rawPayload as Record<string, unknown>

  // Normalize
  const canonicalOrder = normalizeUberOrder(orderPayload, storeId, clientId, correlationId)

  // Persist — exactly once via ON CONFLICT ignore
  const persistResult = await persistOrder(canonicalOrder, eventId)
  if (!persistResult.ok && !persistResult.was_duplicate) {
    throw new Error(`Failed to persist order ${orderId}`)
  }

  if (!persistResult.was_duplicate) {
    console.log(`[uber-webhook-v2] Order ${orderId} persisted. Accepting...`)
    // Accept — Type A operation: Uber confirms externally
    const acceptResult = await acceptOrder(orderId, correlationId)
    if (!acceptResult.ok) {
      // Log accept failure but don't throw — order is in DB, accept can be retried from delivery page
      console.warn(`[uber-webhook-v2] Accept failed for ${orderId}: ${acceptResult.error}`)
      await auditLog({ provider: 'ubereats', client_id: clientId, correlation_id: correlationId, action: 'order.accept_failed', response: { error: acceptResult.error } })
    }
  } else {
    console.log(`[uber-webhook-v2] Order ${orderId} already exists — skip persist+accept`)
  }

  await markEventProcessed(eventId)
}

async function handleCancelledOrder(orderId: string, eventId: string, correlationId: string): Promise<void> {
  await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?platform_order_id=eq.${encodeURIComponent(orderId)}&platform=eq.ubereats`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelada', updated_at: new Date().toISOString() }),
    }
  )
  await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.cancelled_by_platform', request: { order_id: orderId } })
  await markEventProcessed(eventId)
}

async function handleReadyForPickup(orderId: string, eventId: string, correlationId: string): Promise<void> {
  await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?platform_order_id=eq.${encodeURIComponent(orderId)}&platform=eq.ubereats`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'lista', updated_at: new Date().toISOString() }),
    }
  )
  await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.ready_for_pickup', request: { order_id: orderId } })
  await markEventProcessed(eventId)
}

async function handleStoreStatus(
  storeId: string,
  payload: unknown,
  eventId: string,
  correlationId: string
): Promise<void> {
  const p = payload as { store_status?: string; is_open?: boolean }
  const isOpen = p.store_status === 'ACTIVE' || p.is_open === true
  if (storeId) {
    await fetch(
      `${SB_URL()}/rest/v1/integration_store_mappings?provider=eq.ubereats&provider_store_id=eq.${encodeURIComponent(storeId)}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ store_open: isOpen, updated_at: new Date().toISOString() }),
      }
    ).catch(() => {})
  }
  await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'store.status_update', request: { store_id: storeId, is_open: isOpen } })
  await markEventProcessed(eventId)
}

// Uber verifies webhook URL with GET
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fullsite-ubereats-webhook-v2', version: '2.0.0' })
}
