import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * OBSERVACIÓN DEL POS — no es un comando de negocio ni fuente de verdad.
 *
 * Existe para que F8/F9 del field cert se puedan mirar en software. Hasta hoy la
 * única forma de saber qué pasó durante un corte de WAN era preguntarle a quien
 * estaba parado frente a la caja.
 *
 * Por qué una ruta propia y no el proxy genérico: medido el 2026-09-19 contra
 * producción, una sesión POS (shift token, sin JWT de Supabase) que escribe por
 * `/rest/v1/...` termina en `/api/pos/db`, y ahí una tabla fuera de la lista
 * blanca devuelve `403 table not allowed`. Meter la telemetría a esa lista
 * abriría escritura genérica a una tabla más; esto no.
 *
 * EL INQUILINO NO VIENE DEL CUERPO. Sale de `withPOSAuth`, igual que en compras.
 * Aceptarlo del cliente —aunque coincida— enseña que el campo se manda, y el día
 * que alguien lo lea en vez de compararlo, el tenant vuelve a venir de afuera.
 *
 * NO se persiste el nombre de nadie. `actor` es `staffId`, que ya es estable y
 * no es una persona identificable en el texto. La tabla `events` sí guarda
 * nombres (`actor.userId = "Billy Newell"`) y, por su trigger de inmutabilidad,
 * eso no se puede borrar. Aquí no se repite.
 *
 * FALLAR AQUÍ NO PUEDE AFECTAR UNA VENTA. El cliente llama sin esperar la
 * respuesta; esta ruta nunca se mete en el camino de un comando.
 */

/** Los cuatro tipos del PR. La base también lo restringe con un CHECK. */
const TIPOS = new Set(['command_queued', 'reconnect_detected', 'queue_drain_started', 'queue_drain_completed'])

const MAX_EVENT_ID = 200
const MAX_PAYLOAD_BYTES = 4096
/** Un reloj de terminal puede ir adelantado; media hora es holgura, no licencia. */
const FUTURO_TOLERADO_MS = 30 * 60 * 1000

export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  // Cualquier rol del POS observa: un mesero encolando offline es justo lo que
  // hay que poder ver. No hay `isManager` aquí a propósito.

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  // El tenant tiene UNA fuente y no es el cuerpo.
  if ('client_id' in body) return Response.json({ error: 'CLIENT_ID_NOT_ACCEPTED' }, { status: 400 })

  const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : ''
  if (!eventId || eventId.length > MAX_EVENT_ID) {
    return Response.json({ error: 'INVALID_EVENT_ID' }, { status: 400 })
  }

  const eventType = typeof body.event_type === 'string' ? body.event_type : ''
  if (!TIPOS.has(eventType)) return Response.json({ error: 'INVALID_EVENT_TYPE' }, { status: 400 })

  const observadoEn = typeof body.observed_at === 'string' ? Date.parse(body.observed_at) : NaN
  if (!Number.isFinite(observadoEn)) return Response.json({ error: 'INVALID_OBSERVED_AT' }, { status: 400 })
  // Muy en el pasado SÍ se acepta: una racha offline de días llega tarde por
  // definición, y rechazarla borraría justo la evidencia que se quiere. En el
  // futuro no: un `observed_at` adelantado desordena la reconstrucción.
  if (observadoEn > Date.now() + FUTURO_TOLERADO_MS) {
    return Response.json({ error: 'OBSERVED_AT_IN_FUTURE' }, { status: 400 })
  }

  const payload = body.payload === undefined ? {} : body.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return Response.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
  }
  let payloadTexto: string
  try { payloadTexto = JSON.stringify(payload) } catch { return Response.json({ error: 'INVALID_PAYLOAD' }, { status: 400 }) }
  if (payloadTexto.length > MAX_PAYLOAD_BYTES) return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 400 })

  // IDENTIDAD DE TERMINAL: provisionada o nada.
  //
  // `pos_terminal_id` es ambiguo —Electron lo escribe desde `config.terminal_id`
  // y un navegador lo INVENTA en `pos-sessions.ts:23` (`term_<base36>_<random>`)—
  // así que no sirve como prueba de identidad. `FULLSITE_TERMINAL_ID` sólo lo
  // escribe la inyección de identidad del shell. Sin él, NULL: una terminal
  // desconocida se registra como desconocida, no con un id inventado.
  const terminalCrudo = body.terminal_id
  const terminalId = typeof terminalCrudo === 'string' && terminalCrudo.trim() && terminalCrudo.trim().length <= 120
    ? terminalCrudo.trim()
    : null

  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'TELEMETRY_UNAVAILABLE' }, { status: 503 })

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_telemetry?on_conflict=client_id,event_id`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        // Reenviar el mismo evento jamás lo duplica ni lo pisa: la PK es
        // (client_id, event_id) y aquí no se actualiza nada.
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        client_id: auth.clientId,
        event_id: eventId,
        terminal_id: terminalId,
        event_type: eventType,
        observed_at: new Date(observadoEn).toISOString(),
        // `actor` es el id estable de la sesión, NUNCA `staffName`.
        payload: { ...(payload as Record<string, unknown>), actor: auth.staffId, role: auth.role },
      }),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.warn(`[telemetry] insert HTTP ${res.status} ${detalle.slice(0, 120)}`)
      return Response.json({ error: 'TELEMETRY_UNCONFIRMED' }, { status: 503 })
    }
    return Response.json({ ok: true, terminal_identity_state: terminalId ? 'PROVISIONED' : 'UNKNOWN' },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'TELEMETRY_UNCONFIRMED' }, { status: 503 })
  }
}
