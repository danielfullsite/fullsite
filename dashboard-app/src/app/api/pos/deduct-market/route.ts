import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

function parseItems(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null
  } catch { return null }
}

/**
 * Phase 3 — Legacy direct-stock sale deduction via serialized authority boundary.
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()
    const { order_id } = body

    if (typeof order_id !== 'string' || !order_id || order_id.length > 200) {
      return Response.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    const headers = {
      'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    }

    // The legacy RPC only used order_id as an idempotency label; it did not prove
    // the order existed and trusted arbitrary item quantities. Resolve the closed
    // sale first and derive the deduction from its committed tenant-scoped row.
    // Offline replay is preserved because save-order is queued immediately before
    // this operation and the queue drains sequentially.
    const orderRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}` +
        `&client_id=eq.${encodeURIComponent(clientId)}&select=id,status,items&limit=1`,
      { headers, cache: 'no-store' },
    )
    if (!orderRes.ok) return Response.json({ ok: false, error: 'ORDER_AUTHORITY_UNAVAILABLE' }, { status: 503 })
    const rows = await orderRes.json() as Array<{ id?: unknown; status?: unknown; items?: unknown }>
    const order = Array.isArray(rows) ? rows[0] : null
    if (!order) return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
    if (!['cerrada', 'completada'].includes(String(order.status))) {
      return Response.json({ ok: false, error: 'ORDER_NOT_CLOSED' }, { status: 409 })
    }

    const savedItems = parseItems(order.items)
    if (!savedItems) return Response.json({ ok: false, error: 'ORDER_ITEMS_INVALID' }, { status: 409 })
    const quantities = new Map<string, number>()
    for (const item of savedItems) {
      if (item?.cancelled) continue
      const menuItemId = typeof item?.menuItemId === 'string' ? item.menuItemId.trim() : ''
      const quantity = Number(item?.cantidad)
      if (!menuItemId || menuItemId === '__tiempo__') continue
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000) {
        return Response.json({ ok: false, error: 'ORDER_ITEMS_INVALID' }, { status: 409 })
      }
      quantities.set(menuItemId, (quantities.get(menuItemId) ?? 0) + quantity)
    }
    const authoritativeItems = [...quantities.entries()].map(([menu_item_id, cantidad]) => ({ menu_item_id, cantidad }))
    if (authoritativeItems.length === 0) {
      return Response.json({ ok: true, skipped: 'NO_MARKET_ITEMS', deductions: [] })
    }

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_legacy_sale_deduction`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_client_id: clientId,
        p_order_id: order_id,
        p_actor: auth.staffName || auth.staffId,
        p_items: authoritativeItems,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[deduct-market] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    const result = await res.json()
    // Tenant con autoridad r1: aqui no hay nada que descontar. Es un no-op, no un
    // rechazo: el cobro offline encola esta llamada y un ok:false la marcaria
    // conflicto terminal en cada terminal (barrido 2026-09-10).
    if (result && result.ok === false && result.error === 'AUTHORITY_NOT_LEGACY') {
      return Response.json({ ok: true, skipped: 'AUTHORITY_NOT_LEGACY', deductions: [] })
    }
    return Response.json(result)
  } catch (err) {
    console.error('[deduct-market] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
