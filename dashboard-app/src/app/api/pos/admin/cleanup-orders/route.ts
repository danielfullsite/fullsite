import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POS_ROLE_LVL, withPOSAuth, unauthorized } from '@/lib/api-auth'
import { canCleanupAllOrders } from '@/lib/order-cleanup-auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

async function context(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return { error: unauthorized() }
  if ((POS_ROLE_LVL[auth.role] ?? 0) < POS_ROLE_LVL.gerente || !canCleanupAllOrders(auth)) {
    return { error: Response.json({ error: 'Esta limpieza está reservada exclusivamente para Daniel' }, { status: 403 }) }
  }
  return { auth }
}

async function readOrders(clientId: string) {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('Service key unavailable')
  const res = await fetch(`${SB_URL}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Backup failed: HTTP ${res.status}`)
  return { orders: await res.json(), key }
}

function digest(orders: unknown[]) {
  return createHash('sha256').update(JSON.stringify(orders)).digest('hex')
}

/**
 * El borrado y su constancia, en una sola transacción.
 *
 * Historia, porque explica por qué NO se hace de la forma obvia:
 *
 * El 2026-08-25 a las 20:49:03 (Monterrey) un DELETE se llevó las órdenes de AMALAY —al
 * menos las 143 que el libro de operaciones documenta. Con todas las protecciones puestas:
 * confirmación literal, digest contra respaldo, guardián por tenant y nombre.
 *
 * Pero **no dejó rastro**, y el resultado fue indistinguible de una pérdida de datos:
 * `pos_orders` vacío contra 303 operaciones `COMMITTED` en `pos_save_operations`. Sólo se
 * reconstruyó por los registros de Supabase, que caducan a las 24 h.
 *
 * El primer intento de arreglo escribía la auditoría DESPUÉS del borrado, con `try/catch`.
 * **Eso reproduce el defecto:** si la escritura falla, el borrado vuelve a ser invisible.
 * Un registro *best-effort* de una acción destructiva no es un registro.
 *
 * Por eso el borrado vive ahora en `r1_cleanup_orders`, del lado de la base:
 *
 *   · `operation_id` idempotente — reintentar devuelve el resultado anterior, no borra otra vez
 *   · fila `STARTED` antes de tocar nada — una interrupción deja huella en vez de silencio
 *   · borrado y `COMMITTED` en la MISMA transacción — o quedan los dos, o ninguno
 *   · el respaldo completo se guarda en la propia fila, restaurable con `r1_cleanup_restore`
 *
 * Y por eso el cliente ya no necesita interpretar un `500`: reintentar con el mismo
 * `operation_id` es seguro por construcción.
 */
async function ejecutarLimpieza(
  key: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/r1_cleanup_orders`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    return { ok: false, status: 502, body: { error: `RPC_FAILED: HTTP ${res.status}` } }
  }
  const out = await res.json() as { ok?: boolean; error?: string }
  // `CONTEO_CAMBIO` es el mismo caso que antes devolvía 409: las órdenes cambiaron
  // entre el respaldo y el borrado, así que no se borró nada.
  if (!out.ok) return { ok: false, status: out.error === 'CONTEO_CAMBIO' ? 409 : 500, body: out }
  return { ok: true, status: 200, body: out }
}

export async function GET(request: NextRequest) {
  const ctx = await context(request)
  if (ctx.error) return ctx.error
  try {
    const { orders } = await readOrders(ctx.auth!.clientId)
    return Response.json({ client_id: ctx.auth!.clientId, count: orders.length, digest: digest(orders), exported_at: new Date().toISOString(), orders })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await context(request)
  if (ctx.error) return ctx.error
  try {
    const body = await request.json()
    if (body?.confirm !== 'BORRAR TODAS LAS ORDENES' || typeof body?.digest !== 'string') {
      return Response.json({ error: 'Confirmación inválida' }, { status: 400 })
    }
    // La llave de idempotencia la pone quien pide. Sin ella no se borra: es lo que hace
    // que un reintento sea seguro y que un `500` deje de ser ambiguo.
    if (typeof body?.operation_id !== 'string' || body.operation_id.length < 8) {
      return Response.json({ error: 'Falta operation_id' }, { status: 400 })
    }

    // Verificación del digest en la capa web: confirma que el operador vio exactamente
    // estas órdenes. La verificación que de verdad protege —el conteo— vive dentro de la
    // transacción, porque entre esta lectura y el borrado cabe una orden nueva.
    const { orders, key } = await readOrders(ctx.auth!.clientId)
    if (digest(orders) !== body.digest) {
      return Response.json({ error: 'Las órdenes cambiaron; descarga un respaldo nuevo' }, { status: 409 })
    }

    const r = await ejecutarLimpieza(key, {
      p_client_id: ctx.auth!.clientId,
      p_operation_id: body.operation_id,
      p_actor: ctx.auth!.staffName,
      p_staff_id: ctx.auth!.staffId ?? null,
      p_role: ctx.auth!.role,
      p_backup_digest: body.digest,
      p_expected_count: orders.length,
      p_reason: typeof body?.reason === 'string' ? body.reason : null,
    })
    return Response.json(r.body, { status: r.status })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
