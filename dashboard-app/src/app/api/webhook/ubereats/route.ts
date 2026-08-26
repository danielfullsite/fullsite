// DEPRECATED — Replaced by /api/integrations/uber-eats/webhook/route.ts (Integration Framework v1).
// This route lacks: deduplication, DLQ, correlation IDs, audit log, multi-tenant mapping.
// It must not receive new Uber traffic. Update the webhook URL in Uber Developer Console to
// the new route before decommissioning. Retained only during transition.
//
// Uber Eats Webhook — receives order notifications from Uber Eats Marketplace API.

import { type NextRequest, NextResponse } from 'next/server'


async function verifyUberSignature(body: string, sig: string): Promise<boolean> {
  const secret = process.env.UBER_WEBHOOK_SECRET
  if (!secret) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  )
  // Uber sends signature as hex string
  const sigBytes = Buffer.from(sig.replace('sha256=', ''), 'hex')
  const bodyBytes = new TextEncoder().encode(body)
  return crypto.subtle.verify('HMAC', key, sigBytes, bodyBytes)
}

function sbHeaders() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }
}

function uberAuth() {
  const clientId = process.env.UBER_CLIENT_ID || process.env.UBER_SANDBOX_CLIENT_ID || ''
  const clientSecret = process.env.UBER_CLIENT_SECRET || process.env.UBER_SANDBOX_CLIENT_SECRET || ''
  return { clientId, clientSecret }
}

async function getUberToken(): Promise<string | null> {
  const { clientId, clientSecret } = uberAuth()
  if (!clientId || !clientSecret) return null

  const isProduction = process.env.UBER_ENV === 'production'
  const loginUrl = isProduction
    ? 'https://login.uber.com/oauth/v2/token'
    : 'https://sandbox-login.uber.com/oauth/v2/token'

  const r = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials&scope=eats.pos_provisioning`,
  })
  if (!r.ok) return null
  const data = await r.json()
  return data.access_token || null
}

// Accept an order via Uber API
async function acceptOrder(orderId: string) {
  const token = await getUberToken()
  if (!token) return

  const isProduction = process.env.UBER_ENV === 'production'
  // Ambas ramas decian api.uber.com: en sandbox esto mandaba un token de
  // sandbox-login contra el host de produccion, que responde 401/403. El
  // sandbox vive en test-api.uber.com (docs de Uber, guia Sandbox & Testing).
  const apiBase = isProduction ? 'https://api.uber.com' : 'https://test-api.uber.com'

  await fetch(`${apiBase}/v1/eats/orders/${orderId}/accept_pos_order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Auto-accepted by Fullsite POS' }),
  })
}

export async function POST(request: NextRequest) {
  try {
    // Read raw body first so we can verify the signature before parsing
    const rawBody = await request.text()

    // Verify webhook signature — fail closed if secret not configured
    const uberSecret = process.env.UBER_WEBHOOK_SECRET
    if (!uberSecret) {
      console.error('[uber-webhook] UBER_WEBHOOK_SECRET not configured')
      return new NextResponse(null, { status: 503 })
    }
    const sig = request.headers.get('x-uber-signature') || ''
    if (!sig) {
      console.warn('[uber-webhook] Missing x-uber-signature header')
      return new NextResponse(null, { status: 401 })
    }
    const valid = await verifyUberSignature(rawBody, sig)
    if (!valid) {
      console.warn('[uber-webhook] Invalid signature — request rejected')
      return new NextResponse(null, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const eventType = body.event_type || body.type || ''
    const orderId = body.meta?.resource_id || body.order_id || body.id || ''

    console.log(`[uber-webhook] ${eventType} order=${orderId}`)

    // Resolve client_id from integration_store_mappings — no fallback (fail closed).
    const storeId = body.meta?.resource?.store?.store_id || body.store_id || ''
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    let clientId: string | null = null
    if (storeId) {
      const mappingRes = await fetch(
        `${sbUrl}/rest/v1/integration_store_mappings?provider=eq.ubereats&provider_store_id=eq.${encodeURIComponent(storeId)}&select=client_id&limit=1`,
        { headers: sbHeaders() }
      ).catch(() => null)
      if (mappingRes?.ok) {
        const rows = await mappingRes.json() as Array<{ client_id: string }>
        clientId = rows[0]?.client_id ?? null
      }
    }
    if (!clientId) {
      // Unknown store — ACK to Uber but do not persist (no fallback to any tenant)
      console.warn(`[uber-webhook-legacy] UNMAPPED_STORE store="${storeId}" event="${eventType}" — dropping silently. Migrate to /api/integrations/uber-eats/webhook.`)
      return new NextResponse(null, { status: 200 })
    }

    // Handle different event types
    if (eventType === 'orders.notification' || eventType === 'orders.created') {
      // New order — extract details and create in delivery_orders
      const order = body.meta?.resource || body.order || body
      const items = order.cart?.items || order.items || []
      const customer = order.eater || order.customer || {}
      const total = order.payment?.charges?.total?.amount
        ? order.payment.charges.total.amount / 100
        : order.total || 0

      const deliveryOrder = {
        id: `uber-${orderId}`,
        client_id: clientId,
        status: 'nueva',
        platform: 'ubereats',
        platform_order_id: orderId,
        customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Cliente Uber',
        phone: customer.phone?.number || null,
        address: order.delivery_address?.street_address || null,
        total,
        payment_method: 'ubereats',
        items: JSON.stringify(items.map((i: { title?: string; quantity?: number; price?: { unit_price?: { amount?: number } } }) => ({
          name: i.title || 'Item',
          qty: i.quantity || 1,
          price: i.price?.unit_price?.amount ? i.price.unit_price.amount / 100 : 0,
        }))),
        raw_json: JSON.stringify(body),
      }

      const res = await fetch(`${sbUrl}/rest/v1/delivery_orders`, {
        method: 'POST',
        headers: sbHeaders(),
        body: JSON.stringify(deliveryOrder),
      })

      if (res.ok) {
        console.log(`[uber-webhook] Order ${orderId} created in delivery_orders`)
        // Auto-accept the order
        await acceptOrder(orderId).catch(e =>
          console.warn(`[uber-webhook] Auto-accept failed: ${e}`)
        )
      } else {
        console.error(`[uber-webhook] Failed to create order: ${res.status} ${await res.text()}`)
      }
    } else if (eventType === 'orders.cancel') {
      // Order cancelled
      await fetch(`${sbUrl}/rest/v1/delivery_orders?platform_order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ status: 'cancelada', updated_at: new Date().toISOString() }),
      })
      console.log(`[uber-webhook] Order ${orderId} cancelled`)
    } else if (eventType === 'orders.ready_for_pickup') {
      await fetch(`${sbUrl}/rest/v1/delivery_orders?platform_order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ status: 'lista', updated_at: new Date().toISOString() }),
      })
    }

    // Uber expects 200 with empty body
    return new NextResponse(null, { status: 200 })
  } catch (e) {
    console.error('[uber-webhook] Error:', e)
    return new NextResponse(null, { status: 200 }) // Always return 200 to avoid Uber retries
  }
}

// Uber sends GET to verify the webhook URL
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fullsite-pos-ubereats-webhook' })
}
