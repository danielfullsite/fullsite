import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyManagerApproval } from '@/lib/manager-approval'

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

type TurnoResolution =
  | { ok: true; turnoId: string; reassigned: boolean }
  | { ok: false; error: 'TURN_NOT_FOUND' | 'TURN_CLOSED_NO_ACTIVE' | 'TURN_CLOSED_CONFLICT' }

/**
 * Resolve the shift at the application boundary before an offline save reaches the RPC.
 *
 * A queued order can carry a shift that was open when captured but closed before replay.
 * New orders are moved only to the currently-open shift. Existing writes and updates fail
 * closed so money is never silently moved between cash closures. A previously committed
 * idempotent operation is allowed through unchanged; the RPC will return its original
 * result without executing the write again.
 *
 * INCIDENTE 2026-08-31 — este select pedia `location_id`, que NO EXISTE en pos_turnos.
 * PostgREST responde 400 ante una columna inexistente, `turnoRes.ok` era false, y la
 * funcion devolvia TURN_NOT_FOUND -> HTTP 409 en CADA orden, con turno abierto o sin el.
 * El POS de AMALAY quedo sin poder enviar comandas. Columnas reales de pos_turnos:
 *   id, client_id, opened_by, fondo_inicial, opened_at,
 *   closed_by, fondo_final, efectivo_sistema, diferencia, closed_at, notas
 * Por eso el filtro por sucursal se retira: esa columna no existe en esta tabla (si en
 * pos_orders). Cuando pos_turnos tenga location_id, se vuelve a agregar CON su prueba.
 */

/** Columnas que este endpoint pide de pos_turnos. Deben existir de verdad — ver
 *  `src/__tests__/pos-turnos-columnas.test.ts`, que las contrasta con el esquema real. */
export const TURNO_SELECT_COLUMNS = ['id', 'closed_at'] as const
async function resolveTurnoForSave(
  body: Record<string, unknown>,
  clientId: string,
  sbUrl: string,
  headers: Record<string, string>,
): Promise<TurnoResolution> {
  const requestedTurnoId = typeof body.turno_id === 'string' ? body.turno_id : ''
  if (!requestedTurnoId) return { ok: false, error: 'TURN_NOT_FOUND' }

  const turnoRes = await fetch(
    `${sbUrl}/rest/v1/pos_turnos?id=eq.${encodeURIComponent(requestedTurnoId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}&select=${TURNO_SELECT_COLUMNS.join(',')}&limit=1`,
    { headers },
  )
  if (!turnoRes.ok) return { ok: false, error: 'TURN_NOT_FOUND' }
  const turnos = await turnoRes.json() as Array<{ id: string; closed_at: string | null }>
  const requested = turnos[0]
  if (!requested) return { ok: false, error: 'TURN_NOT_FOUND' }
  if (!requested.closed_at) return { ok: true, turnoId: requested.id, reassigned: false }

  const operationId = typeof body.save_operation_id === 'string' ? body.save_operation_id : ''
  const orderId = typeof body.order_id === 'string' ? body.order_id : ''
  if (operationId && orderId) {
    const opRes = await fetch(
      `${sbUrl}/rest/v1/pos_save_operations?client_id=eq.${encodeURIComponent(clientId)}` +
        `&order_id=eq.${encodeURIComponent(orderId)}` +
        `&save_operation_id=eq.${encodeURIComponent(operationId)}&state=eq.COMMITTED&select=state&limit=1`,
      { headers },
    )
    if (opRes.ok) {
      const operations = await opRes.json() as Array<{ state: string }>
      if (operations.length > 0) {
        return { ok: true, turnoId: requested.id, reassigned: false }
      }
    }
  }

  // Only a brand-new order may move to the replacement shift. Updates/cobros require
  // an operator-visible conflict because changing their accounting period is material.
  if (body.expected_revision !== 0) return { ok: false, error: 'TURN_CLOSED_CONFLICT' }

  // Reassignment is safe only when the captured timestamp proves the sale happened
  // after the old shift closed. A late sync captured before closure belongs to the old
  // accounting period and needs explicit manager reconciliation instead.
  const capturedMs = typeof body.captured_at === 'string' ? Date.parse(body.captured_at) : Number.NaN
  const closedMs = Date.parse(requested.closed_at)
  if (!Number.isFinite(capturedMs) || !Number.isFinite(closedMs) || capturedMs <= closedMs) {
    return { ok: false, error: 'TURN_CLOSED_CONFLICT' }
  }

  // Sin filtro por sucursal: pos_turnos no tiene location_id (ver nota del incidente
  // arriba). Filtrar por una columna inexistente devolvia 400 y rompia todo el endpoint.
  const activeRes = await fetch(
    `${sbUrl}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(clientId)}` +
      `&closed_at=is.null&select=id&order=opened_at.desc&limit=1`,
    { headers },
  )
  if (!activeRes.ok) return { ok: false, error: 'TURN_CLOSED_NO_ACTIVE' }
  const active = await activeRes.json() as Array<{ id: string }>
  if (!active[0]?.id) return { ok: false, error: 'TURN_CLOSED_NO_ACTIVE' }

  return { ok: true, turnoId: active[0].id, reassigned: true }
}

