import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

// Checador · POST registra entrada/salida por PIN; GET lista recientes.
// clientId SIEMPRE se resuelve del server (withPOSAuth). Escribe con service_role
// tras validar que el caller es una terminal legítima del tenant.
export const dynamic = 'force-dynamic'

function svc(path: string, init?: RequestInit) {
  const service = process.env.SUPABASE_SERVICE_KEY || ''
  return fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  })
}

export async function GET(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_KEY) return Response.json({ error: 'SERVER_CONFIG' }, { status: 500 })
  const r = await svc(`pos_time_clock?client_id=eq.${encodeURIComponent(auth.clientId)}&select=staff_name,type,method,ts&order=ts.desc&limit=25`)
  const rows = r.ok ? await r.json().catch(() => []) : []
  return Response.json({ registros: rows })
}

export async function POST(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_KEY) return Response.json({ error: 'SERVER_CONFIG' }, { status: 500 })
  const clientId = auth.clientId

  let body: { pin?: string; operation_id?: string } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  const pin = String(body.pin || '').trim()
  const operationId = String(body.operation_id || '').trim()
  // Keep legacy staff working during biometric rollout; all newly assigned
  // credentials are exactly 10 digits.
  if (!/^\d{3,10}$/.test(pin)) return Response.json({ error: 'PIN inválido' }, { status: 400 })
  if (!operationId || operationId.length > 200) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })

  // El PIN prueba identidad; por eso el método canónico es `pin`. Un string
  // `method: huella` enviado por el navegador nunca convierte un PIN en biometría.
  try {
    const response = await svc('rpc/r1_time_clock_atomic', {
      method: 'POST',
      body: JSON.stringify({ p_client_id: clientId, p_pin: pin, p_operation_id: operationId }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = ['PIN_NOT_FOUND', 'PIN_AMBIGUOUS', 'OPERATION_ID_REUSED'].includes(result.message)
        ? result.message : 'TIME_CLOCK_UNCONFIRMED'
      const status = error === 'PIN_NOT_FOUND' ? 404 : error === 'TIME_CLOCK_UNCONFIRMED' ? 503 : 409
      return Response.json({ error }, { status })
    }
    if (result?.ok !== true || !['entrada', 'salida'].includes(result.type) ||
        typeof result.staff_name !== 'string' || typeof result.ts !== 'string' || !Array.isArray(result.recientes)) {
      throw new Error('INVALID_RECEIPT')
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'TIME_CLOCK_UNCONFIRMED' }, { status: 503 })
  }
}
