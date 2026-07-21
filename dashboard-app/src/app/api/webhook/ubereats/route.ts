// Uber Eats Webhook — receives order notifications from Uber Eats Marketplace API.
// Uber sends POST to this URL when:
// - New order placed (orders.notification)
// - Order cancelled by customer
// - Order status updates
//
// The webhook creates/updates delivery_orders in Supabase and the POS/kitchen
// picks them up automatically (existing polling in pos/page.tsx and cocina/page.tsx).

import { type NextRequest, NextResponse } from 'next/server'

const WEBHOOK_SECRET = process.env.UBER_WEBHOOK_SECRET || ''

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
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials&scope=eats.order`,
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
  const apiBase = isProduction ? 'https://api.uber.com' : 'https://api.uber.com'

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
    const body = await request.json()
    const eventType = body.event_type || body.type || ''
    const orderId = body.meta?.resource_id || body.order_id || body.id || ''

    console.log(`[uber-webhook] ${eventType} order=${orderId}`)

    // Verify webhook signature if configured
    if (WEBHOOK_SECRET) {
      const sig = request.headers.get('x-uber-signature') || ''
      // TODO: implement HMAC verification when Uber provides the signing key
      if (!sig) {
        console.warn('[uber-webhook] Missing signature')
      }
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // Derive client_id from store_id mapping or env default
    // For multi-tenant: UBER_STORE_CLIENT_MAP='{"store123":"client_a","store456":"client_b"}'
    const storeId = body.meta?.resource?.store?.store_id || body.store_id || ''
    let clientId = process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || ''
    try {
      const storeMap = JSON.parse(process.env.UBER_STORE_CLIENT_MAP || '{}')
      if (storeMap[storeId]) clientId = storeMap[storeId]
    } catch { /* invalid JSON, use default */ }

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
