import { type NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { kitchenTokenEnabled, verifyKitchenToken } from '@/lib/kitchen-token'
import { hasPermission } from '@/lib/pos-permissions'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || ''

function configured() { return Boolean(SB_URL() && SB_KEY()) }
function headers(extra: Record<string, string> = {}) {
  const key = SB_KEY()
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }
}

const CSV_RE = /^[a-z0-9_-]+(?:,[a-z0-9_-]+)*$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

type ReadScope = { clientId: string; audience: 'pos' | 'kds' }

async function readScope(request: NextRequest): Promise<ReadScope | Response> {
  const auth = await withPOSAuth(request)
  if (auth) return { clientId: auth.clientId, audience: 'pos' }

  const clientId = request.nextUrl.searchParams.get('client_id') || ''
  if (!CLIENT_RE.test(clientId)) return unauthorized()
  // This path reads with service_role for a login-less KDS. Unlike the legacy
  // kitchen endpoint, a missing secret may never turn service-role access open.
  if (!kitchenTokenEnabled()) return Response.json({ error: 'KDS_TOKEN_NOT_CONFIGURED' }, { status: 503 })
  if (!verifyKitchenToken(clientId, request.headers.get('x-kitchen-token'))) return unauthorized()
  return { clientId, audience: 'kds' }
}

/** Read delivery orders with a server-resolved tenant and service role. */
export async function GET(request: NextRequest) {
  const resolved = await readScope(request)
  if (resolved instanceof Response) return resolved
  const { clientId, audience } = resolved
  if (!configured()) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 503 })

  const sp = request.nextUrl.searchParams
  const filters = [
    `client_id=eq.${encodeURIComponent(clientId)}`,
    audience === 'kds'
      ? 'select=id,platform,status,items,created_at,notes,customer_name,total'
      : 'select=*',
    'order=created_at.desc',
    'limit=500',
  ]
  const status = sp.get('status')
  if (status && CSV_RE.test(status)) filters.push(`status=in.(${status})`)
  const platform = sp.get('platform')
  if (platform && CSV_RE.test(platform)) filters.push(`platform=in.(${platform})`)
  const since = sp.get('since')
  if (since && ISO_RE.test(since)) filters.push(`created_at=gte.${encodeURIComponent(since)}`)

  const result = await fetch(`${SB_URL()}/rest/v1/delivery_orders?${filters.join('&')}`, {
    headers: headers(), cache: 'no-store',
  })
  if (!result.ok) {
    console.error('[delivery-orders] read error', result.status)
    return Response.json({ error: 'DB_ERROR' }, { status: 502 })
  }
  return Response.json(await result.json())
}

const PATCHABLE = new Set([
  'status', 'updated_at', 'ready_at', 'picked_up_at', 'cancelled_at',
  'en_route_at', 'delivered_at', 'closed_at', 'notes', 'driver_name', 'driver_phone',
])
// This browser-facing route only owns kitchen progress and an explicitly
// authorized cancellation. Final provider states arrive through signed
// webhooks/reconciliation; accepting them here would let any shift token hide
// a live order by fabricating `entregada` or `en_ruta`.
const DELIVERY_STATUSES = new Set(['preparando', 'lista', 'cancelada'])
const DATE_FIELDS = new Set(['updated_at', 'ready_at', 'picked_up_at', 'cancelled_at', 'en_route_at', 'delivered_at', 'closed_at'])
const SHORT_TEXT_LIMITS: Record<string, number> = { notes: 2000, driver_name: 200, driver_phone: 80 }

function validatePatch(input: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(input)
  if (!entries.length || entries.some(([key]) => !PATCHABLE.has(key))) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (key === 'status' && (typeof value !== 'string' || !DELIVERY_STATUSES.has(value))) return null
    if (DATE_FIELDS.has(key) && value !== null && (typeof value !== 'string' || !ISO_RE.test(value))) return null
    if (key in SHORT_TEXT_LIMITS && value !== null && (typeof value !== 'string' || value.length > SHORT_TEXT_LIMITS[key])) return null
    safe[key] = value
  }
  return safe
}

/** Update only an allowed field on an order owned by the authenticated tenant. */
export async function PATCH(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!configured()) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 503 })

  const body = await request.json().catch(() => null) as { id?: unknown; patch?: unknown } | null
  if (!body || typeof body.id !== 'string' || !body.id || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    return Response.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  const safe = validatePatch(body.patch as Record<string, unknown>)
  if (!safe) return Response.json({ error: 'INVALID_PATCH' }, { status: 400 })

  // Leer la bandeja de delivery requiere `registro_comanda`, pero modificarla
  // es otra capacidad. El contrato granular reserva el progreso de cocina para
  // admin/gerente/capitán; un shift de cajero o mesero conserva vista de sólo
  // lectura aunque llame la ruta directamente.
  if (!hasPermission(auth.role, 'actualizar_estatus_orden')) {
    return Response.json({ error: 'STATUS_PERMISSION_REQUIRED' }, { status: 403 })
  }

  // `closed_at` también saca la orden de la lista activa, aunque status no diga
  // cancelada. Ambos caminos requieren el permiso crítico de cancelación.
  const cancelsOrder = safe.status === 'cancelada' || safe.cancelled_at != null || safe.closed_at != null
  if (cancelsOrder && !hasPermission(auth.role, 'cancelar_ordenes')) {
    return Response.json({ error: 'CANCEL_PERMISSION_REQUIRED' }, { status: 403 })
  }

  const result = await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?id=eq.${encodeURIComponent(body.id)}&client_id=eq.${encodeURIComponent(auth.clientId)}&select=id`,
    {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(safe),
    },
  )
  if (!result.ok) {
    console.error('[delivery-orders] patch error', result.status)
    return Response.json({ error: 'DB_ERROR' }, { status: 502 })
  }
  const rows = await result.json().catch(() => []) as Array<{ id?: string }>
  if (!rows.length) return Response.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  return Response.json({ ok: true })
}
