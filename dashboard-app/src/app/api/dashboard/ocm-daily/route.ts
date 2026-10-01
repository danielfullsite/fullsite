import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'

// Resumen diario POR TENANT desde la vista viva ocm_daily (1 fila por día, ya
// agregada en Postgres). Existe porque el dashboard armaba el histórico leyendo
// 90 días de pos_orders CRUDO (~6k órdenes, ~6 MB, 7 páginas keyset) en cada
// carga; eso excedía el timeout y el cliente caía al respaldo wansoft_daily,
// congelado. ocm_daily devuelve ~90 filas: instantáneo, sin timeout, sin caer al
// respaldo. Es la "fuente viva" que CLAUDE.md ya define como la verdad.
//
// ocm_daily es por-tenant (client_id) y NO tiene location_id: el camino con
// filtro de sucursal sigue usando pos_orders (ver getRecentDays). Aislamiento por
// restaurante vía requireTenant (sesión → client_id server-side), nunca un header.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || ''

// Nunca cachear: es el resumen de ventas en vivo.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  if (!SB_KEY) {
    return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503, headers: NO_STORE })
  }
  const sp = request.nextUrl.searchParams
  const auth = await requireTenant(request, sp.get('client_id'))
  if (auth instanceof Response) return auth
  const clientId = auth.clientId

  const since = sp.get('since') || ''
  if (!DATE_RE.test(since)) {
    return NextResponse.json({ error: 'since (YYYY-MM-DD) required' }, { status: 400, headers: NO_STORE })
  }

  const params = new URLSearchParams({
    select: 'fecha,ventas_dia,ventas_brutas,descuentos,efectivo,tarjeta,tickets_count,mesas_atendidas,personas_restaurant,ticket_promedio_restaurant,propinas_total',
    client_id: `eq.${clientId}`,
    fecha: `gte.${since}`,
    order: 'fecha.asc',
  })

  try {
    const res = await fetch(`${SB_URL}/rest/v1/ocm_daily?${params}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const days: unknown = await res.json()
    if (!Array.isArray(days)) throw new Error('invalid rows')
    return NextResponse.json({ days }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'OCM_REPORT_UNAVAILABLE' }, { status: 502, headers: NO_STORE })
  }
}
