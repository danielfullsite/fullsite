'use strict'
// ─── Upgrade Rehearsal — Bridge Runner (child process entrypoint) ─────────────
// Boots the local-server EXTRACTED FROM THE INSTALLED app.asar (not the repo
// checkout) so every phase exercises the exact bytes the installer shipped.
// Same interface at 1.3.0 (23d7eaf) and 1.3.3 (21f6b87): startLocalServer
// accepts { dataDir, port, config: { restaurantId, printersConfig,
// printerConfigPath, queueFilePath, ... } } in both versions.
//
// Env (set by driver.js):
//   UR_BRIDGE_INDEX  — <extracted-asar>/local-server/index.js   (required)
//   UR_DATA_DIR      — %APPDATA%\Fullsite POS                   (required)
//   UR_PORT          — HTTP/WS port (default 7717)
//   UR_RESTAURANT_ID — tenant id (default 'upgrade-rehearsal')
//   UR_COCINA_PORT   — TCP port of the fake cocina printer
//   UR_BARRA_PORT    — TCP port of the fake barra/caja printer
//   UR_INSTANCE      — instance label

const path = require('path')

// Never let a real Supabase env leak into the rehearsal.
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY

const indexPath    = process.env.UR_BRIDGE_INDEX
const dataDir      = process.env.UR_DATA_DIR
const port         = parseInt(process.env.UR_PORT || '7717', 10)
const restaurantId = process.env.UR_RESTAURANT_ID || 'upgrade-rehearsal'
const cocinaPort   = parseInt(process.env.UR_COCINA_PORT || '19100', 10)
const barraPort    = parseInt(process.env.UR_BARRA_PORT || '19101', 10)
const instanceName = process.env.UR_INSTANCE || 'Fullsite Upgrade Rehearsal'

if (!indexPath || !dataDir) {
  console.error('[ur-runner] UR_BRIDGE_INDEX and UR_DATA_DIR are required')
  process.exit(1)
}

const { startLocalServer } = require(indexPath)

// Valid v2 printers config, same shape the twin certified against the
// canonical artifact: cocina device + barra device (barra also carries 'caja').
const printersConfig = {
  schema_version: 2,
  printers: [
    {
      printer_id:     'ur-imp-cocina',
      name:           'UR Impresora Cocina',
      enabled:        true,
      connection:     { type: 'tcp', host: '127.0.0.1', port: cocinaPort },
      station_ids:    ['cocina'],
      document_types: ['kitchen_ticket', 'reprint'],
      copies:         1,
      encoding:       'cp850',
    },
    {
      printer_id:     'ur-imp-barra',
      name:           'UR Impresora Barra',
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
    printersConfig,
    printerConfigPath: path.join(dataDir, 'printers.json'),
    queueFilePath:     path.join(dataDir, 'print-queue.json'),
  },
})
  .then((handle) => {
    console.log('UR_BRIDGE_READY')
    process.on('SIGTERM', () => { try { handle.close() } catch {}; process.exit(0) })
    process.on('SIGINT',  () => { try { handle.close() } catch {}; process.exit(0) })
  })
  .catch((e) => {
    console.error('[ur-runner] Failed to start bridge:', (e && e.stack) || e)
    process.exit(1)
  })
