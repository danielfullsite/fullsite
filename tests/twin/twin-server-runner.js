'use strict'
// ─── Twin — Bridge Runner (child process entrypoint, --spawn mode) ────────────
// Boots the real local-server (electron-app/local-server/index.js) headless with
// an isolated data dir. Evolution of tests/soak/server-runner.js with:
//   • TWO printers: cocina (TCP) + barra (TCP). The barra device also carries the
//     'caja' station so receipts/cortes have a physical route (twin runs exactly
//     two printers, per the AMALAY rehearsal spec).
//   • Optional Supabase mock target (TWIN_SUPABASE_URL/KEY) → enables the real
//     startSupabasePoll() against the harness's staging mock. Only ever set for
//     the DEDICATED sync-scenario instance (STATE_SYNC clobbers local state).
//
// Env (set by twin-harness.js):
//   TWIN_DATA_DIR            — isolated data dir (events.ndjson etc.)
//   TWIN_PORT                — HTTP/WS port
//   TWIN_RESTAURANT_ID       — tenant id shared with simulated clients
//   TWIN_PRINTER_COCINA_PORT — TCP port of harness fake cocina printer
//   TWIN_PRINTER_BARRA_PORT  — TCP port of harness fake barra printer
//   TWIN_INSTANCE_NAME       — mDNS/instance label
//   TWIN_SUPABASE_URL        — (optional) staging mock base URL
//   TWIN_SUPABASE_KEY        — (optional) fake key for the mock

const path = require('path')

// Never let a real Supabase env leak into the twin.
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY

const dataDir      = process.env.TWIN_DATA_DIR
const port         = parseInt(process.env.TWIN_PORT || '17917', 10)
const cocinaPort   = parseInt(process.env.TWIN_PRINTER_COCINA_PORT || '19100', 10)
const barraPort    = parseInt(process.env.TWIN_PRINTER_BARRA_PORT || '19101', 10)
const restaurantId = process.env.TWIN_RESTAURANT_ID || 'amalay-twin-fallback'
const instanceName = process.env.TWIN_INSTANCE_NAME || 'Fullsite Twin Bridge'
const supabaseUrl  = process.env.TWIN_SUPABASE_URL || ''
const supabaseKey  = process.env.TWIN_SUPABASE_KEY || ''

if (!dataDir) {
  console.error('[twin-runner] TWIN_DATA_DIR is required')
  process.exit(1)
}

const { startLocalServer } = require(path.join(__dirname, '..', '..', 'electron-app', 'local-server', 'index.js'))

// Valid v2 printers config: two physical devices.
//   cocina device ← station 'cocina' (kitchen_ticket)
//   barra device  ← stations 'barra' + 'caja' (bar_ticket, receipt, corte…)
const printersConfig = {
  schema_version: 2,
  printers: [
    {
      printer_id:     'twin-imp-cocina',
      name:           'Twin Impresora Cocina',
      enabled:        true,
      connection:     { type: 'tcp', host: '127.0.0.1', port: cocinaPort },
      station_ids:    ['cocina'],
      document_types: ['kitchen_ticket', 'reprint'],
      copies:         1,
      encoding:       'cp850',
    },
    {
      printer_id:     'twin-imp-barra',
      name:           'Twin Impresora Barra',
      enabled:        true,
      connection:     { type: 'tcp', host: '127.0.0.1', port: barraPort },
      station_ids:    ['barra', 'caja'],
      document_types: ['bar_ticket', 'receipt', 'pre_ticket', 'corte', 'reprint'],
      copies:         1,
      encoding:       'cp850',
    },
  ],
}

startLocalServer({
  dataDir,
  port,
  config: {
    restaurantId,
    channel:           'development',
    instanceName,
    supabaseUrl,
    supabaseKey,
    printersConfig,
    printerConfigPath: path.join(dataDir, 'printers.json'),
    queueFilePath:     path.join(dataDir, 'print-queue.json'),
  },
})
  .then((handle) => {
    console.log('TWIN_BRIDGE_READY')
    // Graceful path: index.js close() doesn't clear every interval — exit explicitly.
    process.on('SIGTERM', () => { try { handle.close() } catch {}; process.exit(0) })
    process.on('SIGINT',  () => { try { handle.close() } catch {}; process.exit(0) })
  })
  .catch((e) => {
    console.error('[twin-runner] Failed to start bridge:', (e && e.stack) || e)
    process.exit(1)
  })
