import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { sendAmalayTemplate, twilioWhatsAppStatus } from '@/lib/integrations/whatsapp/twilio'
import { claimWhatsAppQuota } from '@/lib/whatsapp-quota'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!
const MANAGERS = new Set(['admin', 'dueño', 'gerente'])

function serviceHeaders() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' }
}

export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGERS.has(auth.role)) return Response.json({ error: 'Se requiere gerente.' }, { status: 403 })
  if (!SB_SERVICE) return Response.json({ error: 'Servicio no configurado.' }, { status: 503 })
  const provider = twilioWhatsAppStatus()
  if (!provider.enabled || !provider.configured) {
    return Response.json({ error: 'WhatsApp todavía no está activado para envíos reales.' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const customerId = Number(body.customerId)
  if (!Number.isInteger(customerId) || customerId <= 0) return Response.json({ error: 'Cliente inválido.' }, { status: 400 })

  const customerResponse = await fetch(
    `${SB_URL}/rest/v1/pos_customers?id=eq.${customerId}&client_id=eq.${encodeURIComponent(auth.clientId)}&select=id,name,phone&limit=1`,
    { headers: serviceHeaders(), cache: 'no-store' },
  )
  const customers = customerResponse.ok ? await customerResponse.json() : []
  const customer = customers[0]
  if (!customer?.phone) return Response.json({ error: 'Cliente o teléfono no encontrado.' }, { status: 404 })

  const consentResponse = await fetch(
    `${SB_URL}/rest/v1/crm_marketing_consents?client_id=eq.${encodeURIComponent(auth.clientId)}&customer_id=eq.${customerId}&channel=eq.whatsapp&status=eq.granted&select=id,captured_at&order=captured_at.desc&limit=1`,
    { headers: serviceHeaders(), cache: 'no-store' },
  )
  const consents = consentResponse.ok ? await consentResponse.json() : []
  if (!consents.length) return Response.json({ error: 'Falta evidencia de consentimiento de WhatsApp.' }, { status: 412 })

  try {
    const settingsResponse = await fetch(`${SB_URL}/rest/v1/crm_whatsapp_automations?client_id=eq.${encodeURIComponent(auth.clientId)}&name=eq.Reactivaci%C3%B3n%20cenas&select=minute_limit,daily_limit,monthly_limit,timezone&limit=1`, { headers: serviceHeaders(), cache: 'no-store' })
    const settings = settingsResponse.ok ? (await settingsResponse.json())[0] || {} : {}
    const granted = await claimWhatsAppQuota({
      clientId: auth.clientId, requested: 1, minuteLimit: settings.minute_limit,
      dailyLimit: settings.daily_limit, monthlyLimit: settings.monthly_limit, timezone: settings.timezone,
    })
    if (!granted) return Response.json({ error: 'Envío bloqueado por el límite operativo de WhatsApp.' }, { status: 429 })
    const sent = await sendAmalayTemplate({ to: customer.phone, firstName: String(customer.name || '').split(/\s+/)[0] })
    const stored = await fetch(`${SB_URL}/rest/v1/crm_whatsapp_messages`, {
      method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: auth.clientId, customer_id: customer.id, provider: 'twilio',
        provider_message_id: sent.sid, template_key: 'amalay_cena_vino_375', status: sent.status,
        direction: 'outbound', sent_by: auth.staffId, normalized_phone: customer.phone,
      }),
    })
    if (!stored.ok) throw new Error(`message_store_${stored.status}`)
    return Response.json({ ok: true, messageId: sent.sid, status: sent.status })
  } catch (error) {
    console.error('[WhatsApp send]', error)
    return Response.json({ error: 'El proveedor rechazó el envío.' }, { status: 502 })
  }
}
