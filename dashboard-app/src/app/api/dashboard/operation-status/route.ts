import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { businessDateAt } from '@/lib/business-day'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const NO_STORE = { 'Cache-Control': 'no-store' } as const

type ClientRow = { timezone?: unknown, business_day_start_local?: unknown }
type TurnRow = { id?: unknown, opened_by?: unknown, opened_at?: unknown, fondo_inicial?: unknown }

function openTurn(row: TurnRow | undefined) {
  if (!row || typeof row.id !== 'string' || !row.id) return null
  return {
    id: row.id,
    numero: /^\d+$/.test(row.id) ? Number(row.id) : null,
    abiertoPor: typeof row.opened_by === 'string' ? row.opened_by : null,
    abiertoAt: typeof row.opened_at === 'string' ? row.opened_at : null,
    fondoInicial: typeof row.fondo_inicial === 'number' ? row.fondo_inicial : null,
  }
}

/** Fuente única de estado operativo para el dashboard: hora de servidor + Caja. */
export async function GET(request: NextRequest) {
  if (!SB_KEY) return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503, headers: NO_STORE })
  const auth = await requireTenant(request, request.nextUrl.searchParams.get('client_id'))
  if (auth instanceof Response) return auth

  try {
    const clientUrl = new URL(`${SB_URL}/rest/v1/clients`)
    clientUrl.search = new URLSearchParams({
      select: 'timezone,business_day_start_local', id: `eq.${auth.clientId}`, limit: '1',
    }).toString()
    const clientRes = await fetch(clientUrl, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' })
    if (!clientRes.ok) throw new Error('client read failed')
    const clients = await clientRes.json() as ClientRow[]
    const client = clients[0]
    if (!client || typeof client.timezone !== 'string' || !client.timezone) throw new Error('invalid client timezone')

    const turnUrl = new URL(`${SB_URL}/rest/v1/pos_turnos`)
    turnUrl.search = new URLSearchParams({
      select: 'id,opened_by,opened_at,fondo_inicial', client_id: `eq.${auth.clientId}`,
      closed_at: 'is.null', order: 'opened_at.desc', limit: '1',
    }).toString()
    const turnRes = await fetch(turnUrl, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' })
    if (!turnRes.ok) throw new Error('turn read failed')
    const turns = await turnRes.json() as TurnRow[]

    return NextResponse.json({
      businessDate: businessDateAt(new Date(), client.timezone, typeof client.business_day_start_local === 'string' ? client.business_day_start_local : null),
      turnoAbierto: openTurn(turns[0]),
    }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'DASHBOARD_OPERATION_STATUS_UNAVAILABLE' }, { status: 502, headers: NO_STORE })
  }
}
