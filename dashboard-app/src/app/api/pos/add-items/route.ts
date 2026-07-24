import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request)
    const body = await request.json()
    const { order_id, items } = body

    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' }, { status: 400 })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ ok: false, error: 'INVALID_ITEMS' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
    }

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_add_items`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ p_client_id: clientId, p_order_id: order_id, p_items: items }),
    })

    if (!res.ok) {
      console.error('[add-items] RPC error:', res.status, await res.text())
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[add-items] error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
