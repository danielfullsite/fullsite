// Contrato de eventos v2 — envelope compartido del Fullsite Factory.
//
// POR QUÉ
// Todo evento operativo debe portar tenant + location + device + shift, para que cualquier
// consumidor (KDS, offline, turnos, IQ, soporte) pueda aislar y correlacionar sin adivinar.
// La tabla `events` en origin/main ya trae `actor{userId,deviceId}`, `payload` y `audit`,
// pero NO `client_id`, `location` ni `shift` en el envelope. Este módulo define la forma v2
// y la valida; la migración que persiste esos campos en `events` va en un PR stacked aparte.
//
// Es un contrato PURO: sin red, sin base, sin dependencias nuevas. Versionado: si el envelope
// cambia, sube ENVELOPE_VERSION y se agrega un migrador, nunca se rompe el v2 existente.

export const ENVELOPE_VERSION = 2 as const

/** Quién originó el evento. deviceId es la identidad generada por la plataforma (PR #195). */
export interface EventActor {
  userId: string
  deviceId: string
}

/** El contexto que TODO evento operativo debe portar. Éste es el corazón del contrato. */
export interface EventScope {
  /** Tenant. Nunca vacío: sin tenant el evento no se puede aislar. */
  clientId: string
  /** Sucursal (client_locations.id) del mismo tenant. */
  locationId: string
  /** Turno operativo (pos_turnos.id). Correlaciona el evento con su corte. */
  shiftId: string
}

/** Auditoría para operaciones sensibles (cancelaciones, descuentos, retiros de caja). */
export interface EventAudit {
  approvedBy: string
  reason?: string
}

/** Tipos de evento que EXIGEN audit.approvedBy (espejo del CHECK sensitive_requires_audit). */
export const SENSITIVE_EVENT_TYPES = [
  'orders.item.cancelled.v1',
  'orders.discount.applied.v1',
  'payments.cash.withdrawn.v1',
  'inventory.waste.recorded.v1',
  'inventory.adjusted.v1',
] as const

export interface EventEnvelopeV2 {
  envelopeVersion: typeof ENVELOPE_VERSION
  /** id idempotente = command_id del terminal (dedupe en outbox y event store). */
  id: string
  type: string
  /** Versión del TIPO de evento (no del envelope). */
  typeVersion: number
  occurredAt: string
  actor: EventActor
  scope: EventScope
  payload: Record<string, unknown>
  audit?: EventAudit
}

export interface BuildInput {
  id: string
  type: string
  typeVersion?: number
  occurredAt: string
  actor: EventActor
  scope: EventScope
  payload?: Record<string, unknown>
  audit?: EventAudit
}

export class EnvelopeInvalido extends Error {}

const noVacio = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/**
 * Construye un envelope v2 validado. Falla cerrado: si falta tenant/location/device/shift/actor,
 * o si un evento sensible viene sin approbación, lanza en vez de emitir un evento incompleto.
 */
export function buildEnvelope(input: BuildInput): EventEnvelopeV2 {
  if (!noVacio(input.id)) throw new EnvelopeInvalido('id requerido')
  if (!noVacio(input.type)) throw new EnvelopeInvalido('type requerido')
  if (!noVacio(input.occurredAt)) throw new EnvelopeInvalido('occurredAt requerido')

  const a = input.actor
  if (!a || !noVacio(a.userId) || !noVacio(a.deviceId)) {
    throw new EnvelopeInvalido('actor.userId y actor.deviceId requeridos')
  }
  const s = input.scope
  if (!s || !noVacio(s.clientId) || !noVacio(s.locationId) || !noVacio(s.shiftId)) {
    throw new EnvelopeInvalido('scope.clientId, scope.locationId y scope.shiftId requeridos')
  }
  if (esSensible(input.type) && !(input.audit && noVacio(input.audit.approvedBy))) {
    throw new EnvelopeInvalido(`el evento sensible "${input.type}" requiere audit.approvedBy`)
  }

  return {
    envelopeVersion: ENVELOPE_VERSION,
    id: input.id,
    type: input.type,
    typeVersion: input.typeVersion ?? 1,
    occurredAt: input.occurredAt,
    actor: { userId: a.userId, deviceId: a.deviceId },
    scope: { clientId: s.clientId, locationId: s.locationId, shiftId: s.shiftId },
    payload: input.payload ?? {},
    ...(input.audit ? { audit: input.audit } : {}),
  }
}

export function esSensible(type: string): boolean {
  return (SENSITIVE_EVENT_TYPES as readonly string[]).includes(type)
}

/** true si un objeto cualquiera cumple el contrato v2. Útil para validar en la frontera. */
export function isEnvelopeV2(o: unknown): o is EventEnvelopeV2 {
  if (!o || typeof o !== 'object') return false
  const e = o as Record<string, unknown>
  if (e.envelopeVersion !== ENVELOPE_VERSION) return false
  const a = e.actor as EventActor | undefined
  const s = e.scope as EventScope | undefined
  if (!noVacio(e.id as string) || !noVacio(e.type as string) || !noVacio(e.occurredAt as string)) return false
  if (!a || !noVacio(a.userId) || !noVacio(a.deviceId)) return false
  if (!s || !noVacio(s.clientId) || !noVacio(s.locationId) || !noVacio(s.shiftId)) return false
  if (esSensible(e.type as string) && !((e.audit as EventAudit | undefined)?.approvedBy)) return false
  return true
}

/**
 * Proyecta el envelope v2 a la forma de fila de la tabla `events` de origin/main, para que la
 * migración que agregue las columnas escriba consistente. `actor` mantiene {userId, deviceId}
 * como hoy; tenant/location/shift salen a columnas dedicadas del envelope.
 */
export function toEventsRow(e: EventEnvelopeV2): {
  id: string; type: string; version: number; occurred_at: string
  actor: EventActor; payload: Record<string, unknown>; audit: EventAudit | null
  client_id: string; location_id: string; shift_id: string
} {
  return {
    id: e.id,
    type: e.type,
    version: e.typeVersion,
    occurred_at: e.occurredAt,
    actor: e.actor,
    payload: e.payload,
    audit: e.audit ?? null,
    client_id: e.scope.clientId,
    location_id: e.scope.locationId,
    shift_id: e.scope.shiftId,
  }
}
