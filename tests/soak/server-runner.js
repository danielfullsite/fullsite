'use strict'
// ─── Soak Test — Server Runner (child process entrypoint) ────────────────────
// Boots the real local-server (electron-app/local-server/index.js) headless with
// an isolated data dir + non-default port so the soak harness can SIGKILL /
// SIGTERM / respawn it at will.
//
// Configuration comes from env (set by soak-harness.js):
//   SOAK_DATA_DIR       — isolated temp data dir (events.ndjson etc. live here)
//   SOAK_PORT           — HTTP/WS port (non-default, e.g. 17817)
//   SOAK_PRINTER_PORT   — TCP port of the fake ESC/POS printer run by the harness
//   SOAK_RESTAURANT_ID  — restaurant identity shared with the simulated clients

const path = require('path')

// Make absolutely sure no real Supabase traffic happens (disables the Supabase
// poll loop + fleet heartbeat inside the server).
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY

const dataDir      = process.env.SOAK_DATA_DIR
const port         = parseInt(process.env.SOAK_PORT || '17817', 10)
const printerPort  = parseInt(process.env.SOAK_PRINTER_PORT || '17919', 10)
const restaurantId = process.env.SOAK_RESTAURANT_ID || 'soak-restaurant'

if (!dataDir) {
  console.error('[soak-runner] SOAK_DATA_DIR is required')
  process.exit(1)
}

const { startLocalServer } = require(path.join(__dirname, '..', '..', 'electron-app', 'local-server', 'index.js'))

// Valid v2 printers config pointing at the harness's fake TCP printer.
// One printer serving both stations we print to (cocina comandas, caja receipts).
const printersConfig = {
  schema_version: 2,
  printers: [
    {
      printer_id:     'soak-fake-printer',
      name:           'Soak Fake Printer',
      enabled:        true,
      connection:     { type: 'tcp', host: '127.0.0.1', port: printerPort },
      station_ids:    ['cocina', 'caja'],
      document_types: ['kitchen_ticket', 'receipt'],
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
    instanceName:      'Fullsite Soak Server',
    supabaseUrl:       '',
    supabaseKey:       '',
    printersConfig,
    printerConfigPath: path.join(dataDir, 'printers.json'),
    queueFilePath:     path.join(dataDir, 'print-queue.json'),
  },
})
  .then((handle) => {
    console.log('SOAK_SERVER_READY')

    // Graceful restart path: harness sends SIGTERM. index.js's close() does not
    // clear every interval (lock GC, print recovery), so exit explicitly.
    process.on('SIGTERM', () => {
      try { handle.close() } catch {}
      process.exit(0)
    })
    process.on('SIGINT', () => {
      try { handle.close() } catch {}
      process.exit(0)
    })
  })
  .catch((e) => {
    console.error('[soak-runner] Failed to start local server:', e && e.stack || e)
    process.exit(1)
  })
