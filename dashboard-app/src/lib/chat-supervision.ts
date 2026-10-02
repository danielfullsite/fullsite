/**
 * Supervisor estructurado del copiloto.
 *
 * No reinterpreta ni reescribe la conversación. Recibe señales verificables del camino
 * de respuesta y decide si el registro queda limpio o llega a revisión humana privada.
 * Es puro para que el criterio sea auditable antes de tocar datos reales.
 */

export type DecisionSupervision = 'pass' | 'needs_review' | 'blocked'
export type EstadoEvidenciaSupervision = 'verified' | 'needs_review' | 'unavailable'
export type BanderaSupervision =
  | 'authorization_missing'
  | 'numeric_claims_untraced'
  | 'numeric_claims_marked'
  | 'source_read_failed'
  | 'tool_query_failed'
  | 'response_unavailable'

export interface EntradaSupervisionChat {
  authorizationVerified: boolean
  numericClaims: number
  untracedNumericClaims: number
  numericClaimsMarked: number
  sourceReadFailed: boolean
  toolQueryCount: number
  toolQueryErrorCount: number
  responseRepaired: boolean
  responseAvailable: boolean
}

export interface ResultadoSupervisionChat {
  checker_version: 'chat-supervisor-v1'
  decision: DecisionSupervision
  evidence_status: EstadoEvidenciaSupervision
  flags: BanderaSupervision[]
  numeric_claims: number
  untraced_numeric_claims: number
  tool_query_count: number
  tool_query_error_count: number
  response_repaired: boolean
}

export function supervisarRespuestaChat(input: EntradaSupervisionChat): ResultadoSupervisionChat {
  const flags: BanderaSupervision[] = []
  if (!input.authorizationVerified) flags.push('authorization_missing')
  if (!input.responseAvailable) flags.push('response_unavailable')
  if (input.untracedNumericClaims > 0) flags.push('numeric_claims_untraced')
  if (input.numericClaimsMarked > 0) flags.push('numeric_claims_marked')
  if (input.sourceReadFailed) flags.push('source_read_failed')
  if (input.toolQueryErrorCount > 0) flags.push('tool_query_failed')

  const blocked = !input.authorizationVerified || !input.responseAvailable
  const evidenceNeedsReview = input.untracedNumericClaims > 0
    || input.numericClaimsMarked > 0
    || input.sourceReadFailed
    || input.toolQueryErrorCount > 0

  return {
    checker_version: 'chat-supervisor-v1',
    decision: blocked ? 'blocked' : evidenceNeedsReview ? 'needs_review' : 'pass',
    evidence_status: input.sourceReadFailed ? 'unavailable' : evidenceNeedsReview ? 'needs_review' : 'verified',
    flags,
    numeric_claims: input.numericClaims,
    untraced_numeric_claims: input.untracedNumericClaims,
    tool_query_count: input.toolQueryCount,
    tool_query_error_count: input.toolQueryErrorCount,
    response_repaired: input.responseRepaired,
  }
}
