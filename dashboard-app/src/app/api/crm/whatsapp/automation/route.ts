import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { DEFAULT_WHATSAPP_CADENCE, normalizeCadence } from '@/lib/whatsapp-automation'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY!
const MANAGERS = new Set(['admin', 'dueño', 'gerente'])

function serviceHeaders(prefer?: string) {
  return {
    apikey: SB_SERVICE,
    Authorization: `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id || null,
    name: row.name || 'Reactivación cenas',
    segment: row.segment || 'inactive',
    templateKey: row.template_key || 'amalay_cena_vino_375',
    status: row.status || DEFAULT_WHATSAPP_CADENCE.status,
    timezone: row.timezone || DEFAULT_WHATSAPP_CADENCE.timezone,
    sendDays: row.send_days || DEFAULT_WHATSAPP_CADENCE.sendDays,
    windowStart: String(row.window_start || DEFAULT_WHATSAPP_CADENCE.windowStart).slice(0, 5),
    windowEnd: String(row.window_end || DEFAULT_WHATSAPP_CADENCE.windowEnd).slice(0, 5),
    dailyLimit: row.daily_limit || DEFAULT_WHATSAPP_CADENCE.dailyLimit,
    batchSize: row.batch_size || DEFAULT_WHATSAPP_CADENCE.batchSize,
    cooldownDays: row.cooldown_days || DEFAULT_WHATSAPP_CADENCE.cooldownDays,
    frequencyDays: row.frequency_days || DEFAULT_WHATSAPP_CADENCE.frequencyDays,
    minuteLimit: row.minute_limit || DEFAULT_WHATSAPP_CADENCE.minuteLimit,
    monthlyLimit: row.monthly_limit || DEFAULT_WHATSAPP_CADENCE.monthlyLimit,
    aiStatus: row.ai_status || DEFAULT_WHATSAPP_CADENCE.aiStatus,
    aiMode: row.ai_mode || DEFAULT_WHATSAPP_CADENCE.aiMode,
    aiConfidenceThreshold: Number(row.ai_confidence_threshold || DEFAULT_WHATSAPP_CADENCE.aiConfidenceThreshold),
    approvedAt: row.approved_at || null,
    approvedBy: row.approved_by || null,
    lastRunAt: row.last_run_at || null,
  }
}

async function loadAutomation(clientId: string) {
  const response = await fetch(
    `${SB_URL}/rest/v1/crm_whatsapp_automations?client_id=eq.${encodeURIComponent(clientId)}&name=eq.Reactivaci%C3%B3n%20cenas&select=*&limit=1`,
    { headers: serviceHeaders(), cache: 'no-store' },
  )
  if (!response.ok) throw new Error(`automation_read_${response.status}`)
  return (await response.json())[0] as Record<string, unknown> | undefined
}

async function countRecentMessages(clientId: string) {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const response = await fetch(
    `${SB_URL}/rest/v1/crm_whatsapp_messages?client_id=eq.${encodeURIComponent(clientId)}&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&select=id`,
    { headers: serviceHeaders('count=exact'), cache: 'no-store' },
  )
  if (!response.ok) return 0
  const range = response.headers.get('content-range') || ''
  return Number(range.split('/')[1]) || 0
}

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!SB_SERVICE) return Response.json({ ...DEFAULT_WHATSAPP_CADENCE, configured: false })
  try {
    const [row, sentLast24Hours] = await Promise.all([
      loadAutomation(auth.clientId), countRecentMessages(auth.clientId),
    ])
    return Response.json({ ...serialize(row || {}), configured: Boolean(row), sentLast24Hours })
  } catch (error) {
    console.error('[WhatsApp automation read]', error)
    return Response.json({ error: 'No se pudo leer la automatización.' }, { status: 502 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!MANAGERS.has(auth.role)) return Response.json({ error: 'Se requiere gerente.' }, { status: 403 })
  if (!SB_SERVICE) return Response.json({ error: 'Servicio no configurado.' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const action = String(body.action || 'save')
  if (!['save', 'request_review', 'approve', 'pause', 'request_ai_review', 'approve_ai', 'pause_ai'].includes(action)) {
    return Response.json({ error: 'Acción inválida.' }, { status: 400 })
  }

  try {
    const existing = await loadAutomation(auth.clientId)
    if (action === 'approve' && existing?.status !== 'pending_review') {
      return Response.json({ error: 'Primero envía la campaña a revisión.' }, { status: 409 })
    }
    if (action === 'approve_ai' && existing?.ai_status !== 'pending_review') {
      return Response.json({ error: 'Primero envía el agente a revisión.' }, { status: 409 })
    }
    const cadence = normalizeCadence({ ...serialize(existing || {}), ...body.cadence })
    const campaignAction = ['save', 'request_review', 'approve', 'pause'].includes(action)
    const status = !campaignAction ? String(existing?.status || 'draft') : action === 'approve' ? 'approved'
      : action === 'request_review' ? 'pending_review'
        : action === 'pause' ? 'paused'
          : 'draft'
    const aiStatus = action === 'approve_ai' ? 'approved'
      : action === 'request_ai_review' ? 'pending_review'
        : action === 'pause_ai' ? 'paused'
          : String(existing?.ai_status || cadence.aiStatus || 'draft')
    const payload = {
      client_id: auth.clientId,
      name: 'Reactivación cenas',
      segment: body.segment || existing?.segment || 'inactive',
      template_key: 'amalay_cena_vino_375',
      status,
      timezone: cadence.timezone,
      send_days: cadence.sendDays,
      window_start: cadence.windowStart,
      window_end: cadence.windowEnd,
      daily_limit: cadence.dailyLimit,
      batch_size: cadence.batchSize,
      cooldown_days: cadence.cooldownDays,
      frequency_days: cadence.frequencyDays,
      minute_limit: cadence.minuteLimit,
      monthly_limit: cadence.monthlyLimit,
      ai_status: aiStatus,
      ai_mode: action === 'request_ai_review' || action === 'approve_ai' ? 'auto' : cadence.aiMode,
      ai_confidence_threshold: cadence.aiConfidenceThreshold,
      approved_at: action === 'approve' ? new Date().toISOString() : null,
      approved_by: action === 'approve' ? auth.staffId : null,
      updated_by: auth.staffId,
      updated_at: new Date().toISOString(),
    }
    const response = await fetch(`${SB_URL}/rest/v1/crm_whatsapp_automations?on_conflict=client_id,name`, {
      method: 'POST',
      headers: serviceHeaders('resolution=merge-duplicates,return=representation'),
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`automation_write_${response.status}`)
    const row = (await response.json())[0]
    return Response.json({ ...serialize(row), configured: true })
  } catch (error) {
    console.error('[WhatsApp automation write]', error)
    return Response.json({ error: 'No se pudo guardar la automatización.' }, { status: 502 })
  }
}
