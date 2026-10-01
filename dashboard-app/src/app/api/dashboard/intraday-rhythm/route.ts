import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { businessDateAt } from '@/lib/business-day'
import { calculateIntradayRhythm, type OrderForIntradayRhythm } from '@/lib/intraday-rhythm'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const NO_STORE = { 'Cache-Control': 'no-store' } as const

type ClientRow = { timezone?: unknown, business_day_start_local?: unknown }

/**
 * El único contrato para el agente intradía. Si no puede leer cobros cerrados,
 * configuración del tenant o una muestra comparable, responde ritmo:null.
 */
export async function GET(request: NextRequest) {
  if (!SB_KEY) return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503, headers: NO_STORE })
  const auth = await requireTenant(request, request.nextUrl.searchParams.get('client_id'))
  if (auth instanceof Response) return auth

  try {
    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const clientUrl = new URL(`${SB_URL}/rest/v1/clients`)
    clientUrl.search = new URLSearchParams({
      select: 'timezone,business_day_start_local', id: `eq.${auth.clientId}`, limit: '1',
    }).toString()
    const clientRes = await fetch(clientUrl, { headers, cache: 'no-store' })
    if (!clientRes.ok) throw new Error('client read failed')
    const client = (await clientRes.json() as ClientRow[])[0]
    if (!client || typeof client.timezone !== 'string' || !client.timezone || typeof client.business_day_start_local !== 'string') throw new Error('invalid client configuration')

    const now = new Date()
    const businessDate = businessDateAt(now, client.timezone, client.business_day_start_local)
    const since = new Date(now.getTime() - 120 * 86400000).toISOString().slice(0, 10)
    const ordersUrl = new URL(`${SB_URL}/rest/v1/pos_orders`)
    // Misma definición de venta que pos-daily: pagada, o cerrada sin status de pago.
    ordersUrl.search = new URLSearchParams({
      select: 'dia_venta,closed_at,total', client_id: `eq.${auth.clientId}`,
      dia_venta: `gte.${since}`,
      or: '(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))',
      closed_at: 'not.is.null', order: 'closed_at.asc', limit: '8000',
    }).toString()
    const ordersRes = await fetch(ordersUrl, { headers, cache: 'no-store' })
    if (!ordersRes.ok) throw new Error('orders read failed')
    const orders = await ordersRes.json() as OrderForIntradayRhythm[]
    const ritmo = calculateIntradayRhythm(orders, now, client.timezone, client.business_day_start_local, businessDate)
    return NextResponse.json({ ritmo }, { headers: NO_STORE })
  } catch {
    // No convertir un fallo de lectura en una alerta o en una predicción.
    return NextResponse.json({ ritmo: null }, { headers: NO_STORE })
  }
}
