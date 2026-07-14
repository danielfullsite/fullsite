import { NextRequest } from 'next/server'

/**
 * Phase 4 — Manual market stock adjustment via constrained server boundary.
 * Independent of sale_authority (manual adjustments always allowed).
 * TEMPORARY AMALAY FIELD-CERT BOUNDARY.
 */
const CLIENT_ID = 'amalay'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { menu_item_id, adjustment_type, quantity, actor, notes } = body

    if (!menu_item_id || !adjustment_type || quantity == null) {
      return Response.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 })
    }
    if (!['entrada', 'merma', 'ajuste_absoluto'].includes(adjustment_type)) {
      return Response.json({ ok: false, error: 'INVALID_TYPE' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_adjust_market_stock`, {
      method: 'POST',
      headers: {
        'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_client_id: CLIENT_ID,
        p_menu_item_id: menu_item_id,
        p_adjustment_type: adjustment_type,
        p_quantity: quantity,
        p_actor: actor || 'almacen',  // REPORTED_ACTOR — not server-verified
        p_notes: notes || null,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[adjust-market] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[adjust-market] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
