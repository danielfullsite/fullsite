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

    // OP-39: ajuste de stock (entrada/merma/ajuste_absoluto) es administrativo y
    // vector de fraude (merma) — exige gerente+ (grace: audita, no bloquea hasta strict).
    const gate = checkPosRole(auth, POS_ROLE_LVL.gerente, 'MARKET_ROLE_STRICT')
    if (!gate.ok) {
      return Response.json({ ok: false, error: 'ROLE_REQUIRED' }, { status: 403 })
    }
    // Actor server-verificado (no confiar en el auto-reportado del body).
    const verifiedActor = auth.staffName || auth.staffId || actor || 'almacen'
    if (gate.mode.startsWith('below_role:')) {
      void fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: {
          'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          client_id: clientId,
          action: 'market_adjust_below_role',
          actor: verifiedActor,
          details: { role_mode: gate.mode, adjustment_type, menu_item_id, quantity },
        }),
      }).catch(() => {})
    }

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_adjust_market_stock`, {
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
        p_actor: verifiedActor,  // OP-39: server-verified, ya no REPORTED_ACTOR
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
