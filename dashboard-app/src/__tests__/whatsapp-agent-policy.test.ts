import { describe, expect, it } from 'vitest'
import {
  clampOperationalLimits, isOptOutMessage, mayAutoReply,
  normalizeWhatsAppAddress, requiresHumanReview, sanitizeAgentReply,
  shouldOpenCircuitBreaker,
} from '@/lib/whatsapp-agent-policy'

describe('WhatsApp agent safety policy', () => {
  it('normalizes provider addresses', () => expect(normalizeWhatsAppAddress('whatsapp:+52 (81) 1234-5678')).toBe('+528112345678'))
  it.each(['BAJA', 'stop', 'No quiero mensajes', 'cancelame'])('detects opt out: %s', value => expect(isOptOutMessage(value)).toBe(true))
  it.each(['Tengo una alergia', 'quiero hablar con un humano', 'me hicieron un cobro'])('requires a human: %s', value => expect(requiresHumanReview(value)).toBe(true))
  it('clamps operator limits below hard ceilings', () => expect(clampOperationalLimits({ minute: 999, daily: 999, monthly: 99999 })).toEqual({ minute: 20, daily: 250, monthly: 5000 }))
  it('blocks an unapproved agent', () => expect(mayAutoReply({ enabled: true, approved: false, confidence: 1, threshold: .8, message: 'Hola' }).reason).toBe('approval_required'))
  it('blocks low confidence', () => expect(mayAutoReply({ enabled: true, approved: true, confidence: .5, threshold: .8, message: 'Hola' }).reason).toBe('low_confidence'))
  it('sanitizes and limits replies', () => expect(sanitizeAgentReply(`Hola\n${'a'.repeat(1000)}`).length).toBeLessThanOrEqual(900))
  it('opens the circuit breaker only after enough failures', () => {
    expect(shouldOpenCircuitBreaker(4, 10)).toBe(false)
    expect(shouldOpenCircuitBreaker(5, 25)).toBe(true)
  })
})
