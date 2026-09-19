// ── Fullsite OS — Shadow Mode ────────────────────────────────────────────────
// Emite eventos append-only a la tabla `events` de Supabase EN PARALELO a las
// escrituras actuales del POS. Reglas:
//
//   1. FIRE-AND-FORGET: jamás truena ni bloquea el camino crítico de venta.
//      Si Supabase está caído, la venta sigue; el evento se encola local.
//   2. Cola en localStorage: sobrevive recargas; se reenvía al reconectar.
//   3. Idempotente: INSERT con on_conflict=id + ignore-duplicates — reenviar
//      el mismo evento jamás lo duplica.
//   4. La tabla events es INMUTABLE a nivel Postgres (trigger + revoke):
//      nadie puede UPDATE/DELETE — ni un bug, ni un admin del POS.
//
// Vendored de fullsite-os (src/shared/publisher). Catálogo: fullsite-os/docs/EVENTS.md

const SUPABASE_URL = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL || '' : ''
const SUPABASE_KEY = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' : ''
const QUEUE_KEY = 'fullsite_event_queue'

export interface EventActor { userId: string; deviceId: string }

export interface EventAudit {
  requestedBy: string
  approvedBy: string
  reason: string
  before: unknown
  after: unknown
}

export interface EventEnvelope {
  id: string
  type: string
  version: number
  occurredAt: string
  actor: EventActor
  payload: Record<string, unknown>
  audit?: EventAudit
}

