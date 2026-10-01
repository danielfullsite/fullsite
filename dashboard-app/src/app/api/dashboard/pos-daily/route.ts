import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Lee pos_orders (tabla tenant con RLS). DEBE usar la service-role key canónica
// (SUPABASE_SERVICE_KEY) — NUNCA anon (RLS le da 0 filas). Fail-closed: sin la
// credencial, 503 explícito.
//
// Contrato: esta ruta es la ÚNICA fuente del resumen diario del POS para el
// dashboard. Existe porque leer pos_orders desde el navegador dependía del token
// de sesión de Supabase, que en el arranque de App Router no está listo a tiempo
// (getSession() se cuelga); la lectura tronaba y el dashboard caía en silencio a
// wansoft_daily, muerto desde 2026-09-08. Del lado servidor la credencial siempre
// está, así que no hay carrera. El aislamiento por restaurante lo garantiza
// requireTenant (sesión → client_id server-side), no un header del cliente.
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || ''

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PAGE = 1000
const MAX_PAGES = 60 // 60k órdenes tope duro, evita un bucle infinito

export async function GET(request: NextRequest) {
  if (!SB_KEY) {
    return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503 })
  }
  const sp = request.nextUrl.searchParams
  const auth = await requireTenant(request, sp.get('client_id'))
  if (auth instanceof Response) return auth
  const clientId = auth.clientId

  const since = sp.get('since') || ''
  if (!DATE_RE.test(since)) {
    return NextResponse.json({ error: 'since (YYYY-MM-DD) required' }, { status: 400 })
  }
  const locationId = sp.get('location_id')

  // Paginado keyset por id.asc — igual que la versión cliente anterior. dia_venta
  // (no created_at) para no mover ventas después de medianoche a otro día.
  const orders: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  let after: string | undefined

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const params = new URLSearchParams({
        select: '*',
        client_id: `eq.${clientId}`,
        dia_venta: `gte.${since}`,
        order: 'id.asc',
        limit: String(PAGE),
      })
      if (locationId) params.set('location_id', `eq.${locationId}`)
      if (after) params.set('id', `gt."${after.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)

      const res = await fetch(`${SB_URL}/rest/v1/pos_orders?${params}`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const page: unknown = await res.json()
      if (!Array.isArray(page)) throw new Error('invalid rows')
      if (page.length === 0) break

      for (const row of page as Array<Record<string, unknown>>) {
        const id = row?.id
        const dv = row?.dia_venta
        if (typeof id !== 'string' || !id || seen.has(id) || typeof dv !== 'string' || !DATE_RE.test(dv)) {
          throw new Error('invalid or repeated row')
        }
        seen.add(id)
        orders.push(row)
      }
      after = String((page[page.length - 1] as Record<string, unknown>).id)
      if (page.length < PAGE) break
    }
  } catch {
    // Falla ≠ vacío: se reporta, no se convierte en lista vacía silenciosa.
    return NextResponse.json({ error: 'POS_REPORT_UNAVAILABLE: incomplete order read' }, { status: 502 })
  }

  return NextResponse.json({ orders })
}
