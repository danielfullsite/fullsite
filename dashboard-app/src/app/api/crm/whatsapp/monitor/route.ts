import { NextRequest } from 'next/server'
import { shouldOpenCircuitBreaker } from '@/lib/whatsapp-agent-policy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!
const headers = (prefer?: string) => ({ apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) })

async function rows(path: string) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(), cache: 'no-store' })
  if (!response.ok) throw new Error(`monitor_read_${response.status}`)
  return response.json()
}

async function write(path: string, method: 'POST' | 'PATCH', body: unknown) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: headers('return=minimal'), body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`monitor_write_${response.status}`)
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'No autorizado.' }, { status: 401 })
  if (!SB_URL || !SB_SERVICE) return Response.json({ ok: true, active: false })
  const automations = await rows('crm_whatsapp_automations?or=(status.eq.approved,ai_status.eq.approved)&select=id,client_id,status,ai_status')
  const sinceHour = new Date(Date.now() - 3_600_000).toISOString()
  const outcomes = []
  for (const automation of automations) {
    const client = encodeURIComponent(automation.client_id)
    const messages = await rows(`crm_whatsapp_messages?client_id=eq.${client}&direction=eq.outbound&created_at=gte.${encodeURIComponent(sinceHour)}&select=status`)
    const failed = messages.filter((message: { status: string }) => ['failed', 'undelivered'].includes(message.status)).length
    const failureRate = messages.length ? failed / messages.length : 0
    if (shouldOpenCircuitBreaker(failed, messages.length)) {
      await write(`crm_whatsapp_automations?id=eq.${automation.id}`, 'PATCH', { status: 'paused', ai_status: 'paused', updated_at: new Date().toISOString() })
      await write('crm_whatsapp_events', 'POST', {
        client_id: automation.client_id, event_type: 'circuit_breaker_opened', severity: 'critical',
        detail: { failed, outbound: messages.length, failureRate },
      })
      outcomes.push({ clientId: automation.client_id, action: 'paused', failed, failureRate })
    } else outcomes.push({ clientId: automation.client_id, action: 'healthy', failed, outbound: messages.length })
  }
  return Response.json({ ok: true, active: true, outcomes })
}