// deviceId persistente por terminal (POS-xxxx), generado una sola vez.
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'SERVER'
  try {
    let id = localStorage.getItem('fullsite_device_id')
    if (!id) {
      id = `POS-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      localStorage.setItem('fullsite_device_id', id)
    }
    return id
  } catch { return 'POS-UNKNOWN' }
}

function loadQueue(): EventEnvelope[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

const QUEUE_MAX = 1000 // tope de seguridad: ~semanas de operación offline

function saveQueue(queue: EventEnvelope[]): void {
  try {
    if (queue.length > QUEUE_MAX) {
      console.warn(`[shadow-mode] cola excede ${QUEUE_MAX}, descartando los más antiguos`)
      queue = queue.slice(queue.length - QUEUE_MAX)
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch { /* cola en memoria sigue */ }
}

let flushing = false

async function flushQueue(): Promise<void> {
  if (flushing || !SUPABASE_URL) return
  flushing = true
  try {
    let queue = loadQueue()
    while (queue.length > 0) {
      const event = queue[0]
      const ok = await sendEvent(event)
      if (!ok) return // sin red: se reintenta en el siguiente publish
      queue = loadQueue()
      queue.shift()
      saveQueue(queue)
    }
  } finally {
    flushing = false
  }
}

async function sendEvent(event: EventEnvelope): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        // supabase-fetch-patch intercambia este Bearer por el JWT del usuario
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        id: event.id,
        type: event.type,
        version: event.version,
        occurred_at: event.occurredAt,
        actor: event.actor,
        payload: event.payload,
        audit: event.audit ?? null,
      }),
    })
    if (res.ok || res.status === 409) return true
    console.warn(`[shadow-mode] events insert HTTP ${res.status}`, await res.text())
    // 401/403 = sesión sin login todavía (JWT pendiente): RETENER en cola,
    // se reenvía cuando el usuario entre. 5xx = server: reintentar.
    // Otros 4xx = evento inválido (p.ej. sensible sin audit): descartar con log.
    if (res.status === 401 || res.status === 403) return false
    return res.status >= 400 && res.status < 500
  } catch (err) {
    console.warn('[shadow-mode] offline, evento encolado', err)
    return false
  }
}

/**
 * Publica un evento Fullsite OS. Fire-and-forget: NUNCA truena, NUNCA
 * bloquea — seguro de llamar desde el camino crítico de venta.
 */
// Dedupe: React StrictMode (dev) ejecuta los state updaters dos veces, y un
// dedo tembloroso puede doble-tapear. Mismo type+payload en <1s = un solo evento.
let lastSignature = ''
let lastSignatureAt = 0

export function publishEvent(
  type: string,
  version: number,
  actor: EventActor,
  payload: Record<string, unknown>,
  audit?: EventAudit,
): void {
  try {
    const signature = `${type}:${JSON.stringify(payload)}`
    const now = Date.now()
    if (signature === lastSignature && now - lastSignatureAt < 1000) return
    lastSignature = signature
    lastSignatureAt = now
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type,
      version,
      occurredAt: new Date().toISOString(),
      actor,
      payload,
      ...(audit ? { audit } : {}),
    }
    const queue = loadQueue()
    queue.push(event)
    saveQueue(queue)
    void flushQueue().catch(() => { /* nunca propagar */ })
  } catch { /* shadow mode jamás afecta la venta */ }
}

// ─── TELEMETRÍA DE OBSERVACIÓN ───────────────────────────────────────────────
//
// Canal aparte del shadow mode de arriba, a propósito:
//
//   · va a `/api/pos/telemetry`, no a `/rest/v1/events`. Medido el 2026-09-19:
//     una sesión POS (shift token) que escribe a `/rest/v1/events` termina en
//     `/api/pos/db` y recibe `403 table not allowed: events`. Por eso `events`
//     no tiene una sola fila de AMALAY desde el 2026-08-25.
//   · cola propia (`fullsite_telemetry_queue`). La cola de telemetría y la de
//     negocio son conceptualmente distintas y no deben compartir estado.
//   · idempotencia por `event_id`, que en el servidor es parte de la PK
//     (client_id, event_id).
//
// NO ES FUENTE DE VERDAD. Si todo esto falla, la venta no se entera.

const TELEMETRY_QUEUE_KEY = 'fullsite_telemetry_queue'
const TELEMETRY_QUEUE_MAX = 500

export type TelemetryType = 'command_queued' | 'reconnect_detected' | 'queue_drain_started' | 'queue_drain_completed'

interface TelemetryEvent {
  event_id: string
  event_type: TelemetryType
  observed_at: string
  terminal_id: string | null
  payload: Record<string, unknown>
}

/**
 * Identidad PROVISIONADA de la terminal, o nada.
 *
 * Sólo `FULLSITE_TERMINAL_ID` sirve: lo escribe la inyección de identidad del
 * shell (`renderer-identity.js:22`, desde `config.terminal_id`). `pos_terminal_id`
 * NO sirve aunque exista, porque en un navegador lo fabrica `pos-sessions.ts:23`
 * (`term_<base36>_<random>`) y no hay forma de distinguir uno del otro al leerlo.
 * `fullsite_device_id` (`POS-XXXX`) tampoco: es `Math.random()`.
 *
 * Una terminal desconocida se registra como desconocida.
 */
export function getProvisionedTerminalId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const id = localStorage.getItem('FULLSITE_TERMINAL_ID')
    return id && id.trim() ? id.trim() : null
  } catch { return null }
}

function loadTelemetryQueue(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveTelemetryQueue(queue: TelemetryEvent[]): void {
  try {
    if (queue.length > TELEMETRY_QUEUE_MAX) queue = queue.slice(queue.length - TELEMETRY_QUEUE_MAX)
    localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(queue))
  } catch { /* sin localStorage la telemetría se pierde; la venta no */ }
}

let telemetryFlushing = false

async function sendTelemetry(ev: TelemetryEvent): Promise<boolean> {
  try {
    const res = await fetch('/api/pos/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    })
    // 2xx = guardado. 4xx = el evento es inválido y reintentarlo no lo arregla:
    // se descarta para que un solo evento malo no tape la cola para siempre —
    // que es exactamente lo que le pasa hoy al canal de `events` con su 403.
    if (res.ok) return true
    if (res.status >= 400 && res.status < 500) {
      console.warn(`[telemetria] evento descartado, HTTP ${res.status}`)
      return true
    }
    return false // 5xx / sin sesión todavía: conservar y reintentar
  } catch {
    return false // sin red: se reintenta al reconectar
  }
}

/** Drena la cola de telemetría. Nunca lanza. */
export async function flushTelemetry(): Promise<void> {
  if (telemetryFlushing || typeof window === 'undefined') return
  telemetryFlushing = true
  try {
    let queue = loadTelemetryQueue()
    while (queue.length > 0) {
      const ok = await sendTelemetry(queue[0])
      if (!ok) return
      queue = loadTelemetryQueue()
      queue.shift()
      saveTelemetryQueue(queue)
    }
  } catch { /* jamás propagar */ } finally {
    telemetryFlushing = false
  }
}

/**
 * Registra una observación. Fire-and-forget: NUNCA lanza, NUNCA bloquea.
 *
 * Es seguro llamarla desde `tx.oncomplete` de la cola offline y desde el
 * drenado: no espera respuesta y se traga cualquier error.
 */
export function publishTelemetry(
  eventType: TelemetryType,
  payload: Record<string, unknown> = {},
): void {
  try {
    if (typeof window === 'undefined') return
    const ev: TelemetryEvent = {
      event_id: crypto.randomUUID(),
      event_type: eventType,
      observed_at: new Date().toISOString(),
      terminal_id: getProvisionedTerminalId(),
      payload,
    }
    const queue = loadTelemetryQueue()
    queue.push(ev)
    saveTelemetryQueue(queue)
    void flushTelemetry()
  } catch { /* la observación jamás afecta lo observado */ }
}
