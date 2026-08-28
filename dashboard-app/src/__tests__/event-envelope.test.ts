// Contrato de eventos v2: todo evento porta tenant+location+device+shift, y falla cerrado.
// Autocontenido: sin red ni base.
import { describe, it, expect } from 'vitest'
import {
  buildEnvelope, isEnvelopeV2, toEventsRow, esSensible, EnvelopeInvalido,
  ENVELOPE_VERSION,
} from '../lib/events/envelope'

const base = {
  id: 'cmd-1', type: 'orders.item.added.v1', occurredAt: '2026-08-27T12:00:00Z',
  actor: { userId: 'u1', deviceId: 'dev-1' },
  scope: { clientId: 'diezmex-demo', locationId: 'diezmex-rosta', shiftId: 'turno-1' },
  payload: { itemId: 'x' },
}

describe('buildEnvelope — porta tenant+location+device+shift', () => {
  it('construye un envelope v2 completo', () => {
    const e = buildEnvelope(base)
    expect(e.envelopeVersion).toBe(ENVELOPE_VERSION)
    expect(e.scope).toEqual({ clientId: 'diezmex-demo', locationId: 'diezmex-rosta', shiftId: 'turno-1' })
    expect(e.actor.deviceId).toBe('dev-1')
  })

  it.each(['clientId', 'locationId', 'shiftId'] as const)('falla cerrado sin scope.%s', (k) => {
    const scope = { ...base.scope, [k]: '' }
    expect(() => buildEnvelope({ ...base, scope })).toThrow(EnvelopeInvalido)
  })

  it('falla cerrado sin actor.deviceId (la identidad la da la plataforma)', () => {
    expect(() => buildEnvelope({ ...base, actor: { userId: 'u1', deviceId: '' } })).toThrow(EnvelopeInvalido)
  })

  it('un evento sensible sin audit.approvedBy falla cerrado', () => {
    expect(() => buildEnvelope({ ...base, type: 'orders.discount.applied.v1' })).toThrow(/approvedBy/)
  })

  it('un evento sensible CON audit.approvedBy pasa', () => {
    const e = buildEnvelope({ ...base, type: 'orders.discount.applied.v1', audit: { approvedBy: 'gerente-1' } })
    expect(e.audit?.approvedBy).toBe('gerente-1')
  })
})

describe('esSensible — espejo del CHECK de la tabla events', () => {
  it('marca los tipos sensibles', () => {
    expect(esSensible('payments.cash.withdrawn.v1')).toBe(true)
    expect(esSensible('orders.item.added.v1')).toBe(false)
  })
})

describe('isEnvelopeV2 — validación en la frontera', () => {
  it('acepta un envelope válido y rechaza basura', () => {
    expect(isEnvelopeV2(buildEnvelope(base))).toBe(true)
    expect(isEnvelopeV2({})).toBe(false)
    expect(isEnvelopeV2({ ...buildEnvelope(base), envelopeVersion: 1 })).toBe(false)
    expect(isEnvelopeV2({ ...buildEnvelope(base), scope: { clientId: 'a', locationId: '', shiftId: 'b' } })).toBe(false)
  })
})

describe('toEventsRow — proyección consistente con la tabla events', () => {
  it('saca tenant/location/shift a columnas dedicadas y conserva actor', () => {
    const row = toEventsRow(buildEnvelope(base))
    expect(row.client_id).toBe('diezmex-demo')
    expect(row.location_id).toBe('diezmex-rosta')
    expect(row.shift_id).toBe('turno-1')
    expect(row.actor).toEqual({ userId: 'u1', deviceId: 'dev-1' })
    expect(row.version).toBe(1)
    expect(row.audit).toBeNull()
  })
})
