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
    return Response.json({ ok: true, deleted: orders.length })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
