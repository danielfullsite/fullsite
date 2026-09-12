import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized, checkPosRole, POS_ROLE_LVL } from '@/lib/api-auth'

/**
 * Phase 4 — Manual market stock adjustment via constrained server boundary.
 * Independent of sale_authority (manual adjustments always allowed).
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()
    const { menu_item_id, adjustment_type, quantity, operation_id, notes } = body

    if (typeof menu_item_id !== 'string' || !menu_item_id || menu_item_id.length > 200 ||
        typeof operation_id !== 'string' || !operation_id || operation_id.length > 200 ||
        (notes != null && (typeof notes !== 'string' || notes.length > 1000))) {
      return Response.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 })
    }
    if (!['entrada', 'merma', 'ajuste_absoluto'].includes(adjustment_type)) {
      return Response.json({ ok: false, error: 'INVALID_TYPE' }, { status: 400 })
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 ||
        (adjustment_type !== 'ajuste_absoluto' && quantity === 0)) {
      return Response.json({ ok: false, error: 'INVALID_QUANTITY' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    // OP-39: ajuste de stock (entrada/merma/ajuste_absoluto) es administrativo y
    // vector de fraude (merma) — exige gerente+ (grace: audita, no bloquea hasta strict).
    const gate = checkPosRole(auth, POS_ROLE_LVL.gerente, 'MARKET_ROLE_STRICT')
    if (!gate.ok) {
      return Response.json({ ok: false, error: 'ROLE_REQUIRED' }, { status: 403 })
    }
    // Actor server-verificado (no confiar en el auto-reportado del body).
    const verifiedActor = auth.staffId
    if (!verifiedActor) return Response.json({ ok: false, error: 'ACTOR_REQUIRED' }, { status: 403 })

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_adjust_market_stock_atomic`, {
      method: 'POST',
      headers: {
        'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_client_id: clientId,
        p_menu_item_id: menu_item_id,
        p_adjustment_type: adjustment_type,
        p_quantity: quantity,
        p_actor: verifiedActor,
        p_notes: notes || null,
        p_operation_id: operation_id,
      }),
    })

    if (!res.ok) {
      const result = await res.json().catch(() => ({}))
      const known = ['MARKET_ITEM_NOT_FOUND', 'OPERATION_ID_REUSED', 'INVALID_MARKET_ADJUSTMENT']
      const error = known.includes(result.message) ? result.message : 'MARKET_UNCONFIRMED'
      return Response.json({ ok: false, error }, { status: error === 'MARKET_UNCONFIRMED' ? 503 : 409 })
    }

    return Response.json(await res.json())
  } catch (err) {
    console.error('[adjust-market] Error:', err)
    return Response.json({ ok: false, error: 'MARKET_UNCONFIRMED' }, { status: 503 })
  }
}
