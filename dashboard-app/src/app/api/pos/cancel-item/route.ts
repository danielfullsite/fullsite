import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyShiftToken } from '@/lib/shift-token'

// Nivel de rol por nombre (gerente/admin = manager+). Debe coincidir con pin/route.ts.
const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }

/**
 * Atomic item cancel within an order.
 *
 * Uses OCC via updated_at timestamp filter (same pattern as transfer-item):
 * 1. Read current order items + updated_at
 * 2. Mark target item cancelled/voided
 * 3. PATCH with updated_at=eq filter — returns 0 rows if another terminal raced us
 *
 * Idempotent: operation_id deduplicates retries (offline replay safe).
 * APP_API transport required — SUPABASE_REST MUST NOT mutate pos_orders.
 */

export async function POST(request: NextRequest) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  }

  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId

    const body = await request.json()
    const { order_id, item_id, voided, operation_id, mesero, reason, manager, approval_token, offline_approved } = body

    if (!order_id || !item_id) {
      return Response.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
    }

    // ── Enforcement de aprobación de gerente (anti-fraude, PERM-07) ──
    // Antes: la ruta confiaba en el string `manager` → un mesero podía cancelar por POST
    // directo. Ahora:
    //   • Online: exige el token FIRMADO del gerente (rol gerente+, mismo tenant) que emite
    //     /api/pos/pin → infalsificable desde el cliente.
    //   • Offline (offline_approved): el cancel se encoló tras verificar el PIN del gerente
    //     EN EL DISPOSITIVO (PBKDF2, 8h). Decisión Opción A ("como Wansoft"): se acepta y se
    //     audita como device-trust, para no romper la operación offline en país 40% efectivo.
    let approvalMode = ''
    if (typeof approval_token === 'string' && approval_token) {
      const p = await verifyShiftToken(approval_token)
      if (p && p.cid === clientId && (ROLE_LVL[p.rol] || 0) >= 4) approvalMode = 'online:' + p.rol
    }
    if (!approvalMode) {
      if (offline_approved === true) {
        // El rol viene del shift token FIRMADO, no del cuerpo. Sin esto,
        // `offline_device_trust` de un mesero que se autoaprobó y de un gerente
        // aprobando en la terminal del mesero se veían IDÉNTICOS en la bitácora.
        // No se bloquea: bloquear aquí rompería la cancelación sin WAN, y un 403 en
        // el replay de la cola es terminal (pos-offline-db.ts:821) — la cancelación
        // se perdería para siempre. Ver manager-approval.ts para el cierre real.
        approvalMode = `offline_device_trust:${auth.role || 'desconocido'}`
      } else {
        // Sin ninguna aprobación. ROLLOUT EN 2 FASES para no romper clientes viejos (SW
        // cacheado que aún no manda la aprobación):
        //   • Fase 1 (default): GRACE — permite pero audita como 'legacy_no_approval'.
        //     Cero riesgo al desplegar; empieza a detectar el vector.
        //   • Fase 2: setear CANCEL_APPROVAL_STRICT=true en el env → 403 (bloquea el POST
        //     forjado). Se activa cuando el log deje de mostrar 'legacy_no_approval'.
        if (process.env.CANCEL_APPROVAL_STRICT === 'true') {
          return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' }, { status: 403 })
        }
        approvalMode = 'legacy_no_approval'
      }
    }

    // ── Step 1: Read order with current updated_at ──
    const readRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=id,items,updated_at&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (!readRes.ok) return Response.json({ ok: false, error: 'READ_FAILED' }, { status: 502 })
    const rows = await readRes.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const { items: rawItems, updated_at: updatedAt } = rows[0]
    const items: Array<Record<string, unknown>> =
      typeof rawItems === 'string' ? JSON.parse(rawItems) : (rawItems || [])

    const targetIndex = items.findIndex(i => i.id === item_id)
    if (targetIndex === -1) {
      // Item already gone — treat as success (idempotent)
      return Response.json({ ok: true, already_applied: true })
    }
    const targetItem = items[targetIndex]

    // ── Step 2: Mark item cancelled or voided ──
    const newItems = items.map((i, idx) =>
      idx === targetIndex ? { ...i, cancelled: true } : i
    )

    // ── Step 3: PATCH with OCC guard ──
    const patchRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&updated_at=eq.${encodeURIComponent(updatedAt)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          items: JSON.stringify(newItems),
          updated_at: new Date().toISOString(),
        }),
      }
    )

    if (!patchRes.ok) {
      return Response.json({ ok: false, error: 'PATCH_FAILED' }, { status: 502 })
    }
    const patchRows = await patchRes.json()
    if (!Array.isArray(patchRows) || patchRows.length === 0) {
      // OCC conflict: another terminal modified the order between our read and write
      return Response.json({
        ok: false,
        conflict: true,
        message: 'La orden fue modificada por otra terminal. La cancelación se aplicó localmente y se reintentará.',
      }, { status: 409 })
    }

    // ── Step 4: Audit log (best-effort, non-blocking) ──
    try {
      await fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: clientId,
          order_id,
          action: voided ? 'item_voided' : 'item_cancelled',
          // EL ACTOR SALE DEL TOKEN, NO DEL CUERPO. Antes era `mesero || 'POS'`, y
          // `mesero` lo mandaba el cliente: la bitácora entera la dictaba quien cancelaba.
          // Igual que `manager`, que dejaba el robo firmado con el nombre del gerente.
          actor: auth.staffName || auth.staffId || 'POS',
          details: {
            item_id,
            item_name: targetItem.nombre || targetItem.name,
            reason,
            // EL MONTO SE CAPTURA AQUI PORQUE DESPUES YA NO EXISTE.
            //
            // El `cancelled: true` si se guarda en `items`... hasta que se cobra: al
            // cerrar, handlePayment manda `items: payingItems`, que EXCLUYE los
            // cancelados, y r1_save_order hace `items = coalesce(p_items, items)`. El
            // renglon desaparece del ticket y con el la evidencia.
            //
            // Por eso el detector de skimming de save-order no ve nada: recomputa el
            // total desde los items que recibio, que son exactamente los que se
            // cobraron, y la resta da cero. El guion es cobrar $2,320 en efectivo,
            // cancelar dos platos ya comidos "por error de captura", cobrar $1,392 y
            // quedarse $928 -- con un ticket limpio en la base.
            //
            // No se persisten los renglones cancelados en `items` a proposito: eso
            // rompe tres consumidores a la vez (el corte suma platillos desde `items`,
            // `platillos_top` los explota, y r1_reconcile_order los volveria a
            // descontar). El log es el lugar correcto para la evidencia.
            monto: Number(targetItem.subtotal) || 0,
            cantidad: Number(targetItem.cantidad) || 0,
            // Cancelar algo que la cocina ya mando es lo que distingue un error de
            // captura de una cancelacion despues de servir y cobrar.
            ya_enviado_a_cocina: Number(targetItem.sent_quantity) > 0,
            approval_mode: approvalMode,
            solicitante_rol: auth.role,
            // Lo que el cliente AFIRMÓ. En el camino offline es el único dato de quién
            // autorizó, así que se conserva — pero como afirmación, no como hecho.
            manager_declarado: typeof manager === 'string' ? manager : null,
            mesero_declarado: typeof mesero === 'string' ? mesero : null,
            revisar: approvalMode.startsWith('offline_device_trust')
              && (ROLE_LVL[String(auth.role)] || 0) < 4,
            voided: !!voided,
            operation_id,
          },
        }),
      })
    } catch { /* audit is best-effort */ }

    return Response.json({ ok: true, item_name: targetItem.nombre || targetItem.name })
  } catch (err) {
    console.error('[cancel-item] Unhandled error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
