// GET /api/export/polizas?from=2026-06-01&to=2026-06-30&client_id=amalay
// Exporta pólizas contables en CSV compatible con CONTPAQi / Aspel / Excel.
// Cada venta cerrada genera un asiento: Debe (Caja/Banco) / Haber (Ingreso + IVA).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getClientId } from '@/lib/api-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Order {
  id: string
  mesa: number
  mesero: string
  total: number
  propina: number | null
  metodo_pago: string | null
  pagos: { metodo: string; monto: number }[] | null
  created_at: string
}

function isEfectivo(method: string) {
  return /efectivo|cash/i.test(method)
}

function accountForMethod(method: string): { code: string; name: string } {
  const m = method.toLowerCase()
  if (isEfectivo(m)) return { code: '1010', name: 'Caja' }
  if (m.includes('débito') || m.includes('debito') || m.includes('td')) return { code: '1020', name: 'Bancos - TD' }
  if (m.includes('crédito') || m.includes('credito') || m.includes('tc')) return { code: '1021', name: 'Bancos - TC' }
  if (m.includes('transfer')) return { code: '1022', name: 'Bancos - Transferencia' }
  if (m.includes('rappi')) return { code: '1030', name: 'Plataformas - Rappi' }
  if (m.includes('uber')) return { code: '1031', name: 'Plataformas - Uber Eats' }
  return { code: '1099', name: `Otros - ${method}` }
}

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || new Date().toISOString().slice(0, 8) + '01'
  const to = searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const clientId = getClientId(request)

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${clientId}&status=eq.cerrada&created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59&select=id,mesa,mesero,total,propina,metodo_pago,pagos,created_at&order=created_at.asc&limit=5000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ error: 'Supabase error' }, { status: 500 })

    const orders: Order[] = await res.json()

    // CSV header
    const lines = ['Fecha,Poliza,Concepto,Cuenta,Nombre Cuenta,Debe,Haber,Referencia']

    let polizaNum = 1
    for (const o of orders) {
      const fecha = o.created_at?.slice(0, 10) || ''
      const total = Number(o.total) || 0
      const propina = Number(o.propina) || 0
      const subtotal = Math.round(total / 1.16 * 100) / 100
      const iva = Math.round((total - subtotal) * 100) / 100
      const cobrado = total + propina
      const ref = `Mesa ${o.mesa} - ${o.mesero} - ${o.id.slice(0, 8)}`
      const pol = `V-${String(polizaNum).padStart(4, '0')}`

      // Parse pagos (mixed payments)
      const pagos = Array.isArray(o.pagos) && o.pagos.length > 0
        ? o.pagos
        : [{ metodo: o.metodo_pago || 'Efectivo', monto: cobrado }]

      // DEBE: Caja/Banco (lo que entra — incluye propina)
      for (const p of pagos) {
        const acc = accountForMethod(p.metodo)
        const monto = Math.round((Number(p.monto) || 0) * 100) / 100
        if (monto > 0) {
          lines.push(`${fecha},${pol},"${ref}",${acc.code},${acc.name},${monto.toFixed(2)},0.00,"${p.metodo}"`)
        }
      }

      // HABER: Ingreso por venta (sin IVA, sin propina)
      lines.push(`${fecha},${pol},"${ref}",4010,Ventas de alimentos y bebidas,0.00,${subtotal.toFixed(2)},"Ingreso"`)

      // HABER: IVA trasladado
      lines.push(`${fecha},${pol},"${ref}",2110,IVA trasladado 16%,0.00,${iva.toFixed(2)},"IVA"`)

      // HABER: Propinas (si hay)
      if (propina > 0) {
        lines.push(`${fecha},${pol},"${ref}",2120,Propinas por pagar,0.00,${propina.toFixed(2)},"Propina"`)
      }

      polizaNum++
    }

    const csv = lines.join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="polizas_${clientId}_${from}_${to}.csv"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
