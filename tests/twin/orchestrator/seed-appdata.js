'use strict'
// ─── AMALAY Twin — %APPDATA% pre-seed for the CANONICAL INSTALLED APP ─────────
// Writes a VALID TerminalConfig (config.json) and v2 printers.json into
// %APPDATA%\Fullsite POS so the installed "Fullsite POS.exe" boots straight
// into provisioned mode as tenant `amalay-twin`, with its two ESC/POS printers
// pointed at the twin harness's capturing fake printers (127.0.0.1:19100/19101).
//
// Everything is derived from tests/twin/amalay-twin-config.json and validated
// against the electron-app's OWN schemas (config-schema.js +
// printer-config-schema.js) before writing — if either validation fails, this
// script exits non-zero and the workflow step fails.
//
// Files are written with Node's default UTF-8 (NO BOM) — main.js loadConfig
// does a raw JSON.parse and a PS5.1-style BOM would break it.
//
// Usage: node tests/twin/orchestrator/seed-appdata.js
//   env APPDATA        required on Windows (standard)
//   env TWIN_SEED_DIR  optional override of the target dir (testing)

const fs   = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..', '..')

const configSchema  = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'config-schema.js'))
const printerSchema = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'adapters', 'printer-config-schema.js'))

const FIXTURE_PATH = path.join(REPO_ROOT, 'tests', 'twin', 'amalay-twin-config.json')

function fail(msg) { console.error('[seed-appdata] FAIL: ' + msg); process.exit(1) }

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))

// Tenant-isolation tripwire (same rule the twin harness enforces): the twin
// must NEVER run under the production tenant id.
if (fixture.restaurantId !== 'amalay-twin') {
  fail(`fixture restaurantId is "${fixture.restaurantId}" — expected "amalay-twin" (refusing to seed)`)
}

const targetDir = process.env.TWIN_SEED_DIR ||
  (process.env.APPDATA ? path.join(process.env.APPDATA, 'Fullsite POS') : null)
if (!targetDir) fail('APPDATA is not set and no TWIN_SEED_DIR override given')

// ── config.json — TerminalConfig (new schema) ────────────────────────────────
// Base terminal: the fixture's server_pos entry. kds/kds_only forced off — the
// CI runner has one display and the KDS window would only add UI surface that
// cannot load anyway (app.fullsite.mx is null-routed).
const terminal = (fixture.terminals || []).find(t => t.terminal_role === 'server_pos') ||
                 (fixture.terminals || [])[0]
if (!terminal) fail('fixture has no terminals[]')

const config = { ...terminal, kds: false, kds_only: false }
// No supabaseUrl/supabaseAnonKey on purpose: heartbeat + Supabase poll stay
// disabled — the run must not depend on (or reach for) any cloud backend.
delete config.supabaseUrl
delete config.supabaseAnonKey

const cv = configSchema.validate(config)
if (!cv.valid) fail('generated config.json does not pass config-schema.validate(): ' + cv.errors.join('; '))
if (config.restaurant_id !== 'amalay-twin') fail(`config restaurant_id is "${config.restaurant_id}" — expected "amalay-twin"`)

// ── printers.json — v2 schema, cocina/barra → harness fake printers ──────────
const rawPrinters = fixture.printers_config
if (!rawPrinters) fail('fixture has no printers_config')
const printersIn = JSON.parse(JSON.stringify(rawPrinters))
for (const k of Object.keys(printersIn)) if (k.startsWith('_')) delete printersIn[k]

const pv = printerSchema.loadAndValidate(printersIn)
if (!pv.valid) fail('fixture printers_config does not pass printer-config-schema: ' + (pv.errors || []).join('; '))
const printersOut = pv.config

// Sanity: printers must target loopback fake-printer ports, never real IPs.
for (const p of printersOut.printers || []) {
  const c = p.connection || {}
  if (c.type === 'tcp' && c.host !== '127.0.0.1') {
    fail(`printer ${p.printer_id} targets ${c.host}:${c.port} — twin printers must stay on 127.0.0.1`)
  }
}

// ── Write (UTF-8, no BOM) ────────────────────────────────────────────────────
fs.mkdirSync(targetDir, { recursive: true })
const configPath   = path.join(targetDir, 'config.json')
const printersPath = path.join(targetDir, 'printers.json')
fs.writeFileSync(configPath,   JSON.stringify(config, null, 2) + '\n')
fs.writeFileSync(printersPath, JSON.stringify(printersOut, null, 2) + '\n')

// Read-back verification through the same code paths main.js uses.
const rb1 = configSchema.validate(JSON.parse(fs.readFileSync(configPath, 'utf8')))
if (!rb1.valid) fail('read-back of config.json failed validation: ' + rb1.errors.join('; '))
const rb2 = printerSchema.loadAndValidate(JSON.parse(fs.readFileSync(printersPath, 'utf8')))
if (!rb2.valid) fail('read-back of printers.json failed validation: ' + (rb2.errors || []).join('; '))
if (rb2.migrated) fail('printers.json read back as needing migration — expected native v2')

console.log('[seed-appdata] OK')
console.log('[seed-appdata]   dir:            ' + targetDir)
console.log('[seed-appdata]   restaurant_id:  ' + config.restaurant_id)
console.log('[seed-appdata]   terminal:       ' + config.terminal_id + ' (' + config.terminal_role + ')')
console.log('[seed-appdata]   printers:       ' + (printersOut.printers || []).map(p => `${p.printer_id}@${p.connection.host}:${p.connection.port}`).join(', '))
