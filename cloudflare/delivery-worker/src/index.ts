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

function extractDidiStoreId(body: any): string {
  return String(body.shop_id || body.store_id || body.data?.shop_id || '')
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

function parseDidiOrder(payload: any, clientId: string): DeliveryOrder {
  const order = payload.order || payload.data || payload
  const items: DeliveryItem[] = (order.items || order.order_items || []).map((item: any) => ({
    name: item.name || item.item_name || 'Item',
    qty: item.quantity || item.count || 1,
    price: item.price || item.unit_price || 0,
    notes: item.remark || item.notes || '',
    modifiers: (item.attributes || item.options || []).map((m: any) => m.name || m.value || m).join(', '),
  }))
  return {
    id: `dd-${order.order_id || order.id || Date.now()}`,
    client_id: clientId,
    platform: 'didi',
    platform_order_id: String(order.order_id || order.id || ''),
    status: 'nueva',
    customer_name: order.customer_name || order.receiver_name || 'Cliente Didi',
    customer_phone: order.customer_phone || order.receiver_phone,
    items,
    subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
    delivery_fee: order.delivery_fee || 0,
    platform_commission: order.commission_fee || 0,
    total: order.total_amount || order.pay_amount || items.reduce((s, i) => s + i.price * i.qty, 0),
    notes: order.remark || order.notes || '',
    estimated_pickup: order.estimated_delivery_time || '',
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
      const body = await request.json()

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
      } else if (body.order_id && body.shop_id) {
        provider = 'didi'
      } else {
        return new Response(JSON.stringify({ error: 'Unknown platform. Use /ubereats, /rappi, or /didi path' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
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
      else                           order = parseDidiOrder(body, clientId)

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
