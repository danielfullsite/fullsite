// Tacómetro de mano de obra — costo de labor por día y por empleado.
// Server-side con service key: los sueldos (pos_staff.hourly_rate/weekly_salary)
// son sensibles y no deben viajar con la anon key. La página cruza esto con la
// venta (getDashboardFromPosOrders) para sacar el % labor/venta y el semáforo.
// Ver src/lib/labor.ts para el contrato y el cálculo puro.

import { withPOSAuth } from '@/lib/api-auth'
import { isOperationalRole, type LaborDay, type LaborEmployee, type LaborPayload } from '@/lib/labor'
import { NextRequest } from 'next/server'

interface ShiftRow { staff_id: string | null; staff_name: string | null; clock_in: string | null; clock_out: string | null; hours_worked: number | null }
interface StaffRow { id: string; name: string | null; role: string | null; hourly_rate: number | null; weekly_salary: number | null }

const HOURS_PER_WEEK = 48 // jornada MX de referencia para derivar $/hora desde sueldo semanal

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    const opts = { headers, cache: 'no-store' as const }
    const clientId = auth.clientId

    const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') || '30', 10) || 30, 1), 120)
    const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    const [shiftsRes, staffRes] = await Promise.all([
      fetch(`${sbUrl}/rest/v1/pos_staff_shifts?client_id=eq.${clientId}&clock_in=gte.${fromDate}&select=staff_id,staff_name,clock_in,clock_out,hours_worked`, opts),
      fetch(`${sbUrl}/rest/v1/pos_staff?client_id=eq.${clientId}&select=id,name,role,hourly_rate,weekly_salary`, opts),
    ])

    const shifts: ShiftRow[] = shiftsRes.ok ? await shiftsRes.json() : []
    const staff: StaffRow[] = staffRes.ok ? await staffRes.json() : []

    // Órdenes paginadas: PostgREST corta en 1000 filas, así que sin paginar la
    // venta sale truncada (y algunos días sin match). Tope de 60k por seguridad.
    const orders: Array<{ created_at: string; total: number | null }> = []
    for (let offset = 0; offset < 60000; offset += 1000) {
      const r = await fetch(`${sbUrl}/rest/v1/pos_orders?client_id=eq.${clientId}&status=eq.cerrada&created_at=gte.${fromDate}&select=created_at,total&order=created_at.asc&limit=1000&offset=${offset}`, opts)
      if (!r.ok) break
      const page: Array<{ created_at: string; total: number | null }> = await r.json()
      orders.push(...page)
      if (page.length < 1000) break
    }

    // Fecha de calendario en zona MX (UTC-6, sin DST) — mismo criterio para turnos
    // y ventas, así el cruce día-a-día alinea (no usar business_day de otra capa).
    const mxDate = (iso: string): string => new Date(new Date(iso).getTime() - 6 * 3600000).toISOString().slice(0, 10)

    // Venta por día (MX) desde las órdenes cerradas.
    const salesByDay = new Map<string, number>()
    for (const o of orders) {
      if (!o.created_at) continue
      const f = mxDate(o.created_at)
      salesByDay.set(f, (salesByDay.get(f) || 0) + (Number(o.total) || 0))
    }

    // $/hora efectivo por empleado (hourly_rate directo, o derivado del semanal).
    const rateById = new Map<string, number>()
    const roleById = new Map<string, string>()
    const nameById = new Map<string, string>()
    let hasWageData = false
    for (const s of staff) {
      const hr = Number(s.hourly_rate) || 0
      const wk = Number(s.weekly_salary) || 0
      const rate = hr > 0 ? hr : (wk > 0 ? wk / HOURS_PER_WEEK : 0)
      if (rate > 0) hasWageData = true
      rateById.set(s.id, rate)
      roleById.set(s.id, (s.role || '').trim())
      nameById.set(s.id, s.name || s.id)
    }

    const now = Date.now()
    const byDay = new Map<string, { cost: number; hours: number; staffSet: Set<string> }>()
    const byEmp = new Map<string, LaborEmployee>()

    for (const sh of shifts) {
      const sid = sh.staff_id || ''
      if (!isOperationalRole(roleById.get(sid))) continue // fuera corporativo/mantenimiento/etc.
      if (!sh.clock_in) continue

      // horas: las registradas al cerrar, o el transcurrido si el turno sigue abierto.
      let hours = Number(sh.hours_worked) || 0
      if (hours <= 0 && !sh.clock_out) {
        const elapsed = (now - new Date(sh.clock_in).getTime()) / 3600000
        hours = Math.max(0, Math.min(elapsed, 24)) // tope 24h por si quedó abierto
      }
      if (hours <= 0) continue

      const rate = rateById.get(sid) || 0
      const cost = Math.round(hours * rate * 100) / 100
      const fecha = mxDate(sh.clock_in)

      const d = byDay.get(fecha) || { cost: 0, hours: 0, staffSet: new Set<string>() }
      d.cost += cost; d.hours += hours; if (sid) d.staffSet.add(sid)
      byDay.set(fecha, d)

      const name = sh.staff_name || nameById.get(sid) || sid
      const e = byEmp.get(sid) || { staff_id: sid, name, role: roleById.get(sid) || '', hours: 0, cost: 0 }
      e.hours += hours; e.cost += cost
      byEmp.set(sid, e)
    }

    const laborByDay: LaborDay[] = [...byDay.entries()]
      .map(([fecha, d]) => ({
        fecha,
        cost: Math.round(d.cost * 100) / 100,
        hours: Math.round(d.hours * 10) / 10,
        headcount: d.staffSet.size,
        sales: Math.round((salesByDay.get(fecha) || 0) * 100) / 100,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    const employees: LaborEmployee[] = [...byEmp.values()]
      .map(e => ({ ...e, hours: Math.round(e.hours * 10) / 10, cost: Math.round(e.cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost)

    const payload: LaborPayload = {
      days,
      laborByDay,
      employees,
      totalCost: Math.round(laborByDay.reduce((s, d) => s + d.cost, 0) * 100) / 100,
      totalHours: Math.round(laborByDay.reduce((s, d) => s + d.hours, 0) * 10) / 10,
      totalSales: Math.round(laborByDay.reduce((s, d) => s + d.sales, 0) * 100) / 100,
      hasWageData,
    }
    return Response.json(payload)
  } catch {
    return Response.json({ days: 0, laborByDay: [], employees: [], totalCost: 0, totalHours: 0, totalSales: 0, hasWageData: false } as LaborPayload)
  }
}
