import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!
const MANAGERS = new Set(['admin', 'dueño', 'gerente'])

function headers(prefer = '') {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }
}

export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGERS.has(auth.role)) return Response.json({ error: 'Se requiere gerente.' }, { status: 403 })
  if (!SB_SERVICE) return Response.json({ error: 'Servicio no configurado.' }, { status: 503 })
  const body = await request.json().catch(() => ({}))
  const customerId = Number(body.customerId)
  if (!Number.isInteger(customerId) || customerId <= 0) return Response.json({ error: 'Cliente inválido.' }, { status: 400 })

  const customerResponse = await fetch(
    `${SB_URL}/rest/v1/pos_customers?id=eq.${customerId}&client_id=eq.${encodeURIComponent(auth.clientId)}&select=id,tags&limit=1`,
    { headers: headers(), cache: 'no-store' },
  )
  const customers = customerResponse.ok ? await customerResponse.json() : []
  const customer = customers[0]
  if (!customer) return Response.json({ error: 'Cliente no encontrado.' }, { status: 404 })

  const consentResponse = await fetch(`${SB_URL}/rest/v1/crm_marketing_consents`, {
    method: 'POST', headers: headers('return=minimal'),
    body: JSON.stringify({
      client_id: auth.clientId, customer_id: customerId, channel: 'whatsapp', status: 'granted',
      source: 'staff-confirmed', evidence: 'El operador confirmó autorización expresa en CRM.', captured_by: auth.staffId,
    }),
  })
  if (!consentResponse.ok) return Response.json({ error: 'No se pudo registrar evidencia de consentimiento.' }, { status: 502 })

  const tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []).filter((tag: string) => tag !== 'optin-pendiente'), 'whatsapp-optin'])]
  await fetch(`${SB_URL}/rest/v1/pos_customers?id=eq.${customerId}&client_id=eq.${encodeURIComponent(auth.clientId)}`, {
    method: 'PATCH', headers: headers('return=minimal'), body: JSON.stringify({ tags }),
  })
  return Response.json({ ok: true, tags })
}
