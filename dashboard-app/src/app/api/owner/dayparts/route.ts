import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import { leerConfigDayparts, validarDayparts, ventasPorFranja } from '@/lib/dayparts'

/**
 * Horarios de venta del restaurante (brunch/lunch/dinner… los que use su operación).
 * GET  → config actual (o el default genérico, marcado esDefault).
 * POST → guarda. Sólo dueño/admin: cambia cómo se reparten TODAS las ventas.
 *
 * Mismo blindaje que owner/permissions: clientId del token (withPOSAuth), nunca del
 * body; sameOriginOnly en la mutación; validación server-side (sin traslapes).
 */
export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!
const MANAGER_ROLES = new Set(['dueño', 'admin'])

function H() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
}

export async function GET(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  const { config, esDefault, inicioDia, timezone } = await leerConfigDayparts(SB_URL, SB_KEY, auth.clientId)

  // ?resumen=1 → % por franja de los últimos N días (vista previa en la pantalla).
  let resumen = null
  if (req.nextUrl.searchParams.get('resumen') === '1') {
    const dias = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('dias')) || 30))
    const hoy = new Date()
    const hasta = hoy.toISOString().slice(0, 10)
    const desde = new Date(hoy.getTime() - (dias - 1) * 864e5).toISOString().slice(0, 10)
    const [filas, locsRes] = await Promise.all([
      ventasPorFranja({ sbUrl: SB_URL, sbKey: SB_KEY, clientId: auth.clientId, desde, hasta, config, tz: timezone || undefined, inicioDia }),
      fetch(`${SB_URL}/rest/v1/client_locations?client_id=eq.${encodeURIComponent(auth.clientId)}&select=id,name`, { headers: H(), cache: 'no-store' }),
    ])
    const sucursales = locsRes.ok ? await locsRes.json().catch(() => []) : []
    resumen = { desde, hasta, filas: filas ?? [], sucursales, error: filas === null }
  }
  return Response.json({ config, esDefault, inicioDia, puedeEditar: MANAGER_ROLES.has(auth.role), resumen })
}

export async function POST(req: NextRequest) {
  const cross = sameOriginOnly(req)
  if (cross) return cross
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { inicioDia } = await leerConfigDayparts(SB_URL, SB_KEY, auth.clientId)
  const v = validarDayparts(body, inicioDia)
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const res = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(auth.clientId)}`, {
    method: 'PATCH',
    headers: { ...H(), Prefer: 'return=minimal' },
    body: JSON.stringify({ sales_dayparts: v.config }),
  })
  if (!res.ok) return Response.json({ error: 'No se pudo guardar' }, { status: 500 })
  return Response.json({ ok: true, config: v.config })
}
