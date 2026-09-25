import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyManagerApproval, apruebaSospechosa } from '@/lib/manager-approval'

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

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY
  if (!sbKey) return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 500 })
  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' }

  // Revisión adversarial V1: con `reopen:<orden>` el mismo token reabría la MISMA cuenta
  // cuantas veces se quisiera (reabrir, re-cerrar por menos, reabrir…). La aprobación se amarra
  // al CIERRE concreto. Segunda revisión (H2): `closed_at` no basta — save-order acepta el
  // `closed_at` del cliente, así que re-cerrar con el mismo valor volvía a dar «mismo»
  // (reintento). Se amarra además a `order_revision`, que la base sube en CADA guardado
  // (r1_save_order): re-cerrar cambia la operación y el token queda reusado.
  // Una cuenta ya abierta no se «reabre»: respuesta idempotente, sin consumir la aprobación.
  const lectura = await fetch(
    `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}&client_id=eq.${encodeURIComponent(clientId)}&select=status,closed_at,order_revision&limit=1`,
    { headers: H, cache: 'no-store' })
  if (!lectura.ok) return Response.json({ ok: false, error: 'READ_FAILED' }, { status: 503 })
  const filas = await lectura.json().catch(() => null)
  if (!Array.isArray(filas)) return Response.json({ ok: false, error: 'READ_FAILED' }, { status: 503 })
  if (filas.length === 0) return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
  if (!filas[0].closed_at) return Response.json({ ok: true, already_open: true })
  const cierre = String(filas[0].closed_at)
  const revision = Number.isSafeInteger(filas[0].order_revision) ? filas[0].order_revision as number : null

  const appr = await verifyManagerApproval({
    approvalToken: approval_token, offlineApproved: offline_approved, clientId, minLevel: 4,
    terminalSolicitante: auth.terminalId, operacion: `reopen:${order_id}:${revision ?? 'sin-revision'}:${cierre}`,
    // El rol sale del shift token FIRMADO, no del cuerpo. Con esto la bitácora
    // distingue a un gerente aprobando en su terminal de un mesero que se autoaprobó.
    solicitanteRol: auth.role,
  })
  if (!appr.ok) return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED', detail: appr.error },
    { status: appr.error === 'AUTORIDAD_NO_DISPONIBLE' ? 503 : 403 })

  // Condicional al cierre y la revisión que se aprobaron: si entre la lectura y aquí alguien
  // guardó la cuenta, no se reabre otra cosa que la aprobada (0 filas → conflicto).
  const res = await fetch(
    `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}&client_id=eq.${encodeURIComponent(clientId)}` +
      `&closed_at=eq.${encodeURIComponent(cierre)}&order_revision=${revision === null ? 'is.null' : `eq.${revision}`}&select=id`,
    { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'enviada', closed_at: null, metodo_pago: null }) }
  )
  if (!res.ok) return Response.json({ ok: false, error: `REOPEN_FAILED_${res.status}` }, { status: 502 })
  const reabiertas = await res.json().catch(() => null)
  if (!Array.isArray(reabiertas)) return Response.json({ ok: false, error: 'REOPEN_UNCONFIRMED' }, { status: 502 })
  if (reabiertas.length === 0) return Response.json({ ok: false, error: 'ORDER_CHANGED' }, { status: 409 })

  // Auditoría (best-effort, registra el modo de aprobación para el agente anti-fraude)
  fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({
      client_id: clientId, order_id, action: 'order_reopened',
      // EL ACTOR SALE DEL TOKEN, NO DEL CUERPO. Antes era
      // `(typeof manager === 'string' && manager) || auth.staffName`, o sea que quien
      // reabría la cuenta escribía el nombre que quisiera: el robo quedaba firmado con
      // el nombre del gerente y la bitácora acusaba a un inocente.
      actor: auth.staffName || auth.staffId || 'POS',
      details: {
        approval_mode: appr.mode,
        solicitante_rol: auth.role,
        // Lo que el cliente AFIRMÓ. Se conserva porque en el camino offline es el único
        // dato de quién autorizó — pero se guarda como afirmación, no como hecho.
        manager_declarado: typeof manager === 'string' ? manager : null,
        revisar: apruebaSospechosa(appr),
      },
    }),
  }).catch(() => {})

  return Response.json({ ok: true })
}
