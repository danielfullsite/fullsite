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
let _backoff        = INTERVAL_MS
let _lastSyncAt     = null

/**
 * @param {{ supabaseUrl: string, supabaseKey: string, serverId: string, restaurantId: string, version: string, protocolVersion: string, platform: string, getClientCount: () => number, getUnsyncedCount: () => Promise<number>, getPrintJobsFailed: () => number, getDiskFreeMb: () => number|null }} opts
 */
function start(opts) {
  const { supabaseUrl, supabaseKey } = opts
  if (!supabaseUrl || !supabaseKey) {
    console.log('[heartbeat] No Supabase credentials — fleet telemetry disabled')
    return
  }

  setTimeout(() => {
    _send(opts)
    _timer = setInterval(() => _send(opts), _backoff)
  }, INITIAL_DELAY_MS)

  console.log('[heartbeat] Fleet telemetry enabled (every 5min)')
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null }
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
      _applyBackoff()
    } else {
      _resetBackoff()
    }
  } catch (err) {
    // Heartbeat failure is always non-fatal
    if (err.name !== 'AbortError') {
      console.warn('[heartbeat] Send failed (non-fatal):', err.message)
    }
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

module.exports = { start, stop, recordSync }
