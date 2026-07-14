import { NextRequest } from 'next/server'

/**
 * Atomic mesa merge + reconciliation of every affected order.
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

    const headers = {
      'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    }

    // Step 1: Atomic merge
    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_merge_orders`, {
      method: 'POST', headers,
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

    const mergeResult = await res.json()
    if (!mergeResult.ok) return Response.json(mergeResult)

    // Step 2: Reconcile BOTH affected orders (target got items, source got cancelled)
    const reconResults: Record<string, unknown[]> = {}
    for (const orderId of [target_order_id, source_order_id]) {
      try {
        const reconRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_reconcile_order`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_client_id: CLIENT_ID, p_order_id: orderId }),
        })
        if (reconRes.ok) {
          reconResults[orderId] = await reconRes.json()
        } else {
          console.error(`[merge-orders] Reconciliation failed for ${orderId}`)
          reconResults[orderId] = [{ error: 'RECONCILIATION_FAILED' }]
        }
      } catch (err) {
        console.error(`[merge-orders] Reconciliation error for ${orderId}:`, err)
        reconResults[orderId] = [{ error: 'RECONCILIATION_EXCEPTION' }]
      }
    }

    return Response.json({
      ...mergeResult,
      reconciliation: reconResults,
    })
  } catch (err) {
    console.error('[merge-orders] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
