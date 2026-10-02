import { describe, expect, it } from 'vitest'
import { supervisarRespuestaChat } from '@/lib/chat-supervision'

const limpia = {
  authorizationVerified: true,
  numericClaims: 3,
  untracedNumericClaims: 0,
  numericClaimsMarked: 0,
  sourceReadFailed: false,
  toolQueryCount: 2,
  toolQueryErrorCount: 0,
  responseRepaired: false,
  responseAvailable: true,
}

describe('supervisor por interacción de chat', () => {
  it('marca como pass sólo respuestas autorizadas con evidencia completa', () => {
    expect(supervisarRespuestaChat(limpia)).toMatchObject({
      decision: 'pass',
      evidence_status: 'verified',
      flags: [],
    })
  })

  it('manda a revisión una cifra sin rastro, incluso si la respuesta se reparó', () => {
    expect(supervisarRespuestaChat({
      ...limpia,
      untracedNumericClaims: 1,
      responseRepaired: true,
    })).toMatchObject({
      decision: 'needs_review',
      flags: ['numeric_claims_untraced'],
    })
  })

  it('no permite entregar una respuesta sin autorización o sin registro disponible', () => {
    expect(supervisarRespuestaChat({ ...limpia, authorizationVerified: false })).toMatchObject({
      decision: 'blocked',
      flags: ['authorization_missing'],
    })
    expect(supervisarRespuestaChat({ ...limpia, responseAvailable: false })).toMatchObject({
      decision: 'blocked',
      flags: ['response_unavailable'],
    })
  })

  it('declara fuente fallida como cobertura no disponible, no como dato vacío', () => {
    expect(supervisarRespuestaChat({ ...limpia, sourceReadFailed: true })).toMatchObject({
      decision: 'needs_review',
      evidence_status: 'unavailable',
      flags: ['source_read_failed'],
    })
  })
})
