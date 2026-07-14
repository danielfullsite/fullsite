import { NextRequest } from 'next/server'

/**
 * R2D1 + R2 Final — Revision-aware order save + R1 reconciliation boundary.
 *
 * TEMPORARY AMALAY FIELD-CERT BOUNDARY.
 * client_id is server-fixed to 'amalay'. Browser cannot choose arbitrary tenant.
 * P0 TENANT ISOLATION ARCHITECTURE remains open.
 *
 * Transaction semantics:
 * - Order save and reconciliation are SEPARATE operations
 * - If save succeeds but reconciliation fails, the order is committed
 *   and the revision remains PENDING (discoverable for retry)
 * - A successful save does NOT imply inventory COMPLETE
 */

const CLIENT_ID = 'amalay'

interface SaveResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  error?: string
  expected_revision?: number
  current_revision?: number
  inventory_status?: 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
  inventory_results?: Array<{ r_item_id: string; r_result: string; r_applied: number; r_delta: number }>
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { order_id, expected_revision } = body
    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' } satisfies SaveResult, { status: 400 })
    }
    if (typeof expected_revision !== 'number' || expected_revision < 0) {
      return Response.json({ ok: false, error: 'INVALID_REVISION' } satisfies SaveResult, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' } satisfies SaveResult, { status: 500 })
    }

    const headers = {
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }

    // Step 1: Save order via r1_save_order
    const saveRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_save_order`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_client_id: CLIENT_ID,
        p_order_id: order_id,
        p_expected_revision: expected_revision,
        p_mesa: body.mesa ?? null,
        p_customer_name: body.customer_name ?? null,
        p_mesero: body.mesero ?? null,
        p_personas: body.personas ?? null,
        p_status: body.status ?? null,
        p_subtotal: body.subtotal ?? null,
        p_iva: body.iva ?? null,
        p_total: body.total ?? null,
        p_descuento: body.descuento ?? null,
        p_propina: body.propina ?? null,
        p_metodo_pago: body.metodo_pago ?? null,
        p_pagos: body.pagos ?? null,
        p_turno_id: body.turno_id ?? null,
        p_notas: body.notas ?? null,
        p_items: body.items ?? null,
        p_closed_at: body.closed_at ?? null,
      }),
    })

    if (!saveRes.ok) {
      const errText = await saveRes.text()
      console.error('[save-order] RPC error:', saveRes.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' } satisfies SaveResult, { status: 502 })
    }

    const saveResult = await saveRes.json()

    // If save was rejected (stale/not found), return immediately — no reconciliation
    if (!saveResult.ok) {
      return Response.json(saveResult satisfies SaveResult)
    }

    // Step 2: Reconcile order (separate operation — save already committed)
    // If reconciliation fails, the order revision remains PENDING (discoverable for retry)
    let inventoryStatus: SaveResult['inventory_status'] = 'PENDING'
    let inventoryResults: SaveResult['inventory_results'] = []

    try {
      const reconRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_reconcile_order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_client_id: CLIENT_ID,
          p_order_id: order_id,
        }),
      })

      if (reconRes.ok) {
        const reconRows = await reconRes.json()
        inventoryResults = Array.isArray(reconRows) ? reconRows : []

        // Determine inventory status from results
        const hasBlocked = inventoryResults.some(r => r.r_result?.startsWith('BLOCKED'))
        const allComplete = inventoryResults.every(r =>
          r.r_result === 'RECONCILED' || r.r_result === 'NO_MUTATION_APPROVED'
        )

        if (inventoryResults.length === 0) {
          inventoryStatus = 'SKIPPED' // No inventory-relevant items
        } else if (allComplete) {
          inventoryStatus = 'COMPLETE'
        } else if (hasBlocked) {
          inventoryStatus = 'BLOCKED'
        } else {
          inventoryStatus = 'PENDING'
        }
      } else {
        const errText = await reconRes.text()
        console.error('[save-order] Reconciliation RPC error:', reconRes.status, errText)
        inventoryStatus = 'PENDING' // Save committed, reconciliation failed — remains discoverable
      }
    } catch (reconErr) {
      console.error('[save-order] Reconciliation exception:', reconErr)
      inventoryStatus = 'PENDING' // Save committed, reconciliation failed
    }

    const result: SaveResult = {
      ok: true,
      revision: saveResult.revision,
      conflict: false,
      inventory_status: inventoryStatus,
      inventory_results: inventoryResults,
    }

    return Response.json(result)
  } catch (err) {
    console.error('[save-order] Unexpected error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' } satisfies SaveResult, { status: 500 })
  }
}
