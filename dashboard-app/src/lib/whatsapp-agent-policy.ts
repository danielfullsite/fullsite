export type WhatsAppAgentAction = 'reply' | 'handoff' | 'ignore'
export type WhatsAppIntent = 'reservation' | 'menu_hours' | 'promotion' | 'opt_out' | 'complaint' | 'other'

export const WHATSAPP_HARD_LIMITS = {
  dailyMax: 250,
  monthlyMax: 5000,
  minuteMax: 20,
  replyMaxChars: 900,
  historyMaxMessages: 12,
} as const

const OPT_OUT = /^(alto|baja|cancelar|cancelame|cancélame|no\s+(?:quiero(?:\s+mensajes)?|me\s+escriban|mensajes)|stop|unsubscribe|salir)$/iu
const HUMAN_REQUIRED = /(alerg|intoleran|emergenc|reembolso|cobro|fraude|tarjeta|contraseñ|demanda|abogado|amenaza|insulto|gerente|encargado|humano|persona)/iu

export function normalizeWhatsAppAddress(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

export function isOptOutMessage(value: string) {
  return OPT_OUT.test(value.trim())
}

export function requiresHumanReview(value: string) {
  return HUMAN_REQUIRED.test(value)
}

export function sanitizeAgentReply(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WHATSAPP_HARD_LIMITS.replyMaxChars)
}

export function clampOperationalLimits(input: { minute?: number; daily?: number; monthly?: number }) {
  const integer = (value: number | undefined, fallback: number, max: number) =>
    Math.min(max, Math.max(1, Math.floor(Number(value) || fallback)))
  return {
    minute: integer(input.minute, 5, WHATSAPP_HARD_LIMITS.minuteMax),
    daily: integer(input.daily, 80, WHATSAPP_HARD_LIMITS.dailyMax),
    monthly: integer(input.monthly, 1500, WHATSAPP_HARD_LIMITS.monthlyMax),
  }
}

export function mayAutoReply(input: {
  enabled: boolean
  approved: boolean
  confidence: number
  threshold: number
  message: string
}) {
  if (!input.enabled) return { allowed: false, reason: 'disabled' as const }
  if (!input.approved) return { allowed: false, reason: 'approval_required' as const }
  if (isOptOutMessage(input.message)) return { allowed: false, reason: 'opt_out' as const }
  if (requiresHumanReview(input.message)) return { allowed: false, reason: 'human_required' as const }
  if (input.confidence < input.threshold) return { allowed: false, reason: 'low_confidence' as const }
  return { allowed: true, reason: 'ready' as const }
}

export function shouldOpenCircuitBreaker(failed: number, total: number) {
  return total > 0 && failed >= 5 && failed / total >= 0.2
}
