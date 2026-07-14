import { NextRequest } from 'next/server'

/**
 * R2D1 — Revision-aware order save boundary.
 *
 * TEMPORARY AMALAY FIELD-CERT BOUNDARY.
 * client_id is server-fixed to 'amalay'. Browser cannot choose arbitrary tenant.
 * Restaurant #2 cannot reuse this adapter as tenant authorization architecture.
 * P0 TENANT ISOLATION ARCHITECTURE remains open.
 *
 * This endpoint wraps r1_save_order (SECURITY DEFINER, service_role only)
 * with server-derived client scope. Browser calls this instead of direct
 * Supabase REST POST to pos_orders.
 */

// TEMPORARY: Fixed AMALAY client scope
const CLIENT_ID = 'amalay'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    const { order_id, expected_revision } = body
    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' }, { status: 400 })
    }
    if (typeof expected_revision !== 'number' || expected_revision < 0) {
      return Response.json({ ok: false, error: 'INVALID_REVISION' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      console.error('[save-order] SUPABASE_SERVICE_KEY not configured')
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
    }

    // Call r1_save_order via Supabase RPC with service_role
    const rpcBody = {
      p_client_id: CLIENT_ID,  // Server-fixed, not from browser
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

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_save_order`, {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(rpcBody),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[save-order] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED', detail: errText }, { status: 502 })
    }

    const result = await res.json()
    // r1_save_order returns a jsonb object directly
    return Response.json(result)
  } catch (err) {
    console.error('[save-order] Unexpected error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
