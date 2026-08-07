import { NextRequest, NextResponse } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// BUG-019: este route lee pos_orders (tabla tenant con RLS). DEBE usar la
// service-role key canónica (SUPABASE_SERVICE_KEY) — NUNCA anon (anon queda
// denegado por RLS post-migración y antes silenciosamente devolvía datos).
// Fail-closed: si la credencial no está configurada, 503 explícito (sin anon).
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const MIN_DAYS = 7

export async function GET(request: NextRequest) {
  if (!SB_KEY) return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_KEY required' }, { status: 503 })
  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${sinceStr}T00:00:00&status=not.in.(abierta,cancelada)&select=created_at,total&limit=5000`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ distribution: null, days: 0 })

    const orders: Array<{ created_at: string; total: number }> = await res.json()
    if (orders.length === 0) return NextResponse.json({ distribution: null, days: 0 })

    const hourTotals: Record<number, number> = {}
    const days = new Set<string>()

    for (const order of orders) {
      const dt = new Date(order.created_at)
      // Convert to America/Mexico_City (UTC-6, no DST adjustment needed for prediction purposes)
      const mxHour = (dt.getUTCHours() - 6 + 24) % 24
      const mxDate = new Date(dt.getTime() - 6 * 60 * 60 * 1000)
      days.add(mxDate.toISOString().slice(0, 10))
      hourTotals[mxHour] = (hourTotals[mxHour] || 0) + (order.total || 0)
    }

    if (days.size < MIN_DAYS) return NextResponse.json({ distribution: null, days: days.size })

    const grandTotal = Object.values(hourTotals).reduce((a, b) => a + b, 0)
    if (grandTotal <= 0) return NextResponse.json({ distribution: null, days: days.size })

    const distribution: Record<number, number> = {}
    for (const [hour, total] of Object.entries(hourTotals)) {
      distribution[parseInt(hour)] = total / grandTotal
    }

    return NextResponse.json({ distribution, days: days.size })
  } catch {
    return NextResponse.json({ distribution: null, days: 0 })
  }
}
