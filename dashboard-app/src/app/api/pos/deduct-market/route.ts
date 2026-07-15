import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

/**
 * Phase 3 — Legacy direct-stock sale deduction via serialized authority boundary.
 */

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request)
    const body = await request.json()
    const { order_id, actor, items } = body

    if (!order_id || !Array.isArray(items)) {
      return Response.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_legacy_sale_deduction`, {
      method: 'POST',
      headers: {
        'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_client_id: clientId,
        p_order_id: order_id,
        p_actor: actor || 'pos',
        p_items: items,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[deduct-market] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[deduct-market] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
