/**
 * Delivery Worker — Receives webhooks from Uber Eats, Rappi, Didi Food
 * Saves orders to Supabase delivery_orders table.
 *
 * Tenant resolution:
 *   provider + provider_store_id → integration_store_mappings → client_id
 *   Fail-closed: unknown store → delivery_dlq + Telegram alert, order NOT saved.
 *   Never falls back to any hardcoded tenant.
 *
 * NOTE: Uber Eats webhooks are handled by Integration Framework v1
 * (/api/integrations/uber-eats/webhook). This worker handles Rappi and Didi
 * until those providers get their own adapters.
 */

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  UBEREATS_CLIENT_SECRET: string
  RAPPI_API_KEY: string
  DIDI_APP_SECRET: string
  WEBHOOK_SECRET: string
}

interface DeliveryItem {
  name: string
  qty: number
  price: number
  notes?: string
  modifiers?: string
}

interface DeliveryOrder {
  id: string
  client_id: string
  platform: string
  platform_order_id: string
  status: string
  customer_name: string
  customer_phone?: string
  items: DeliveryItem[]
  subtotal: number
  delivery_fee: number
  platform_commission: number
  total: number
  notes?: string
  estimated_pickup?: string
  raw_payload: unknown
}

// ─── TENANT RESOLUTION ──────────────────────────────────────────────────────

async function resolveClientId(
  env: Env,
  provider: string,
  providerStoreId: string,
): Promise<string | null> {
  if (!providerStoreId) return null
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/integration_store_mappings?provider=eq.${encodeURIComponent(provider)}&provider_store_id=eq.${encodeURIComponent(providerStoreId)}&select=client_id&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    )
    if (!res.ok) return null
    const rows: Array<{ client_id: string }> = await res.json()
    return rows[0]?.client_id ?? null
  } catch {
    return null
  }
}