/**
 * Tasa de IVA del tenant, resuelta SIEMPRE del servidor.
 *
 * No se lee del body a propósito: si la tasa viniera del cliente, bastaría con mandar una
 * falsa para que el total rebajado cuadrara y el detector de skimming se callara.
 *
 * Cacheada por instancia — la tasa cambia con la configuración del restaurante, no con la
 * orden, y este camino corre al cerrar cada cuenta. Devuelve `null` si no se puede resolver;
 * el llamador entonces NO audita (ver el comentario de la detección).
 */
const _ivaRateCache = new Map<string, number>()
async function ivaRateFor(
  clientId: string,
  sbUrl: string,
  headers: Record<string, string>,
): Promise<number | null> {
  const cached = _ivaRateCache.get(clientId)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=iva_rate&limit=1`,
      { headers },
    )
    if (!res.ok) return null
    // PostgREST devuelve numeric como STRING — de ahí el Number().
    const rows = await res.json() as Array<{ iva_rate?: number | string | null }>
    const raw = rows?.[0]?.iva_rate
    if (raw === undefined || raw === null) return null
    const rate = Number(raw)
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null
    _ivaRateCache.set(clientId, rate)
    return rate
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()

    const { order_id, expected_revision } = body
    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' } satisfies SaveResult, { status: 400 })
    }
    if (typeof expected_revision !== 'number' || expected_revision < 0) {
      return Response.json({ ok: false, error: 'INVALID_REVISION' } satisfies SaveResult, { status: 400 })
    }

    if (body.conflict_resolution === true) {
      const approval = await verifyManagerApproval({
        approvalToken: body.approval_token,
        clientId,
        minLevel: 4,
      })
      // Conflict rebases overwrite a newer server revision. Unlike the gradual
      // rollout used by legacy sensitive actions, this path is strict from day one:
      // only a fresh, signed online manager token may authorize it.
      if (!approval.ok || !approval.mode.startsWith('online:')) {
        return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' } satisfies SaveResult, { status: 403 })
      }
    }

    // R1 reconciliation server-side (P0 dinero): el invariante sum(pagos)==total+propina
    // solo se validaba en el cliente (pos-data.ts); el replay offline de la cola y
    // cualquier caller directo lo saltaban -> se commiteaban cierres con pagos que no
    // cuadran = descuadre silencioso en arqueo. Se replica EXACTO (centavos) aqui porque
    // este route corre en TODO write, incluido el replay.
    if (body.status === 'cerrada' && Array.isArray(body.pagos) && body.pagos.length > 0) {
      const toCents = (n: unknown) => Math.round((Number(n) || 0) * 100)
      const pagosSum = body.pagos.reduce((s: number, p: { monto?: number }) => s + toCents(p?.monto ?? 0), 0)
      const expected = toCents(body.total) + toCents(body.propina ?? 0)
      if (pagosSum !== expected) {
        return Response.json({ ok: false, error: 'PAYMENT_MISMATCH' } satisfies SaveResult, { status: 400 })
      }
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

    // ── Detección de skimming (Fase 1 · log-only · CERO riesgo) ──
    // r1_save_order guarda el `total` que manda el cliente (COALESCE(p_total, total)). El
    // vector: bajar el `total` dejando los items → sum(items) − descuento ≠ total; el arqueo
    // cuadra (pagos==total) y la diferencia se embolsa. Aquí recomputamos desde los items y
    // AUDITAMOS la discrepancia — NO rechazamos (Fase 2 rechazará vía flag tras observar).
    //
    // El total que arma el POS es `subtotal_tras_descuento * (1 + iva_rate)` (pos/page.tsx:2889).
    // La version anterior comparaba la suma de items SIN IVA contra ese total CON IVA, asi que
    // disparaba en cada ticket cerrado de cualquier restaurante con iva_rate > 0 — 5 de los 8
    // tenants, AMALAY incluido. Los 15 eventos que habia en pos_audit_log al 2026-08-26 eran
    // todos ese falso positivo (1888 -> 2190.08 = x1.16 exacto).
    //
    // Un detector log-only que dispara siempre no es conservador: es ruido que tapa el caso real.
    if (body.status === 'cerrada' && Array.isArray(body.items) && body.items.length > 0) {
      try {
        const ivaRate = await ivaRateFor(clientId, sbUrl, headers)
        // Sin tasa resoluble no se audita: preferimos no reportar a reportar de mas.
        if (ivaRate !== null) {
          const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)
          const sumItems = (body.items as Array<{ subtotal?: number; cancelled?: boolean }>)
            .filter(it => !it?.cancelled)
            .reduce((s, it) => s + cents(it?.subtotal ?? 0), 0)
          const base = sumItems - cents(body.descuento ?? 0)
          const expectedTotal = base + Math.round(base * ivaRate)
          const declaredTotal = cents(body.total ?? 0)
          const diff = expectedTotal - declaredTotal
          // Solo la direccion del fraude: cobrar MENOS que los items. Un total mayor al
          // esperado no es skimming (no hay faltante que embolsarse), y marcarlo asi
          // duplicaba la superficie de falsos positivos.
          if (diff > 100) { // tolerancia $1 (redondeo/combos/promos)
            console.warn('[skimming-suspect]', order_id, { sumItems, descuento: body.descuento, ivaRate, expectedTotal, declaredTotal, diffCents: diff })
            fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
              method: 'POST',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({
                client_id: clientId, order_id,
                action: 'skimming_suspect', actor: body.mesero || 'POS',
                details: {
                  sum_items_cents: sumItems, descuento: body.descuento ?? 0,
                  iva_rate: ivaRate, expected_total_cents: expectedTotal,
                  declared_total: body.total ?? 0, diff_cents: diff,
                },
              }),
            }).catch(() => {})
          }
        }
      } catch { /* detección best-effort — NUNCA bloquea el guardado */ }
    }

    // ── Shift validation: replay must never write into a closed cash period ──
    const hasOperationId = typeof body.save_operation_id === 'string' && body.save_operation_id.length > 0
    const turno = await resolveTurnoForSave(body, clientId, sbUrl, headers)
    if (!turno.ok) {
      return Response.json(
        { ok: false, conflict: true, error: turno.error } satisfies SaveResult,
        { status: 409 },
      )
    }
    if (turno.reassigned) {
      console.warn('[save-order] offline order reassigned from closed turno', {
        orderId: order_id,
        previousTurnoId: body.turno_id,
        activeTurnoId: turno.turnoId,
      })
    }

    // ── Step 1: Save order via idempotent wrapper (or legacy direct) ──
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
      p_turno_id: turno.turnoId,
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

    // Persist fields that predate the RPC signature. captured_at is client supplied but
    // accepted only as a valid timestamp no more than five minutes in the future.
    const capturedMs = typeof body.captured_at === 'string' ? Date.parse(body.captured_at) : Number.NaN
    const capturedAt = Number.isFinite(capturedMs) && capturedMs <= Date.now() + 5 * 60_000
      ? new Date(capturedMs).toISOString()
      : null
    const supplementalPatch: Record<string, unknown> = {}
    if (body.comanda_batches) supplementalPatch.comanda_batches = body.comanda_batches
    // captured_at is immutable provenance: only the create operation may set it.
    if (capturedAt && body.expected_revision === 0) supplementalPatch.captured_at = capturedAt

    // Written as a separate PATCH to avoid breaking the deployed RPC signature.
    if (Object.keys(supplementalPatch).length > 0) {
      try {
        await fetch(`${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(supplementalPatch),
        })
      } catch (err) { console.error('[save-order] supplemental patch error (non-blocking):', err) }
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
