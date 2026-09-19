export type WhatsAppAutomationStatus = 'draft' | 'pending_review' | 'approved' | 'paused'

export interface WhatsAppCadence {
  status: WhatsAppAutomationStatus
  timezone: string
  sendDays: number[]
  windowStart: string
  windowEnd: string
  dailyLimit: number
  batchSize: number
  cooldownDays: number
  frequencyDays: number
  minuteLimit: number
  monthlyLimit: number
  aiStatus: WhatsAppAutomationStatus
  aiMode: 'assist' | 'auto'
  aiConfidenceThreshold: number
}

export interface AutomationContact {
  id: number
  hasOptIn: boolean
  lastOutboundAt?: string | null
}

export const DEFAULT_WHATSAPP_CADENCE: WhatsAppCadence = {
  status: 'draft',
  timezone: 'America/Monterrey',
  sendDays: [2, 3, 4],
  windowStart: '11:00',
  windowEnd: '18:00',
  dailyLimit: 80,
  batchSize: 20,
  cooldownDays: 30,
  frequencyDays: 7,
  minuteLimit: 5,
  monthlyLimit: 1500,
  aiStatus: 'draft',
  aiMode: 'assist',
  aiConfidenceThreshold: 0.82,
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)))
}

function validTime(value: string, fallback: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
}

export function normalizeCadence(input: Partial<WhatsAppCadence>): WhatsAppCadence {
  const days = [...new Set((input.sendDays || DEFAULT_WHATSAPP_CADENCE.sendDays)
    .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
  return {
    status: ['draft', 'pending_review', 'approved', 'paused'].includes(String(input.status))
      ? input.status as WhatsAppAutomationStatus
      : DEFAULT_WHATSAPP_CADENCE.status,
    timezone: input.timezone || DEFAULT_WHATSAPP_CADENCE.timezone,
    sendDays: days.length ? days : DEFAULT_WHATSAPP_CADENCE.sendDays,
    windowStart: validTime(input.windowStart || '', DEFAULT_WHATSAPP_CADENCE.windowStart),
    windowEnd: validTime(input.windowEnd || '', DEFAULT_WHATSAPP_CADENCE.windowEnd),
    dailyLimit: clampInteger(input.dailyLimit ?? DEFAULT_WHATSAPP_CADENCE.dailyLimit, 1, 250),
    batchSize: clampInteger(input.batchSize ?? DEFAULT_WHATSAPP_CADENCE.batchSize, 1, 250),
    cooldownDays: clampInteger(input.cooldownDays ?? DEFAULT_WHATSAPP_CADENCE.cooldownDays, 1, 365),
    frequencyDays: clampInteger(input.frequencyDays ?? DEFAULT_WHATSAPP_CADENCE.frequencyDays, 1, 90),
    minuteLimit: clampInteger(input.minuteLimit ?? DEFAULT_WHATSAPP_CADENCE.minuteLimit, 1, 20),
    monthlyLimit: clampInteger(input.monthlyLimit ?? DEFAULT_WHATSAPP_CADENCE.monthlyLimit, 1, 5000),
    aiStatus: ['draft', 'pending_review', 'approved', 'paused'].includes(String(input.aiStatus))
      ? input.aiStatus as WhatsAppAutomationStatus : DEFAULT_WHATSAPP_CADENCE.aiStatus,
    aiMode: input.aiMode === 'auto' ? 'auto' : 'assist',
    aiConfidenceThreshold: Math.min(1, Math.max(0.5, Number(input.aiConfidenceThreshold) || DEFAULT_WHATSAPP_CADENCE.aiConfidenceThreshold)),
  }
}

function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { weekday: weekdays[value.weekday], minutes: Number(value.hour) * 60 + Number(value.minute) }
}

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function isInsideSendWindow(cadenceInput: Partial<WhatsAppCadence>, now = new Date()) {
  const cadence = normalizeCadence(cadenceInput)
  const local = localClock(now, cadence.timezone)
  if (!cadence.sendDays.includes(local.weekday)) return false
  const start = minutesOfDay(cadence.windowStart)
  const end = minutesOfDay(cadence.windowEnd)
  if (start === end) return false
  return start < end
    ? local.minutes >= start && local.minutes < end
    : local.minutes >= start || local.minutes < end
}

export function cadenceMeter(cadenceInput: Partial<WhatsAppCadence>, sentToday: number) {
  const cadence = normalizeCadence(cadenceInput)
  const used = Math.max(0, Math.floor(sentToday))
  const percent = Math.min(100, Math.round(used / cadence.dailyLimit * 100))
  const remaining = Math.max(0, cadence.dailyLimit - used)
  const start = minutesOfDay(cadence.windowStart)
  const end = minutesOfDay(cadence.windowEnd)
  const windowMinutes = start < end ? end - start : 1440 - start + end
  const spacingMinutes = Math.max(1, Math.floor(windowMinutes / cadence.dailyLimit))
  return {
    percent,
    remaining,
    spacingMinutes,
    level: percent >= 100 ? 'full' : percent >= 80 ? 'high' : percent >= 50 ? 'medium' : 'low' as const,
  }
}

export function mayRunAutomation(
  cadenceInput: Partial<WhatsAppCadence>,
  activity: { sentToday: number; lastRunAt?: string | null },
  now = new Date(),
) {
  const cadence = normalizeCadence(cadenceInput)
  if (cadence.status !== 'approved') return { allowed: false, reason: 'approval_required' as const }
  if (!isInsideSendWindow(cadence, now)) return { allowed: false, reason: 'quiet_hours' as const }
  if (activity.sentToday >= cadence.dailyLimit) return { allowed: false, reason: 'daily_limit' as const }
  if (activity.lastRunAt) {
    const elapsedDays = (now.getTime() - new Date(activity.lastRunAt).getTime()) / 86_400_000
    if (elapsedDays < cadence.frequencyDays) return { allowed: false, reason: 'frequency' as const }
  }
  return { allowed: true, reason: 'ready' as const }
}

export function planAutomationBatch(
  cadenceInput: Partial<WhatsAppCadence>,
  contacts: AutomationContact[],
  sentToday: number,
  now = new Date(),
) {
  const cadence = normalizeCadence(cadenceInput)
  const cutoff = now.getTime() - cadence.cooldownDays * 86_400_000
  const remaining = Math.max(0, cadence.dailyLimit - Math.max(0, sentToday))
  const limit = Math.min(cadence.batchSize, remaining)
  const eligible = contacts.filter(contact => {
    if (!contact.hasOptIn) return false
    if (!contact.lastOutboundAt) return true
    const sentAt = new Date(contact.lastOutboundAt).getTime()
    return Number.isFinite(sentAt) && sentAt <= cutoff
  })
  return {
    contactIds: eligible.slice(0, limit).map(contact => contact.id),
    eligibleCount: eligible.length,
    blockedByConsent: contacts.filter(contact => !contact.hasOptIn).length,
    blockedByCooldown: contacts.filter(contact => contact.hasOptIn && contact.lastOutboundAt && new Date(contact.lastOutboundAt).getTime() > cutoff).length,
    capacity: limit,
  }
}
