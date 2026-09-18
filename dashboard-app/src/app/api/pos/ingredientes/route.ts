import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { isManager } from '@/lib/pos-db-policy'

/**
 * ALTA DE INGREDIENTE — la identidad la pone el servidor.
 *
 * Antes no existía esta frontera, y por eso el formulario de compras fabricaba
 * el `ingredient_id` a partir del nombre tecleado
 * (`nombre.toLowerCase().replace(/\s+/g,'_')`). El resultado, reproducido el
 * 2026-09-18: una orden con un ingrediente que no existía, `SCOPE_CONFLICT`, y
 * una cabecera huérfana en la base.
 *
 * La UI manda name/unit/cost. El servidor resuelve el tenant desde la sesión
 * —nunca desde el cuerpo—, valida, genera un UUID y devuelve el ingrediente
 * confirmado. Quien lo llama usa ESE id, no uno que haya adivinado.
 */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!isManager(auth.role)) return Response.json({ error: 'MANAGER_REQUIRED' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })

  const texto = (v: unknown, max: number) => typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null
  const name = texto(body.name, 120)
  const unit = texto(body.unit, 24)
  const cost = body.cost_per_unit === undefined || body.cost_per_unit === null ? 0 : Number(body.cost_per_unit)
  if (!name || !unit || !Number.isFinite(cost) || cost < 0) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  // El tenant sale de la sesión. Si el cuerpo trae otro, es una discrepancia y
  // se rechaza en vez de resolverse en silencio a favor de uno de los dos.
  if (body.client_id !== undefined && body.client_id !== auth.clientId) {
    return Response.json({ error: 'TENANT_MISMATCH' }, { status: 403 })
  }

  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'INGREDIENT_UNAVAILABLE' }, { status: 503 })
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/pos_create_ingredient`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: auth.clientId, p_name: name, p_unit: unit, p_cost: cost,
                             p_category: texto(body.category, 60), p_supplier: texto(body.supplier, 120) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await res.json()
    if (!res.ok) {
      const conocidos = ['NAME_REQUIRED', 'UNIT_REQUIRED', 'INVALID_COST', 'INGREDIENT_NAME_TAKEN', 'SCOPE_REQUIRED']
      const error = conocidos.includes(result?.message) ? result.message : 'INGREDIENT_UNCONFIRMED'
      return Response.json({ error }, { status: error === 'INGREDIENT_UNCONFIRMED' ? 503 : 409 })
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'INGREDIENT_UNCONFIRMED' }, { status: 503 }) }
}
