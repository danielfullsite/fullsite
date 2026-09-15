'use strict'
// ─── Fleet Heartbeat ─────────────────────────────────────────────────────────
// Sends telemetry to Supabase every 5 minutes.
// Non-blocking: a failed heartbeat is logged but never throws.
// Never sends operational data (orders, payments, names).
//
// Supabase table required (run once in SQL editor):
//   CREATE TABLE IF NOT EXISTS local_server_heartbeats (
//     server_id         TEXT PRIMARY KEY,
//     restaurant_id     TEXT NOT NULL,
//     reported_at       TIMESTAMPTZ NOT NULL,
//     version           TEXT,
//     protocol_version  TEXT,
//     platform          TEXT,
//     uptime_seconds    INTEGER,
//     clients_connected INTEGER,
//     sync_queue_size   INTEGER,
//     last_sync_at      TIMESTAMPTZ,
//     print_jobs_failed INTEGER,
//     health_status     TEXT,
//     disk_free_mb      INTEGER
//   );

const INTERVAL_MS      = 5 * 60 * 1000
const INITIAL_DELAY_MS = 30 * 1000   // wait 30s after startup before first heartbeat
const MAX_BACKOFF_MS   = 30 * 60 * 1000

let _timer          = null
let _primerEnvio    = null   // el setTimeout inicial; stop() tiene que poder cancelarlo
let _backoff        = INTERVAL_MS
let _lastSyncAt     = null

// ─── El estado se recuerda para poder PREGUNTARLE ───────────────────────────
//
// El warn de abajo ya decía exactamente qué faltaba. No sirvió de nada: vive en
// la consola de Electron, que nadie abre. Medido contra AMALAY el 2026-09-14:
//   select count(*) from local_server_heartbeats  ->  0   (cero desde que existe)
// y el config.json de una terminal provisionada no trae `supabaseAnonKey` ni
// `supabaseUrl` — la receta de clonado no los escribe.
//
// Una flota que no reporta se ve IDÉNTICA a una flota sana. Por eso el motivo se
// guarda aquí y `/health` lo publica: así el certificador, el panel de flota y
// cualquiera con el tubo pueden ver el apagón sin entrar a la máquina.
let _estado = { activa: false, motivo: 'sin arrancar', ultimoEnvio: null, ultimoError: null }

/** Estado de la telemetría, para que `/health` lo publique. Nunca incluye llaves. */
function estado() {
  return { ..._estado }
}

/**
 * @param {{ supabaseUrl: string, supabaseKey: string, serverId: string, restaurantId: string, version: string, protocolVersion: string, platform: string, getClientCount: () => number, getUnsyncedCount: () => Promise<number>, getPrintJobsFailed: () => number, getDiskFreeMb: () => number|null }} opts
 */
function start(opts) {
  const { supabaseUrl, supabaseKey } = opts
  if (!supabaseUrl || !supabaseKey) {
    // Apagarse en silencio es lo que hizo que esto llevara meses muerto sin que
    // nadie lo notara: una flota que no reporta se ve idéntica a una flota sana.
    // Decir EXACTAMENTE qué falta y qué se pierde, en warn, no en log.
    const faltan = [
      !supabaseUrl ? 'supabaseUrl' : null,
      !supabaseKey ? 'supabaseAnonKey' : null,
    ].filter(Boolean).join(' y ')
    console.warn(
      `[heartbeat] TELEMETRIA DE FLOTA APAGADA — falta ${faltan} en config.json ` +
      `(o SUPABASE_URL / SUPABASE_ANON_KEY en el entorno). Esta terminal NO va a ` +
      `reportar cola de sync, fallas de impresion, version ni disco. Diagnostico ` +
      `remoto imposible: hay que venir fisicamente.`
    )
    _estado = { activa: false, motivo: `falta ${faltan}`, ultimoEnvio: null, ultimoError: null }
    return
  }

  _primerEnvio = setTimeout(() => {
    _primerEnvio = null
    _send(opts)
    _timer = setInterval(() => _send(opts), _backoff)
  }, INITIAL_DELAY_MS)

  _estado = { activa: true, motivo: null, ultimoEnvio: null, ultimoError: null }
  console.log('[heartbeat] Fleet telemetry enabled (every 5min)')
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null }
  // El primer envío vive en un setTimeout de 30 s aparte del intervalo. Sin
  // cancelarlo, una telemetría "detenida" todavía mandaba una fila medio minuto
  // después — y dejaba el proceso vivo, que es como se descubrió: colgó su
  // propia prueba.
  if (_primerEnvio) { clearTimeout(_primerEnvio); _primerEnvio = null }
  _estado = { ..._estado, activa: false, motivo: 'detenida' }
}

function recordSync() {
  _lastSyncAt = new Date().toISOString()
}

async function _send(opts) {
  const { supabaseUrl, supabaseKey, serverId, restaurantId, version, protocolVersion, platform,
          getClientCount, getUnsyncedCount, getPrintJobsFailed, getDiskFreeMb } = opts

  let unsyncedCount = 0
  try { unsyncedCount = await getUnsyncedCount() } catch {}

  const diskFree = getDiskFreeMb ? getDiskFreeMb() : null

  const payload = {
    server_id:         serverId,
    restaurant_id:     restaurantId,
    reported_at:       new Date().toISOString(),
    version,
    protocol_version:  protocolVersion,
    platform,
    uptime_seconds:    Math.floor(process.uptime()),
    clients_connected: getClientCount(),
    sync_queue_size:   unsyncedCount,
    last_sync_at:      _lastSyncAt,
    print_jobs_failed: getPrintJobsFailed(),
    health_status:     unsyncedCount > 100 ? 'degraded' : 'ok',
    disk_free_mb:      diskFree,
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(
      `${supabaseUrl}/rest/v1/local_server_heartbeats`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer':        'resolution=merge-duplicates',
        },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      }
    ).finally(() => clearTimeout(timeout))

    if (!res.ok) {
      console.warn(`[heartbeat] ${res.status} — backing off`)
      _estado = { ..._estado, ultimoError: `HTTP ${res.status}` }
      _applyBackoff()
    } else {
      // Un 2xx es la ÚNICA prueba de que la fila llegó. Sin esta marca, «activa»
      // sólo diría que arrancó, que es lo que ya creíamos cuando había 0 filas.
      _estado = { ..._estado, ultimoEnvio: new Date().toISOString(), ultimoError: null }
      _resetBackoff()
    }
  } catch (err) {
    // Heartbeat failure is always non-fatal
    if (err.name !== 'AbortError') {
      console.warn('[heartbeat] Send failed (non-fatal):', err.message)
    }
    _estado = { ..._estado, ultimoError: String(err.message || err).slice(0, 120) }
    _applyBackoff()
  }
}

function _applyBackoff() {
  _backoff = Math.min(_backoff * 2, MAX_BACKOFF_MS)
  if (_timer) { clearInterval(_timer); _timer = null }
}

function _resetBackoff() {
  if (_backoff !== INTERVAL_MS) {
    _backoff = INTERVAL_MS
  }
}

module.exports = { start, stop, recordSync, estado }
