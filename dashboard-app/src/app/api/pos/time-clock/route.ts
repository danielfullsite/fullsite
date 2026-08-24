import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

// Checador · POST registra entrada/salida por PIN; GET lista recientes.
// clientId SIEMPRE se resuelve del server (withPOSAuth). Escribe con service_role
// tras validar que el caller es una terminal legítima del tenant.
export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_KEY || ''

function svc(path: string, init?: RequestInit) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  })
}

export async function GET(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!SERVICE) return Response.json({ error: 'SERVER_CONFIG' }, { status: 500 })
  const r = await svc(`pos_time_clock?client_id=eq.${encodeURIComponent(auth.clientId)}&select=staff_name,type,method,ts&order=ts.desc&limit=25`)
  const rows = r.ok ? await r.json().catch(() => []) : []
  return Response.json({ registros: rows })
}

export async function POST(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!SERVICE) return Response.json({ error: 'SERVER_CONFIG' }, { status: 500 })
  const clientId = auth.clientId

  let body: { pin?: string; method?: string } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  const pin = String(body.pin || '').trim()
  const method = body.method === 'huella' ? 'huella' : 'pin'
  // Keep legacy staff working during biometric rollout; all newly assigned
  // credentials are exactly 10 digits.
  if (!/^\d{3,10}$/.test(pin)) return Response.json({ error: 'PIN inválido' }, { status: 400 })

  // 1. Identificar al empleado por PIN dentro del tenant.
  const sr = await svc(`pos_staff?client_id=eq.${encodeURIComponent(clientId)}&pin=eq.${encodeURIComponent(pin)}&active=eq.true&select=id,name&limit=1`)
  const staff = sr.ok ? await sr.json().catch(() => []) : []
  if (!Array.isArray(staff) || staff.length === 0) return Response.json({ error: 'PIN no encontrado' }, { status: 404 })
  const { id: staffId, name: staffName } = staff[0]

  // 2. Determinar tipo: alterna según el último registro del empleado.
  const lr = await svc(`pos_time_clock?client_id=eq.${encodeURIComponent(clientId)}&staff_id=eq.${encodeURIComponent(staffId)}&select=type&order=ts.desc&limit=1`)
  const last = lr.ok ? await lr.json().catch(() => []) : []
  const type = last[0]?.type === 'entrada' ? 'salida' : 'entrada'

  // 3. Insertar.
  const ins = await svc('pos_time_clock', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ client_id: clientId, staff_id: staffId, staff_name: staffName, type, method }]),
  })
  if (!ins.ok) {
    const detail = await ins.text().catch(() => '')
    return Response.json({ error: 'No se pudo registrar', detail }, { status: 502 })
  }
  const inserted = (await ins.json().catch(() => []))[0] || {}

  // 4. Recientes del empleado.
  const rr = await svc(`pos_time_clock?client_id=eq.${encodeURIComponent(clientId)}&staff_id=eq.${encodeURIComponent(staffId)}&select=type,method,ts&order=ts.desc&limit=8`)
  const recientes = rr.ok ? await rr.json().catch(() => []) : []

  return Response.json({ ok: true, staff_name: staffName, type, ts: inserted.ts, recientes })
}
