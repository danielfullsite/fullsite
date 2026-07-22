import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

/**
 * R2D1 + R2 Final + R2D — Revision-aware order save + R1 reconciliation boundary
 * + exactly-once save operation idempotency.
 *
 * Transaction semantics:
 * - Order save and reconciliation are SEPARATE operations
 * - If save succeeds but reconciliation fails, the order is committed
 *   and the revision remains PENDING (discoverable for retry)
 * - A successful save does NOT imply inventory COMPLETE
 *
 * R2D Idempotency:
 * - If save_operation_id is provided, uses r1_save_order_idempotent
 * - Replay of same operation returns original committed result without re-executing save
 * - Inventory status is derived dynamically from current lineage, never frozen
 * - Legacy requests without save_operation_id bypass idempotency (OCC-protected only)
 */

interface SaveResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  error?: string
  expected_revision?: number
  current_revision?: number
  inventory_status?: 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
  inventory_results?: Array<{ r_item_id: string; r_result: string; r_applied: number; r_delta: number }>
  first_execution?: boolean
  idempotent_replay?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request)
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

    // ── Step 1: Save order via idempotent wrapper (or legacy direct) ──
    const hasOperationId = typeof body.save_operation_id === 'string' && body.save_operation_id.length > 0
    const rpcName = hasOperationId ? 'r1_save_order_idempotent' : 'r1_save_order'

    const rpcParams: Record<string, unknown> = {
      p_client_id: clientId,
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
    }

    if (hasOperationId) {
      rpcParams.p_save_operation_id = body.save_operation_id
    }

    const saveRes = await fetch(`${sbUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcParams),
    })

    if (!saveRes.ok) {
      const errText = await saveRes.text()
      console.error('[save-order] RPC error:', saveRes.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' } satisfies SaveResult, { status: 502 })
    }

    const saveResult = await saveRes.json()

    // If save was rejected (stale/not found/payload corruption), return immediately
    if (!saveResult.ok) {
      return Response.json(saveResult satisfies SaveResult)
    }

    // Eduardo Jul 21 (Batch 5): persist comanda_batches alongside the order
    // Written as separate PATCH to avoid modifying the RPC function
    if (body.comanda_batches) {
      try {
        await fetch(`${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ comanda_batches: body.comanda_batches }),
        })
      } catch { /* non-blocking — KDS will fall back to single card */ }
    }

    // ── Step 2: Reconciliation ──
    // FIRST_EXECUTION: always invoke reconciliation
    // IDEMPOTENT_REPLAY: invoke only if inventory not yet processed for committed revision
    const isFirstExecution = saveResult.first_execution === true
    const isIdempotentReplay = saveResult.idempotent_replay === true
    const committedRevision = saveResult.revision

    let shouldReconcile = isFirstExecution

    if (isIdempotentReplay && committedRevision != null) {
      // Check current inventory lineage for catch-up determination
      try {
        const lineageRes = await fetch(
          `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=last_inventory_processed_revision`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        )
        if (lineageRes.ok) {
          const lineageRows = await lineageRes.json()
          if (Array.isArray(lineageRows) && lineageRows.length > 0) {
            const processedRev = lineageRows[0].last_inventory_processed_revision
            shouldReconcile = processedRev == null || processedRev < committedRevision
          } else {
            shouldReconcile = true // can't determine — attempt reconciliation
          }
        }
      } catch {
        // Can't read lineage — attempt reconciliation as catch-up (idempotent)
        shouldReconcile = true
      }
    }

    let inventoryStatus: SaveResult['inventory_status'] = 'PENDING'
    let inventoryResults: SaveResult['inventory_results'] = []

    if (shouldReconcile) {
      try {
        const reconRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_reconcile_order`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_client_id: clientId,
            p_order_id: order_id,
          }),
        })

        if (reconRes.ok) {
          const reconRows = await reconRes.json()
          inventoryResults = Array.isArray(reconRows) ? reconRows : []

          const hasBlocked = inventoryResults.some(r => r.r_result?.startsWith('BLOCKED'))
          const allComplete = inventoryResults.every(r =>
            r.r_result === 'RECONCILED' || r.r_result === 'NO_MUTATION_APPROVED'
          )

          if (inventoryResults.length === 0) {
            inventoryStatus = 'SKIPPED'
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
          inventoryStatus = 'PENDING'
        }
      } catch (reconErr) {
        console.error('[save-order] Reconciliation exception:', reconErr)
        inventoryStatus = 'PENDING'
      }
    } else {
      // Derive inventory status from current lineage (no reconciliation call)
      try {
        const statusRes = await fetch(
          `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=last_inventory_processed_revision,last_inventory_complete_revision`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        )
        if (statusRes.ok) {
          const statusRows = await statusRes.json()
          if (Array.isArray(statusRows) && statusRows.length > 0) {
            const row = statusRows[0]
            const processedRev = row.last_inventory_processed_revision
            const completeRev = row.last_inventory_complete_revision
            if (completeRev != null && completeRev >= committedRevision) {
              inventoryStatus = 'COMPLETE'
            } else if (processedRev != null && processedRev >= committedRevision) {
              inventoryStatus = 'BLOCKED' // processed but not complete
            } else {
              inventoryStatus = 'PENDING'
            }
          }
        }
      } catch {
        inventoryStatus = 'PENDING'
      }
    }

    const result: SaveResult = {
      ok: true,
      revision: committedRevision,
      conflict: false,
      inventory_status: inventoryStatus,
      inventory_results: inventoryResults.length > 0 ? inventoryResults : undefined,
      first_execution: isFirstExecution,
      idempotent_replay: isIdempotentReplay,
    }

    return Response.json(result)
  } catch (err) {
    console.error('[save-order] Unexpected error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' } satisfies SaveResult, { status: 500 })
  }
}
