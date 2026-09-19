import { NextRequest } from 'next/server'
import { decideConciergeReply } from '@/lib/whatsapp-concierge-agent'
import { isOptOutMessage, mayAutoReply, normalizeWhatsAppAddress, requiresHumanReview } from '@/lib/whatsapp-agent-policy'
import { claimWhatsAppQuota } from '@/lib/whatsapp-quota'
import { sendWhatsAppText, twilioWhatsAppStatus, verifyTwilioSignature } from '@/lib/integrations/whatsapp/twilio'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!
const xml = () => new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })

function headers(prefer?: string) {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }
}

async function rows(path: string) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(), cache: 'no-store' })
  if (!response.ok) throw new Error(`supabase_${response.status}`)
  return response.json()
}

async function write(path: string, method: 'POST' | 'PATCH', body: unknown, prefer = 'return=minimal') {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: headers(prefer), body: JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) throw new Error(`supabase_write_${response.status}`)
  return prefer.includes('representation') ? response.json() : null
}

async function event(clientId: string, eventType: string, severity: 'info' | 'warning' | 'critical', detail: Record<string, unknown>) {
  await write('crm_whatsapp_events', 'POST', { client_id: clientId, event_type: eventType, severity, detail })
}

async function resolveClient(to: string) {
  const channel = await rows(`crm_whatsapp_channels?provider=eq.twilio&address=eq.${encodeURIComponent(to)}&enabled=eq.true&select=client_id&limit=1`)
  return String(channel[0]?.client_id || process.env.TWILIO_WHATSAPP_CLIENT_ID || '')
}

