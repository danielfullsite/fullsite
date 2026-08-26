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
 * Deja constancia del borrado en pos_audit_log.
 *
 * Por qué existe: el 2026-08-26 a las 02:49:03 esta ruta borró las 303 órdenes de AMALAY
 * —correctamente, con confirmación y digest— y **no dejó ni una línea**. La ausencia de
 * rastro convirtió una acción legítima en un misterio: `pos_orders` vacío contra 303
 * operaciones `COMMITTED` en `pos_save_operations`, sin nada que explicara la diferencia.
 * Reconstruirlo costó una investigación completa y sólo se resolvió leyendo los registros
 * de Supabase, que caducan a las 24 h.
 *
 * La regla que se sigue de ahí: **una acción destructiva que no se registra es
 * indistinguible de una pérdida de datos.**
 *
 * Best-effort a propósito: el borrado ya ocurrió cuando esto corre, y fallar aquí no
 * debe convertir una operación exitosa en un 500. Pero se registra en consola si falla,
 * para que la ausencia del renglón tenga a su vez su propia huella.
 */
async function registrarLimpieza(
  clientId: string, key: string,
  datos: { actor: string; staffId?: string; role: string; count: number; digest: string },
): Promise<void> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/pos_audit_log`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: clientId,
        order_id: `cleanup:${datos.digest.slice(0, 12)}`,
        action: 'orders_cleanup',
        actor: datos.actor,
        reason: 'Limpieza total de órdenes desde /api/pos/admin/cleanup-orders',
        details: {
          deleted_count: datos.count,
          backup_digest: datos.digest,
          staff_id: datos.staffId ?? null,
          role: datos.role,
        },
      }),
    })
    if (!res.ok) console.error('[cleanup-orders] no se pudo auditar:', res.status, await res.text())
  } catch (e) {
    console.error('[cleanup-orders] no se pudo auditar:', (e as Error).message)
  }
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
    const { orders, key } = await readOrders(ctx.auth!.clientId)
    if (digest(orders) !== body.digest) return Response.json({ error: 'Las órdenes cambiaron; descarga un respaldo nuevo' }, { status: 409 })
    const del = await fetch(`${SB_URL}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(ctx.auth!.clientId)}`, {
      method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    })
    if (!del.ok) return Response.json({ error: `Delete failed: HTTP ${del.status}` }, { status: 500 })
    await registrarLimpieza(ctx.auth!.clientId, key, {
      actor: ctx.auth!.staffName,
      staffId: ctx.auth!.staffId,
      role: ctx.auth!.role,
      count: orders.length,
      digest: body.digest,
    })
    return Response.json({ ok: true, deleted: orders.length })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
