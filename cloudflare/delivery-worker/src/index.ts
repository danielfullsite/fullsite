/**
 * Delivery Worker — Receives webhooks from Uber Eats, Rappi, Didi Food
 * Saves orders to Supabase delivery_orders table
 * Sends notification to Telegram
 */

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  UBEREATS_CLIENT_SECRET: string
  RAPPI_API_KEY: string
  DIDI_APP_SECRET: string
  WEBHOOK_SECRET: string  // For verifying our own internal calls
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

// ─── UBER EATS ──────────────────────────────────────────────────────────

function parseUberEatsOrder(payload: any): DeliveryOrder {
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
    client_id: 'amalay',
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

// ─── RAPPI ──────────────────────────────────────────────────────────────

function parseRappiOrder(payload: any): DeliveryOrder {
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
    client_id: 'amalay',
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

// ─── DIDI FOOD ──────────────────────────────────────────────────────────

function parseDidiOrder(payload: any): DeliveryOrder {
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
    client_id: 'amalay',
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

// ─── MAIN HANDLER ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Delivery webhook endpoint. POST only.', { status: 200 })
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      const body = await request.json()

      let order: DeliveryOrder

      // Route based on path
      if (path.includes('/ubereats') || path.includes('/uber')) {
        order = parseUberEatsOrder(body)
      } else if (path.includes('/rappi')) {
        order = parseRappiOrder(body)
      } else if (path.includes('/didi')) {
        order = parseDidiOrder(body)
      } else {
        // Try to detect from payload
        if (body.eater || body.store_id) {
          order = parseUberEatsOrder(body)
        } else if (body.client || body.store) {
          order = parseRappiOrder(body)
        } else if (body.order_id && body.shop_id) {
          order = parseDidiOrder(body)
        } else {
          return new Response(JSON.stringify({ error: 'Unknown platform. Use /ubereats, /rappi, or /didi path' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
          })
        }
      }

      // Save to Supabase
      const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/delivery_orders`, {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
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
      const emoji = platformEmoji[order.platform] || '📦'
      const pName = platformName[order.platform] || order.platform

      const itemsList = order.items.map(i => `  ${i.qty}x ${i.name}${i.modifiers ? ` (${i.modifiers})` : ''}`).join('\n')

      const msg = `${emoji} NUEVO PEDIDO — ${pName}\n\n` +
        `Cliente: ${order.customer_name}\n` +
        `Total: $${order.total.toFixed(0)}\n\n` +
        `${itemsList}\n` +
        (order.notes ? `\nNota: ${order.notes}\n` : '') +
        (order.estimated_pickup ? `\nRecoger: ${order.estimated_pickup}` : '')

      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: msg,
        }),
      })

      return new Response(JSON.stringify({
        status: 'ok',
        order_id: order.id,
        platform: order.platform,
        items_count: order.items.length,
        total: order.total,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    } catch (error) {
      console.error('Webhook error:', error)
      return new Response(JSON.stringify({ error: 'Internal error', detail: String(error) }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }
  },
}
