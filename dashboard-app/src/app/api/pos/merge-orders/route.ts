import { NextRequest } from 'next/server'

/**
 * R2D1B Phase 1 — Atomic mesa merge boundary.
 * TEMPORARY AMALAY FIELD-CERT BOUNDARY.
 */
const CLIENT_ID = 'amalay'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { target_order_id, target_expected_revision, source_order_id, source_expected_revision,
            merged_items, total, subtotal, iva, personas, notas } = body

    if (!target_order_id || !source_order_id) {
      return Response.json({ ok: false, error: 'INVALID_ORDER_IDS' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_merge_orders`, {
      method: 'POST',
      headers: {
        'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_client_id: CLIENT_ID,
        p_target_order_id: target_order_id,
        p_target_expected_revision: target_expected_revision ?? 0,
        p_source_order_id: source_order_id,
        p_source_expected_revision: source_expected_revision ?? 0,
        p_merged_items: merged_items,
        p_total: total, p_subtotal: subtotal, p_iva: iva,
        p_personas: personas, p_notas: notas,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[merge-orders] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[merge-orders] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
