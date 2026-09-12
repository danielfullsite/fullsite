import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyManagerApproval } from '@/lib/manager-approval'

/**
 * Reabrir una cuenta PAGADA/cerrada (status → enviada, closed_at → null).
 *
 * Anti-fraude (PERM-07 / BUG-4): antes reopenOrder hacía un PATCH directo con anon-key
 * (JWT del usuario) → cualquier mesero podía reabrir una cuenta pagada por POST directo,
 * modificarla y re-cerrarla por menos = skimming. Ahora se exige aprobación de gerente
 * VERIFICADA server-side (token firmado de gerente o sesión gerente+). El PATCH corre
 * con service_role y queda limitado al tenant del token.
 */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const clientId = auth.clientId

  const body = await request.json().catch(() => ({}))
  const { order_id, operation_id, approval_token } = body
  if (typeof order_id !== 'string' || !order_id || order_id.length > 200) {
    return Response.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const appr = await verifyManagerApproval({
    approvalToken: approval_token, clientId, minLevel: 4,
    // El rol sale del shift token FIRMADO, no del cuerpo. Con esto la bitácora
    // distingue a un gerente aprobando en su terminal de un mesero que se autoaprobó.
    solicitanteRol: auth.role,
  })
  if (!appr.ok) return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' }, { status: 403 })
  if (typeof operation_id !== 'string' || !operation_id || operation_id.length > 200) {
    return Response.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  const approver = appr.approverId || auth.staffId
  if (!approver) return Response.json({ ok: false, error: 'APPROVER_ID_REQUIRED' }, { status: 403 })
  try {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/r1_reopen_order_atomic`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: clientId, p_order_id: order_id,
        p_operation_id: operation_id, p_actor: approver, p_approval_mode: appr.mode }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) {
      const known = ['ORDER_NOT_FOUND', 'ORDER_NOT_CLOSED', 'ACTIVE_TABLE_CONFLICT', 'OPERATION_ID_REUSED']
      const error = known.includes(result.message) ? result.message : 'REOPEN_UNCONFIRMED'
      return Response.json({ ok: false, error }, { status: error === 'REOPEN_UNCONFIRMED' ? 503 : 409 })
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.revision)) throw new Error('INVALID_RECEIPT')
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ ok: false, error: 'REOPEN_UNCONFIRMED' }, { status: 503 })
  }
}
