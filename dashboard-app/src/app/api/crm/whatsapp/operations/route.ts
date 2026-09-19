import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { twilioWhatsAppStatus } from '@/lib/integrations/whatsapp/twilio'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!

function headers(prefer?: string) {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, ...(prefer ? { Prefer: prefer } : {}) }
}

async function count(path: string) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers('count=exact'), cache: 'no-store' })
  if (!response.ok) return 0
  return Number((response.headers.get('content-range') || '').split('/')[1]) || 0
}

async function rows(path: string) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(), cache: 'no-store' })
  if (!response.ok) return []
  return response.json()
}

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!SB_URL || !SB_SERVICE) return Response.json({ configured: false })
  const client = encodeURIComponent(auth.clientId)
  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())
  const [waitingHuman, open, inbound24h, outbound24h, failures24h, aiReplies24h, critical24h, quotaRows] = await Promise.all([
    count(`crm_whatsapp_conversations?client_id=eq.${client}&status=eq.waiting_human&select=id`),
    count(`crm_whatsapp_conversations?client_id=eq.${client}&status=eq.open&select=id`),
    count(`crm_whatsapp_messages?client_id=eq.${client}&direction=eq.inbound&created_at=gte.${since}&select=id`),
    count(`crm_whatsapp_messages?client_id=eq.${client}&direction=eq.outbound&created_at=gte.${since}&select=id`),
    count(`crm_whatsapp_events?client_id=eq.${client}&event_type=in.(campaign_send_failed,inbound_processing_failed)&created_at=gte.${since}&select=id`),
    count(`crm_whatsapp_ai_runs?client_id=eq.${client}&action=eq.reply&created_at=gte.${since}&select=id`),
    count(`crm_whatsapp_events?client_id=eq.${client}&severity=eq.critical&created_at=gte.${since}&select=id`),
    rows(`crm_whatsapp_quota_buckets?client_id=eq.${client}&select=bucket_kind,bucket_start,used,hard_limit&order=bucket_start.desc&limit=12`),
  ])
  const latest = (kind: string) => quotaRows.find((row: { bucket_kind: string }) => row.bucket_kind === kind) || null
  return Response.json({
    configured: true,
    provider: twilioWhatsAppStatus(),
    aiEnabled: process.env.WHATSAPP_AI_ENABLED === 'true',
    automationEnabled: process.env.WHATSAPP_AUTOMATION_ENABLED === 'true',
    conversations: { open, waitingHuman },
    last24Hours: { inbound: inbound24h, outbound: outbound24h, aiReplies: aiReplies24h, failures: failures24h, critical: critical24h },
    quota: { minute: latest('minute'), day: latest('day'), month: latest('month') },
  })
}
