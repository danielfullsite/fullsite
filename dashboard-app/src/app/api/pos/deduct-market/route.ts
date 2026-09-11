import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * Phase 3 — Legacy direct-stock sale deduction via serialized authority boundary.
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()
    const { order_id, actor, items } = body

    if (!order_id || !Array.isArray(items)) {
      return Response.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })

    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_legacy_sale_deduction`, {
      method: 'POST',
      headers: {
        'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_client_id: clientId,
        p_order_id: order_id,
        p_actor: actor || 'pos',
        p_items: items,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[deduct-market] RPC error:', res.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' }, { status: 502 })
    }

    const result = await res.json()
    // Tenant con autoridad r1: aqui no hay nada que descontar. Es un no-op, no un
    // rechazo: el cobro offline encola esta llamada y un ok:false la marcaria
    // conflicto terminal en cada terminal (barrido 2026-09-10).
    if (result && result.ok === false && result.error === 'AUTHORITY_NOT_LEGACY') {
      return Response.json({ ok: true, skipped: 'AUTHORITY_NOT_LEGACY', deductions: [] })
    }
    return Response.json(result)
  } catch (err) {
    console.error('[deduct-market] Error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