async function sendControlledReply(input: {
  clientId: string; phone: string; body: string; customerId?: number | null; conversationId: string
  limits: { minute: number; daily: number; monthly: number; timezone: string }; sentBy: string
}) {
  const granted = await claimWhatsAppQuota({ clientId: input.clientId, requested: 1, minuteLimit: input.limits.minute, dailyLimit: input.limits.daily, monthlyLimit: input.limits.monthly, timezone: input.limits.timezone })
  if (!granted) {
    await event(input.clientId, 'hard_quota_block', 'critical', { conversationId: input.conversationId })
    return { sent: false, reason: 'quota' }
  }
  const delivery = await sendWhatsAppText({ to: input.phone, body: input.body })
  await write('crm_whatsapp_messages', 'POST', {
    client_id: input.clientId, customer_id: input.customerId || null, provider: 'twilio', provider_message_id: delivery.sid,
    template_key: 'agent_freeform', direction: 'outbound', status: delivery.status, sent_by: input.sentBy,
    normalized_phone: input.phone, body: input.body, metadata: { conversationId: input.conversationId },
  })
  await write(`crm_whatsapp_conversations?id=eq.${encodeURIComponent(input.conversationId)}`, 'PATCH', { last_outbound_at: new Date().toISOString(), updated_at: new Date().toISOString(), unread_count: 0 })
  return { sent: true, reason: 'sent' }
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const signature = request.headers.get('x-twilio-signature') || ''
  const publicUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL || request.url
  if (!verifyTwilioSignature(publicUrl, params, signature)) return Response.json({ error: 'invalid signature' }, { status: 403 })

  const sid = params.get('MessageSid') || params.get('SmsSid') || ''
  const status = params.get('MessageStatus') || params.get('SmsStatus') || ''
  const from = params.get('From') || ''
  const to = params.get('To') || ''
  const rawBody = (params.get('Body') || '').trim()
  const numMedia = Number(params.get('NumMedia') || 0)
  const hasMedia = numMedia > 0
  const body = rawBody || (hasMedia ? '[Mensaje con archivo adjunto]' : '')
  if (!sid) return xml()
  if ((!body && !hasMedia) || !from) {
    if (sid && SB_URL && SB_SERVICE) await write(`crm_whatsapp_messages?provider_message_id=eq.${encodeURIComponent(sid)}`, 'PATCH', { status: status || 'unknown', error_code: params.get('ErrorCode') || null, updated_at: new Date().toISOString() })
    return xml()
  }
  if (!SB_URL || !SB_SERVICE) return xml()
  const clientId = await resolveClient(to)
  if (!clientId) return xml()
  const phone = normalizeWhatsAppAddress(from)

  try {
    const customerRows = await rows(`pos_customers?client_id=eq.${encodeURIComponent(clientId)}&phone=ilike.${encodeURIComponent(`*${phone.slice(-10)}`)}&select=id,name,phone&limit=1`)
    const customer = customerRows[0] as { id: number; name: string | null } | undefined
    const inserted = await write('crm_whatsapp_messages?on_conflict=provider_message_id', 'POST', {
      client_id: clientId, customer_id: customer?.id || null, provider: 'twilio', provider_message_id: sid,
      template_key: 'inbound_text', direction: 'inbound', status: 'received', normalized_phone: phone, body,
      metadata: { numMedia },
    }, 'resolution=ignore-duplicates,return=representation')
    if (!inserted?.length) return xml()

    const conversations = await write('crm_whatsapp_conversations?on_conflict=client_id,normalized_phone', 'POST', {
      client_id: clientId, customer_id: customer?.id || null, normalized_phone: phone, status: 'open', handled_by: 'ai',
      unread_count: 1, last_inbound_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'resolution=merge-duplicates,return=representation')
    const conversation = conversations[0]
    const settingsRows = await rows(`crm_whatsapp_automations?client_id=eq.${encodeURIComponent(clientId)}&name=eq.Reactivaci%C3%B3n%20cenas&select=*&limit=1`)
    const settings = settingsRows[0] || {}
    const limits = { minute: Number(settings.minute_limit) || 5, daily: Number(settings.daily_limit) || 80, monthly: Number(settings.monthly_limit) || 1500, timezone: settings.timezone || 'America/Monterrey' }

    if (isOptOutMessage(body)) {
      if (customer?.id) await write('crm_marketing_consents', 'POST', { client_id: clientId, customer_id: customer.id, channel: 'whatsapp', status: 'revoked', source: 'inbound_opt_out', evidence: sid, captured_by: 'system' })
      await write(`crm_whatsapp_conversations?id=eq.${conversation.id}`, 'PATCH', { status: 'opted_out', handled_by: 'human', handoff_reason: 'opt_out', updated_at: new Date().toISOString() })
      if (twilioWhatsAppStatus().enabled) await sendControlledReply({ clientId, phone, customerId: customer?.id, conversationId: conversation.id, limits, sentBy: 'opt_out_system', body: 'Listo. Ya no recibirás mensajes promocionales de Amalay. Si deseas volver a contactarnos, aquí seguimos.' })
      return xml()
    }

    const agentApproved = settings.ai_status === 'approved' && settings.ai_mode === 'auto'
    if (process.env.WHATSAPP_AI_ENABLED !== 'true' || !agentApproved || requiresHumanReview(body) || hasMedia) {
      const reason = hasMedia ? 'media_attachment' : requiresHumanReview(body) ? 'sensitive_topic' : 'agent_not_approved'
      await write(`crm_whatsapp_conversations?id=eq.${conversation.id}`, 'PATCH', { status: 'waiting_human', handled_by: 'human', handoff_reason: reason, updated_at: new Date().toISOString() })
      await event(clientId, 'conversation_handoff', 'warning', { conversationId: conversation.id, reason })
      return xml()
    }

    const historyRows = await rows(`crm_whatsapp_messages?client_id=eq.${encodeURIComponent(clientId)}&normalized_phone=eq.${encodeURIComponent(phone)}&select=direction,body&body=not.is.null&order=created_at.desc&limit=12`)
    const { decision, usage } = await decideConciergeReply({ message: body, customerName: customer?.name, history: historyRows.reverse().map((item: { direction: 'inbound' | 'outbound'; body: string }) => ({ direction: item.direction, body: item.body })) })
    const threshold = Number(settings.ai_confidence_threshold) || 0.82
    const gate = mayAutoReply({ enabled: twilioWhatsAppStatus().enabled, approved: agentApproved, confidence: decision.confidence, threshold, message: body })
    await write('crm_whatsapp_ai_runs', 'POST', {
      client_id: clientId, conversation_id: conversation.id, inbound_message_id: inserted[0].id,
      model: process.env.WHATSAPP_AI_MODEL || 'openai/gpt-5.4-mini', action: gate.allowed ? decision.action : 'handoff', intent: decision.intent,
      confidence: decision.confidence, reply: decision.reply || null, handoff_reason: gate.allowed ? decision.handoffReason : gate.reason,
      input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
    })
    if (decision.intent === 'reservation' && decision.reservation) await write('crm_whatsapp_reservation_requests', 'POST', {
      client_id: clientId, conversation_id: conversation.id, customer_id: customer?.id || null,
      requested_name: decision.reservation.name, requested_date: decision.reservation.date, requested_time: decision.reservation.time,
      party_size: decision.reservation.partySize,
      status: decision.reservation.date && decision.reservation.time && decision.reservation.partySize ? 'pending_confirmation' : 'needs_details',
    })
    if (!gate.allowed || decision.action !== 'reply' || !decision.reply) {
      const reason = gate.allowed ? decision.handoffReason || decision.action : gate.reason
      await write(`crm_whatsapp_conversations?id=eq.${conversation.id}`, 'PATCH', { status: 'waiting_human', handled_by: 'human', handoff_reason: reason, updated_at: new Date().toISOString() })
      await event(clientId, 'conversation_handoff', 'warning', { conversationId: conversation.id, reason })
      return xml()
    }
    const sent = await sendControlledReply({ clientId, phone, body: decision.reply, customerId: customer?.id, conversationId: conversation.id, limits, sentBy: 'ai_concierge' })
    if (!sent.sent) await write(`crm_whatsapp_conversations?id=eq.${conversation.id}`, 'PATCH', { status: 'waiting_human', handled_by: 'human', handoff_reason: sent.reason, updated_at: new Date().toISOString() })
  } catch (error) {
    console.error('[WhatsApp inbound]', clientId, error)
    await event(clientId, 'inbound_processing_failed', 'critical', { sid, error: error instanceof Error ? error.message : 'unknown' }).catch(() => undefined)
  }
  return xml()
}
