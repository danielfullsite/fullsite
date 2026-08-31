/**
 * Agent Engine — server-side only.
 * Runs agents, stores events in agent_events table, returns results.
 */
import type { AgentId, AgentEvent, AgentResult } from './types'
import { runOperationsAgent } from './operations'
import { runInventoryAgent } from './inventory'
import { runFraudAgent } from './fraud'
import { runStaffAgent } from './staff'
import { runFinanceAgent } from './finance'
import { esDuenoDelHistoricoWansoft } from '@/lib/wansoft-legacy'
import { applyLearning, tallyVerdicts, verdictsQuery } from './learning'

const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function sbGet<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  const url = `${SB_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbGet ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T[]>
}

export async function sbInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const url = `${SB_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbInsert ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
}

export async function sbPatch(table: string, query: string, data: Record<string, unknown>): Promise<void> {
  const url = `${SB_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbPatch ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
}

/** Run a single agent, store its events, return the result. */
/**
 * Deja constancia de la corrida en `agent_runs`.
 *
 * POR QUÉ EXISTE
 * --------------
 * Hasta el 2026-08-30 los cinco agentes del dashboard NO escribían aquí. Los de Python sí
 * (lab-simulator, intraday-sales, fraud-watcher… cientos de corridas), y por eso de ésos se
 * sabe si viven. De éstos no: `agent_events` vacío podía significar "corrió y no halló nada"
 * o "nunca corrió", y no había forma de distinguirlo. Resultó ser lo segundo — nada los
 * disparaba — y nadie lo notó en nueve días.
 *
 * Un agente que no deja rastro de haber corrido es indistinguible de uno que no existe.
 *
 * `skip_reason` y `data_status` ya estaban en el esquema de `agent_runs` precisamente para
 * esto; sólo faltaba escribirlos.
 *
 * NO BLOQUEA. Si el registro falla, el agente ya hizo su trabajo: perder la bitácora es malo,
 * perder el hallazgo es peor.
 */
async function logAgentRun(params: {
  agentId: AgentId
  clientId: string
  triggerType: string
  status: 'ok' | 'error' | 'skipped'
  durationMs: number
  eventsCount: number
  skipReason?: string | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    await sbInsert('agent_runs', {
      // Prefijo `dashboard:` para no confundirlos con los agentes de Python, que usan
      // nombres sueltos como 'fraud-watcher'. Sin él, 'fraud' y 'fraud-watcher' se leen
      // como el mismo agente en cualquier consulta agregada.
      agent_id: `dashboard:${params.agentId}`,
      trigger_type: params.triggerType,
      status: params.status,
      duration_ms: params.durationMs,
      rows_processed: params.eventsCount,
      skip_reason: params.skipReason ?? null,
      error_message: params.errorMessage ?? null,
      data_status: params.status === 'error' ? 'error' : 'ok',
      output_summary: `${params.clientId}: ${params.eventsCount} hallazgo(s)`,
    })
  } catch {
    /* No bloquea: el hallazgo ya se guardó. */
  }
}

export async function runAgent(
  agentId: AgentId,
  clientId: string,
  triggerType = 'manual',
): Promise<AgentResult> {
  const start = Date.now()
  let events: AgentEvent[] = []
  let error: string | undefined
  let learningSummary: { downgraded: number; suppressed: string[] } = { downgraded: 0, suppressed: [] }

  // El guardian de las tablas legacy vivia solo en runAllAgents, y eso dejaba
  // una puerta: /api/agents/run acepta agent_id del cuerpo y llama aqui DIRECTO.
  // Un usuario de otro restaurante pedia { agent_id: 'finance' } y recibia
  // analisis calculados con las ventas de AMALAY, guardados como eventos suyos.
  // No era solo una fuga: era informacion equivocada presentada como propia.
  //
  // El guardian se mueve a donde esta el peligro — la funcion que corre el
  // agente — en vez de a la funcion que casualmente lo llamaba.
  //
  // La pregunta dejó de ser "¿eres amalay?" y pasó a ser "¿eres dueño del histórico
  // de Wansoft?" (clients.wansoft_subsidiary_id). Misma protección, pero configurable:
  // un restaurante que migre desde Wansoft mañana tiene su agente de finanzas sin
  // tocar código. `esDuenoDelHistoricoWansoft` falla CERRADO — si la consulta truena,
  // devuelve false y el agente no corre.
  if (agentId === 'finance' && !(await esDuenoDelHistoricoWansoft(clientId))) {
    const durationMs = Date.now() - start
    // Se registra como 'skipped', no 'error': no falló nada, este restaurante simplemente
    // no es dueño del histórico. Contarlo como error dispararía alertas todos los días.
    await logAgentRun({
      agentId, clientId, triggerType, status: 'skipped', durationMs, eventsCount: 0,
      skipReason: 'no es dueño del histórico de Wansoft',
    })
    return {
      agent_id: agentId,
      events: [],
      ran_at: new Date().toISOString(),
      duration_ms: durationMs,
      error: 'finance no disponible para este restaurante',
    }
  }

  try {
    switch (agentId) {
      case 'operations': events = await runOperationsAgent(clientId, sbGet); break
      case 'inventory':  events = await runInventoryAgent(clientId, sbGet);  break
      case 'fraud':      events = await runFraudAgent(clientId, sbGet);      break
      case 'staff':      events = await runStaffAgent(clientId, sbGet);      break
      case 'finance':    events = await runFinanceAgent(clientId, sbGet);    break
    }

    // Manda el `expires_at` que declaró el agente; 6h es sólo el respaldo.
    //
    // Antes se cerraba TODO a las 6 horas, ignorando lo que cada hallazgo decía de sí
    // mismo. Medido el 2026-08-31 sobre los 18 `expires_at` del código, el TTL fijo estaba
    // mal en las dos direcciones:
    //
    //   · 8 de 18 declaran 8h, 12h, 24h o 48h  → se cerraban ANTES de tiempo, y el agente
    //     los volvía a emitir en la siguiente corrida. De ahí las 4 copias de
    //     `fuente_sin_datos` en 12 horas.
    //   · Una mesa esperando cobro declara 45 min → seguía marcada como pendiente 6 horas
    //     después, cuando hacía rato que se había cobrado. Alerta vieja que ya no es cierta.
    //
    // Quien emite el hallazgo sabe cuánto vale: un stock crítico dura la jornada, una mesa
    // sin cobrar dura minutos. El engine no tiene por qué opinar sobre eso.
    const expireCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const ahoraIso = new Date().toISOString()
    await sbPatch(
      'agent_events',
      `client_id=eq.${encodeURIComponent(clientId)}&agent_id=eq.${agentId}&status=eq.new` +
        `&or=(expires_at.lt.${ahoraIso},and(expires_at.is.null,created_at.lt.${expireCutoff}))`,
      { status: 'resolved' },
    ).catch(() => {/* Non-blocking */})

    // Deduplicate: if same type+severity event exists as 'new' in last 30min, skip insert
    // El dedupe pregunta si el hallazgo SIGUE VIGENTE, no si es reciente.
    //
    // Antes comparaba sólo contra los últimos 30 minutos. Con el cron corriendo cada 30
    // min eso produce una copia por corrida de todo lo que dure más que la ventana:
    // medido el 2026-08-31, `fuente_sin_datos` ya llevaba 4 copias en 12 horas, y con el
    // cron completo serían ~34 al día del MISMO aviso. Un tablero con 34 veces la misma
    // alerta se ignora entero, y entonces las de verdad tampoco se ven.
    //
    // La pregunta correcta es otra: si ya hay un hallazgo `new` de este tipo que todavía
    // no expira, el estado no cambió y no hace falta repetirlo. Se respeta `expires_at`,
    // que es donde cada agente declara cuánto vale su afirmación — un stock crítico dura
    // 8 horas, una mesa esperando cobro dura minutos.
    //
    // Los que no traen `expires_at` conservan la ventana de 30 minutos de antes, así que
    // para ellos no cambia nada.
    const dedupeWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const ahora = new Date().toISOString()
    const existingRaw = await sbGet<{ type: string; severity: string; expires_at: string | null; created_at: string }>(
      'agent_events',
      `client_id=eq.${encodeURIComponent(clientId)}&agent_id=eq.${agentId}&status=eq.new` +
        `&or=(expires_at.gte.${ahora},created_at.gte.${dedupeWindow})&select=type,severity,expires_at,created_at`,
    ).catch(() => [] as { type: string; severity: string; expires_at: string | null; created_at: string }[])
    const existingTypes = new Set(existingRaw.map(r => `${r.type}:${r.severity}`))

    // ── Aprendizaje: el veredicto humano pondera el hallazgo ──────────────────
    //
    // Se aplica aquí, en el engine, y no dentro de cada agente: así los cinco aprenden sin
    // tocar su lógica, y un agente nuevo lo hereda el día que se escriba.
    //
    // La cuenta es `confianza × precisión histórica de ese type en ESTE restaurante`. Un
    // tipo que aquí siempre resultó cierto no se toca; uno que falla seguido se hunde solo.
    // No suprime salvo el caso extremo — degradar y explicar es preferible a callar, que es
    // el error que costó nueve días de agentes muertos sin que nadie lo viera.
    //
    // Falla ABIERTO a propósito: si no se puede leer el historial, los hallazgos pasan sin
    // ponderar. Perder la ponderación es un ajuste fino; perder el hallazgo es perder el
    // aviso de que se están robando el efectivo.
    const verdictRows = await sbGet<{ type: string; outcome: string | null }>(
      'agent_events',
      verdictsQuery(clientId, agentId),
    ).catch(() => [] as { type: string; outcome: string | null }[])

    const learned = applyLearning(events, tallyVerdicts(verdictRows))
    learningSummary = { downgraded: learned.downgraded, suppressed: learned.suppressed }
    events = learned.events

    // Insert new events
    const toInsert = events.filter(e => !existingTypes.has(`${e.type}:${e.severity}`))
    await Promise.allSettled(
      toInsert.map(event =>
        sbInsert('agent_events', {
          client_id: event.client_id,
          agent_id: event.agent_id,
          type: event.type,
          severity: event.severity,
          title: event.title,
          explanation: event.explanation,
          evidence: event.evidence,
          suggested_action: event.suggested_action,
          confidence: event.confidence,
          status: 'new',
          estimated_value: event.estimated_value ?? null,
          expires_at: event.expires_at ?? null,
        }),
      ),
    )
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const durationMs = Date.now() - start

  // El caso que motivó todo esto: el agente corrió, no falló, y no emitió nada. Sin
  // `skip_reason` eso queda como una fila igual a "todo bien", que es justo la ambigüedad
  // que hizo que nadie notara nueve días de agentes muertos.
  // El aprendizaje queda en la bitácora. Suprimir en silencio sería el mismo pecado que
  // veníamos arreglando: si alguien pregunta "¿por qué dejó de avisarme de esto?", la
  // respuesta tiene que estar en una fila, no en el código.
  const notaAprendizaje =
    learningSummary.suppressed.length > 0
      ? `suprimidos por historial: ${learningSummary.suppressed.join(', ')}`
      : learningSummary.downgraded > 0
        ? `${learningSummary.downgraded} hallazgo(s) con confianza ajustada por historial`
        : null

  await logAgentRun({
    agentId, clientId, triggerType,
    status: error ? 'error' : 'ok',
    durationMs,
    eventsCount: events.length,
    skipReason: error
      ? null
      : events.length === 0
        ? ['corrió sin hallazgos', notaAprendizaje].filter(Boolean).join(' — ')
        : notaAprendizaje,
    errorMessage: error ?? null,
  })

  return {
    agent_id: agentId,
    events,
    ran_at: new Date().toISOString(),
    duration_ms: durationMs,
    error,
  }
}

/**
 * Tenant dueño de las tablas legacy globales (wansoft_daily / wansoft_kpis).
 * Esas tablas no tienen client_id, así que el finance agent solo puede correr
 * para este tenant — de lo contrario expondría sus ventas a otros clientes.
 *
 * El guardián REAL vive en `runAgent`, que es la función que corre el agente.
 * El de aquí abajo se conserva por defensa en profundidad: evita intentarlo y
 * recibir un resultado con error. Hasta el 2026-08-26 sólo existía éste, y
 * `/api/agents/run` lo saltaba llamando a `runAgent` directo con el `agent_id`
 * del cuerpo de la petición.
 */
/** Run all agents concurrently (finance solo para el dueño del histórico de Wansoft). */
export async function runAllAgents(clientId: string, triggerType = 'manual'): Promise<AgentResult[]> {
  const agentIds: AgentId[] = ['operations', 'inventory', 'fraud', 'staff']
  // Antes: `clientId === 'amalay'`. Ahora se pregunta por la propiedad, no por el
  // nombre — así el día que otro restaurante migre desde Wansoft, su agente de
  // finanzas corre sin tocar código. Ver src/lib/wansoft-legacy.ts.
  if (await esDuenoDelHistoricoWansoft(clientId)) agentIds.push('finance')
  return Promise.all(agentIds.map(id => runAgent(id, clientId, triggerType)))
}

/** Fetch latest events for display. */
export async function fetchEvents(
  clientId: string,
  opts: { status?: string; limit?: number; agentId?: AgentId } = {},
): Promise<AgentEvent[]> {
  const status = opts.status ?? 'new'
  const limit = opts.limit ?? 50
  let query = `client_id=eq.${encodeURIComponent(clientId)}&status=eq.${status}&order=created_at.desc&limit=${limit}&select=*`
  if (opts.agentId) query += `&agent_id=eq.${opts.agentId}`
  return sbGet<AgentEvent>('agent_events', query)
}