async function writeDlq(
  env: Env,
  provider: string,
  providerStoreId: string | undefined,
  correlationId: string,
  rawPayload: unknown,
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/delivery_dlq`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ provider, provider_store_id: providerStoreId, correlation_id: correlationId, raw_payload: rawPayload }),
  })

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `[DLQ] Webhook ${provider} sin mapping.\nstore_id: ${providerStoreId || '(no detectado)'}\ncorrelation_id: ${correlationId}\nAgrega el mapping en integration_store_mappings para rutear este pedido.`,
      }),
    })
  }
}

// ─── STORE ID EXTRACTION ─────────────────────────────────────────────────────
// Best-effort extraction of the platform store identifier from the raw payload.
// Used for mapping lookup BEFORE full order parsing.

function extractUberStoreId(body: any): string {
  return body.store?.id || body.store_id || body.restaurant?.id || ''
}

function extractRappiStoreId(body: any): string {
  return String(body.restaurant?.id || body.store?.id || body.store_id || '')
}

export function extractDidiStoreId(body: any): string {
  // DiDi carries the POS-side store id as `app_shop_id` (a quoted string, so it
  // survives JSON.parse). Present top-level on webhooks and under order_info.shop.
  return String(
    body.app_shop_id ||
    body.data?.order_info?.shop?.app_shop_id ||
    body.data?.app_shop_id ||
    body.shop_id || body.store_id || ''
  )
}

// ─── DIDI SIGNATURE ──────────────────────────────────────────────────────────
// DiDi signs webhooks with header `didi-header-sign` = hex MD5(rawBody + APP_SECRET).
// (Uber uses HMAC-SHA256, Rappi its own scheme — DiDi is a plain MD5 concatenation.)
// Cloudflare Workers' crypto.subtle supports the non-standard 'MD5' algorithm.
async function md5Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyDidiSignature(
  rawBody: string,
  headerSign: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret || !headerSign) return false
  const expected = await md5Hex(rawBody + appSecret)
  if (expected.length !== headerSign.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerSign.charCodeAt(i)
  return diff === 0
}

// ─── ORDER PARSERS ───────────────────────────────────────────────────────────

function parseUberEatsOrder(payload: any, clientId: string): DeliveryOrder {
  const order = payload.order || payload
  const items: DeliveryItem[] = (order.items || order.cart?.items || []).map((item: any) => ({
    name: item.title || item.name || 'Item',
    qty: item.quantity || 1,
    price: (item.price?.amount || item.total_price?.amount || 0) / 100,
    notes: item.special_instructions || item.notes || '',
    modifiers: (item.selected_modifier_groups || [])
      .flatMap((g: any) => (g.selected_items || []).map((m: any) => m.title))
      .join(', '),
  }))
  return {
    id: `ue-${order.id || order.order_id || Date.now()}`,
    client_id: clientId,
    platform: 'ubereats',
    platform_order_id: order.id || order.order_id || '',
    status: 'nueva',
    customer_name: order.eater?.first_name || order.customer?.name || 'Cliente Uber',
    customer_phone: order.eater?.phone || order.customer?.phone,
    items,
    subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
    delivery_fee: (order.delivery_fee?.amount || 0) / 100,
    platform_commission: 0,
    total: (order.total?.amount || order.total_price?.amount || 0) / 100 || items.reduce((s, i) => s + i.price * i.qty, 0),
    notes: order.special_instructions || order.notes || '',
    estimated_pickup: order.estimated_ready_for_pickup_at || '',
    raw_payload: payload,
  }
}

function parseRappiOrder(payload: any, clientId: string): DeliveryOrder {
  const order = payload.order || payload
  const items: DeliveryItem[] = (order.items || order.products || []).map((item: any) => ({
    name: item.name || item.product_name || 'Item',
    qty: item.quantity || item.units || 1,
    price: item.price || item.unit_price || 0,
    notes: item.comments || item.notes || '',
    modifiers: (item.toppings || item.modifiers || []).map((m: any) => m.name || m).join(', '),
  }))
  return {
    id: `rp-${order.id || order.order_id || Date.now()}`,
    client_id: clientId,
    platform: 'rappi',
    platform_order_id: String(order.id || order.order_id || ''),
    status: 'nueva',
    customer_name: order.client?.name || order.customer_name || 'Cliente Rappi',
    customer_phone: order.client?.phone || order.customer_phone,
    items,
    subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
    delivery_fee: order.delivery_cost || 0,
    platform_commission: order.commission || 0,
    total: order.total_value || order.total || items.reduce((s, i) => s + i.price * i.qty, 0),
    notes: order.comments || order.notes || '',
    estimated_pickup: order.estimated_pickup_time || '',
    raw_payload: payload,
  }
}

// DiDi order webhook (`orderNew`) mirrors GET /order/order/detail:
//   { data: { order_id, order_info: { price:{...cents}, receive_address:{...},
//             order_items:[{ name, amount, total_price(cents), sub_item_list:[...] }] } } }
// `orderIdStr` is the 64-bit order_id recovered as a string from the raw body
// (JSON.parse corrupts longs), passed in by the handler.
export function parseDidiOrder(payload: any, clientId: string, orderIdStr?: string): DeliveryOrder {
  const info = payload.data?.order_info || payload.data || payload.order || payload
  const price = info.price || {}
  const cents = (n: any): number => (Number(n) || 0) / 100
  const flattenMods = (subs: any[]): string =>
    (subs || [])
      .map((s: any) =>
        [s.name, s.sub_item_list?.length ? flattenMods(s.sub_item_list) : '']
          .filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ')
  const items: DeliveryItem[] = (info.order_items || info.items || []).map((it: any) => ({
    name: it.name || it.item_name || 'Item',
    qty: Number(it.amount ?? it.quantity ?? 1) || 1,
    price: cents(it.total_price ?? it.sku_price ?? 0),
    notes: it.remark || it.notes || '',
    modifiers: flattenMods(it.sub_item_list),
  }))
  const addr = info.receive_address || {}
  const customerName =
    [addr.first_name, addr.last_name].filter(Boolean).join(' ').trim() ||
    addr.name || info.customer_name || 'Cliente Didi'
  const customerPhone = addr.phone
    ? `${addr.calling_code || ''}${addr.phone}`.trim()
    : (info.customer_phone || undefined)
  const orderId = orderIdStr ||
    String(info.order_id ?? payload.data?.order_id ?? payload.order_id ?? Date.now())
  const subtotal = price.order_price != null
    ? cents(price.order_price)
    : items.reduce((s, i) => s + i.price * i.qty, 0)
  const total = price.customer_need_paying_money != null
    ? cents(price.customer_need_paying_money)
    : (price.real_pay_price != null ? cents(price.real_pay_price) : subtotal)
  return {
    id: `dd-${orderId}`,
    client_id: clientId,
    platform: 'didi',
    platform_order_id: orderId,
    status: 'nueva',
    customer_name: customerName,
    customer_phone: customerPhone,
    items,
    subtotal,
    delivery_fee: cents(price.delivery_price),
    platform_commission: 0, // not in the order webhook; comes from reconciliation
    total,
    notes: info.remark || info.notes || '',
    estimated_pickup: info.expected_cook_eta
      ? new Date(Number(info.expected_cook_eta) * 1000).toISOString()
      : '',
    raw_payload: payload,
  }
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Delivery webhook endpoint. POST only.', { status: 200 })
    }

    const url = new URL(request.url)
    const path = url.pathname
    const correlationId = crypto.randomUUID()

    try {
      // Read the raw body once: needed for DiDi signature verification and to
      // recover DiDi's 64-bit order_id before JSON.parse corrupts it.
      const rawBody = await request.text()
      const body = JSON.parse(rawBody)

      // Detect provider
      let provider: string
      if (path.includes('/ubereats') || path.includes('/uber')) {
        provider = 'ubereats'
      } else if (path.includes('/rappi')) {
        provider = 'rappi'
      } else if (path.includes('/didi')) {
        provider = 'didi'
      } else if (body.eater || body.store_id) {
        provider = 'ubereats'
      } else if (body.client || body.store) {
        provider = 'rappi'
      } else if (body.type === 'orderNew' || body.app_shop_id || (body.order_id && body.shop_id)) {
        provider = 'didi'
      } else {
        return new Response(JSON.stringify({ error: 'Unknown platform. Use /ubereats, /rappi, or /didi path' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      // DiDi webhook signature (this worker is the DiDi receiver). Fail-closed:
      // reject anything not signed with MD5(rawBody + DIDI_APP_SECRET).
      if (provider === 'didi') {
        const ok = await verifyDidiSignature(rawBody, request.headers.get('didi-header-sign'), env.DIDI_APP_SECRET)
        if (!ok) {
          return new Response(JSON.stringify({ error: 'Invalid DiDi signature' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      // Extract store ID for tenant lookup
      let providerStoreId: string
      if (provider === 'ubereats') providerStoreId = extractUberStoreId(body)
      else if (provider === 'rappi')  providerStoreId = extractRappiStoreId(body)
      else                             providerStoreId = extractDidiStoreId(body)

      // Resolve tenant — fail-closed if no mapping exists
      const clientId = await resolveClientId(env, provider, providerStoreId)
      if (!clientId) {
        await writeDlq(env, provider, providerStoreId, correlationId, body)
        return new Response(JSON.stringify({ status: 'dlq', reason: 'no_mapping', correlation_id: correlationId }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }

      // Parse full order
      let order: DeliveryOrder
      if (provider === 'ubereats')   order = parseUberEatsOrder(body, clientId)
      else if (provider === 'rappi') order = parseRappiOrder(body, clientId)
      else {
        // DiDi order_id is a 64-bit long; recover it as a string from the raw body.
        const m = rawBody.match(/"order_id"\s*:\s*"?(\d+)"?/)
        order = parseDidiOrder(body, clientId, m?.[1])
      }

      // Save to Supabase
      const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/delivery_orders`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: order.id,
          client_id: order.client_id,
          platform: order.platform,
          platform_order_id: order.platform_order_id,
          status: order.status,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          items: JSON.stringify(order.items),
          subtotal: order.subtotal,
          delivery_fee: order.delivery_fee,
          platform_commission: order.platform_commission,
          total: order.total,
          notes: order.notes,
          estimated_pickup: order.estimated_pickup,
          raw_payload: JSON.stringify(order.raw_payload),
          updated_at: new Date().toISOString(),
        }),
      })

      if (!sbRes.ok) {
        console.error(`Supabase error: ${sbRes.status} ${await sbRes.text()}`)
      }

      // Send Telegram notification
      const platformEmoji: Record<string, string> = { ubereats: '🟢', rappi: '🟠', didi: '🔶' }
      const platformName: Record<string, string> = { ubereats: 'Uber Eats', rappi: 'Rappi', didi: 'Didi Food' }
      const itemsList = order.items.map(i => `  ${i.qty}x ${i.name}${i.modifiers ? ` (${i.modifiers})` : ''}`).join('\n')

      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: `${platformEmoji[provider] || '📦'} NUEVO PEDIDO — ${platformName[provider] || provider}\n\n` +
            `Cliente: ${order.customer_name}\nTotal: $${order.total.toFixed(0)}\n\n${itemsList}` +
            (order.notes ? `\nNota: ${order.notes}` : '') +
            (order.estimated_pickup ? `\nRecoger: ${order.estimated_pickup}` : ''),
        }),
      })

      return new Response(JSON.stringify({
        status: 'ok',
        order_id: order.id,
        platform: order.platform,
        items_count: order.items.length,
        total: order.total,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    } catch (error) {
      console.error('Webhook error:', error)
      return new Response(JSON.stringify({ error: 'Internal error', detail: String(error) }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  },
}
