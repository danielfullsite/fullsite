import { NextRequest } from 'next/server'
import { mayRunAutomation, normalizeCadence, planAutomationBatch } from '@/lib/whatsapp-automation'
import { segmentFromLastVisit } from '@/lib/reservation-crm'
import { sendAmalayTemplate, twilioWhatsAppStatus } from '@/lib/integrations/whatsapp/twilio'
import { claimWhatsAppQuota } from '@/lib/whatsapp-quota'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!

interface DbCustomer {
  id: number
  name: string | null
  phone: string | null
  last_visit: string | null
}

function headers(prefer?: string) {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }
}

async function rows(path: string) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(), cache: 'no-store' })
  if (!response.ok) throw new Error(`supabase_${response.status}`)
  return response.json()
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 })
  }
  const provider = twilioWhatsAppStatus()
  if (process.env.WHATSAPP_AUTOMATION_ENABLED !== 'true' || !provider.enabled || !provider.configured) {
    return Response.json({ ok: true, active: false, sent: 0 })
  }

  const now = new Date()
  const automations = await rows('crm_whatsapp_automations?status=eq.approved&template_key=eq.amalay_cena_vino_375&select=*')
  const results: Array<{ clientId: string; sent: number; skipped?: string }> = []

  for (const automation of automations) {
    const clientId = String(automation.client_id)
    try {
      const since24h = new Date(now.getTime() - 86_400_000).toISOString()
      const messages = await rows(`crm_whatsapp_messages?client_id=eq.${encodeURIComponent(clientId)}&direction=eq.outbound&created_at=gte.${encodeURIComponent(since24h)}&select=customer_id,created_at`)
      const cadence = normalizeCadence({
        status: automation.status, timezone: automation.timezone, sendDays: automation.send_days,
        windowStart: String(automation.window_start).slice(0, 5), windowEnd: String(automation.window_end).slice(0, 5),
        dailyLimit: automation.daily_limit, batchSize: automation.batch_size,
        cooldownDays: automation.cooldown_days, frequencyDays: automation.frequency_days,
        minuteLimit: automation.minute_limit, monthlyLimit: automation.monthly_limit,
      })
      const gate = mayRunAutomation(cadence, { sentToday: messages.length, lastRunAt: automation.last_run_at }, now)
      if (!gate.allowed) { results.push({ clientId, sent: 0, skipped: gate.reason }); continue }

      const [customers, consents, history] = await Promise.all([
        rows(`pos_customers?client_id=eq.${encodeURIComponent(clientId)}&phone=not.is.null&select=id,name,phone,last_visit&limit=2000`),
        rows(`crm_marketing_consents?client_id=eq.${encodeURIComponent(clientId)}&channel=eq.whatsapp&select=customer_id,status,captured_at&order=captured_at.desc`),
        rows(`crm_whatsapp_messages?client_id=eq.${encodeURIComponent(clientId)}&direction=eq.outbound&select=customer_id,created_at&order=created_at.desc&limit=5000`),
      ])
      const consent = new Map<number, boolean>()
      for (const item of consents) if (!consent.has(Number(item.customer_id))) consent.set(Number(item.customer_id), item.status === 'granted')
      const lastOutbound = new Map<number, string>()
      for (const item of history) if (item.customer_id && !lastOutbound.has(Number(item.customer_id))) lastOutbound.set(Number(item.customer_id), item.created_at)
      const audience = (customers as DbCustomer[]).filter(customer => segmentFromLastVisit(customer.last_visit, now) === automation.segment)
      const plan = planAutomationBatch(cadence, audience.map(customer => ({
        id: customer.id, hasOptIn: consent.get(customer.id) === true, lastOutboundAt: lastOutbound.get(customer.id),
      })), messages.length, now)
      const byId = new Map<number, DbCustomer>(audience.map(customer => [customer.id, customer]))
      const granted = await claimWhatsAppQuota({
        clientId, requested: plan.contactIds.length, minuteLimit: cadence.minuteLimit,
        dailyLimit: cadence.dailyLimit, monthlyLimit: cadence.monthlyLimit, timezone: cadence.timezone,
      })
      if (!granted) { results.push({ clientId, sent: 0, skipped: 'quota' }); continue }
      let sent = 0
      for (const customerId of plan.contactIds.slice(0, granted)) {
        const customer = byId.get(customerId)
        if (!customer?.phone) continue
        try {
          const delivery = await sendAmalayTemplate({ to: customer.phone, firstName: String(customer.name || '').split(/\s+/)[0] })
          const stored = await fetch(`${SB_URL}/rest/v1/crm_whatsapp_messages`, {
            method: 'POST', headers: headers('return=minimal'),
            body: JSON.stringify({
              client_id: clientId, customer_id: customer.id, campaign_id: automation.id,
              provider: 'twilio', provider_message_id: delivery.sid, template_key: automation.template_key,
              direction: 'outbound', status: delivery.status, sent_by: 'automation', normalized_phone: customer.phone,
            }),
          })
          if (!stored.ok) throw new Error(`message_store_${stored.status}`)
          sent += 1
        } catch (error) {
          await fetch(`${SB_URL}/rest/v1/crm_whatsapp_events`, {
            method: 'POST', headers: headers('return=minimal'), body: JSON.stringify({
              client_id: clientId, event_type: 'campaign_send_failed', severity: 'warning',
              detail: { customerId, error: error instanceof Error ? error.message : 'unknown' },
            }),
          })
        }
      }
      await fetch(`${SB_URL}/rest/v1/crm_whatsapp_automations?id=eq.${automation.id}`, {
        method: 'PATCH', headers: headers('return=minimal'), body: JSON.stringify({ last_run_at: now.toISOString(), updated_at: now.toISOString() }),
      })
      results.push({ clientId, sent })
    } catch (error) {
      console.error('[WhatsApp automation run]', clientId, error)
      results.push({ clientId, sent: 0, skipped: 'error' })
    }
  }
  return Response.json({ ok: true, active: true, sent: results.reduce((total, item) => total + item.sent, 0), results })
}
