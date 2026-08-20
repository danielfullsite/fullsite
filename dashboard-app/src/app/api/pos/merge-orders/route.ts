import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * Atomic mesa merge + reconciliation of every affected order.
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
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

    // ── Anti-skimming (P0-F): recomputar totales del lado SERVIDOR desde las órdenes en BD
    // (service_role), sin confiar en el cliente. El total de una fusión = suma de los totales
    // YA guardados de ambas órdenes (que ya incluyen sus descuentos). Si el cliente mandó algo
    // distinto (>$1), se audita como skimming_suspect (log-only). Fallback a los del cliente si
    // la lectura falla → nunca peor que hoy.
    let sTotal = total
    try {
      const ordRes = await fetch(
        `${sbUrl}/rest/v1/pos_orders?client_id=eq.${clientId}&id=in.(${target_order_id},${source_order_id})&select=id,total`,
        { headers },
      )
      if (ordRes.ok) {
        const ords = await ordRes.json() as Array<{ total?: number }>
        if (ords.length === 2) {
          sTotal = ords.reduce((s, o) => s + (Number(o.total) || 0), 0)
          const diffCents = Math.abs(Math.round(sTotal * 100) - Math.round((Number(total) || 0) * 100))
          if (diffCents > 100) {
            fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
              method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({
                client_id: clientId, order_id: target_order_id, action: 'skimming_suspect', actor: 'POS-merge',
                details: { server_total: sTotal, client_total: total, diff_cents: diffCents, source_order: source_order_id },
              }),
            }).catch(() => {})
          }
        }
      }
    } catch { /* fallback: usa los totales del cliente */ }

    // Step 1: Atomic merge
    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_merge_orders`, {
      method: 'POST', headers,
      body: JSON.stringify({
        p_client_id: clientId,
        p_target_order_id: target_order_id,
        p_target_expected_revision: target_expected_revision ?? 0,
        p_source_order_id: source_order_id,
        p_source_expected_revision: source_expected_revision ?? 0,
        p_merged_items: merged_items,
        p_total: sTotal, p_subtotal: subtotal, p_iva: iva,   // p_total server-side (P0-F cerrado; subtotal/iva informativos)
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
          body: JSON.stringify({ p_client_id: clientId, p_order_id: orderId }),
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
