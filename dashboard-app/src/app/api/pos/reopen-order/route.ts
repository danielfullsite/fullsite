import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyManagerApproval } from '@/lib/manager-approval'

/**
 * Reabrir una cuenta PAGADA/cerrada (status → enviada, closed_at → null).
 *
 * Anti-fraude (PERM-07 / BUG-4): antes reopenOrder hacía un PATCH directo con anon-key
 * (JWT del usuario) → cualquier mesero podía reabrir una cuenta pagada por POST directo,
 * modificarla y re-cerrarla por menos = skimming. Ahora se exige aprobación de gerente
 * VERIFICADA server-side (token firmado online, o device-trust offline). El PATCH corre
 * con service_role, scopeado al tenant del token. Rollout grace → strict (POS_APPROVAL_STRICT).
 */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const clientId = auth.clientId

  const body = await request.json().catch(() => ({}))
  const { order_id, manager, approval_token, offline_approved } = body
  if (!order_id || typeof order_id !== 'string') {
    return Response.json({ ok: false, error: 'MISSING_ORDER_ID' }, { status: 400 })
  }

  const appr = await verifyManagerApproval({
    approvalToken: approval_token, offlineApproved: offline_approved, clientId, minLevel: 4,
  })
  if (!appr.ok) return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' }, { status: 403 })

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' }

  const res = await fetch(
    `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}&client_id=eq.${encodeURIComponent(clientId)}`,
    { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'enviada', closed_at: null, metodo_pago: null }) }
  )
  if (!res.ok) return Response.json({ ok: false, error: `REOPEN_FAILED_${res.status}` }, { status: 502 })

  // Auditoría (best-effort, registra el modo de aprobación para el agente anti-fraude)
  fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({
      client_id: clientId, order_id, action: 'order_reopened',
      actor: (typeof manager === 'string' && manager) || auth.staffName || 'POS',
      details: { approval_mode: appr.mode },
    }),
  }).catch(() => {})

  return Response.json({ ok: true })
}
