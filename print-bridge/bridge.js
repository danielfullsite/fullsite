#!/usr/bin/env node
// ─── Fullsite Print Bridge ──────────────────────────────────────────────────
// HTTP server on 127.0.0.1:7717 that receives ESC/POS bytes from the POS
// (running in the browser) and routes them to thermal printers via TCP or USB.
//
// Usage:  node bridge.js
// Config: edit STATIONS below for your terminal's printer setup.
//
// Endpoints:
//   GET  /health        → { ok: true, stations: [...] }
//   POST /print         → { station?, data: base64 }  → prints to station
//   POST /drawer        → kicks cash drawer via caja printer
//   POST /test          → prints a test ticket to all stations
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http')
const net = require('net')
const os = require('os')

const PORT = 7717
const HOST = '127.0.0.1'

// ─── STATION CONFIG ─────────────────────────────────────────────────────────
// CFG-01: No hardcoded defaults. Config is loaded from printers.json only.
// If printers.json is absent or invalid, the bridge starts in
// PRINTER_NOT_CONFIGURED state — all print requests return an actionable error.
//
// Config search order:
//   1. APPDATA\Fullsite POS\printers.json  (Electron userData path)
//   2. C:\fullsite\printers.json           (legacy install, migration source)
//
// Format: see electron-app/local-server/adapters/printer-config-schema.js

const path = require('path')
const fs   = require('fs')

function getPrinterConfigPaths() {
  const paths = []
  const appdata = process.env.APPDATA
  if (appdata) paths.push(path.join(appdata, 'Fullsite POS', 'printers.json'))
  paths.push(path.join('C:\\fullsite', 'printers.json'))
  return paths
}

// Minimal v1/v2 station resolver for the standalone bridge
// (The full schema module lives in electron-app; bridge uses a subset)
function resolveV2Station(config, stationId) {
  if (!config || !Array.isArray(config.printers)) return []
  return config.printers.filter(
    p => p.enabled && Array.isArray(p.station_ids) && p.station_ids.includes(stationId)
  )
}

function loadStations() {
  for (const configPath of getPrinterConfigPaths()) {
    try {
      if (!fs.existsSync(configPath)) continue
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      console.log('[bridge] Loaded printers.json from', configPath)
      // v2 schema
      if (raw.schema_version === 2 && Array.isArray(raw.printers)) {
        return { _v2: true, printers: raw.printers, routing: raw.routing || {} }
      }
      // v1 schema — return stations map directly
      if (raw.stations || raw.cocina || raw.barra || raw.caja) {
        return raw.stations || raw
      }
    } catch (e) {
      console.warn('[bridge] Error loading printers.json from', configPath, e.message)
    }
  }
  console.warn('[bridge] PRINTER_NOT_CONFIGURED — no printers.json found. Configure via setup wizard.')
  return null
}

let STATIONS = loadStations()

// Default station when none specified — only used for v1 compat
const DEFAULT_STATION = 'caja'

// ─── TCP PRINT ──────────────────────────────────────────────────────────────

function printTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error(`TCP timeout connecting to ${host}:${port}`))
    }, 5000)

    socket.connect(port, host, () => {
      clearTimeout(timeout)
      socket.write(data, () => {
        socket.end()
        resolve()
      })
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

// ─── USB PRINT (Windows) ───────────────────────────────────────────────────
// Falls back to writing raw bytes to the printer share via copy command.
// For USB printers, the Windows spooler name must match exactly.

function printUsb(printerName, data) {
  return new Promise((resolve, reject) => {
    try {
      // Write to temp file, then copy to printer
      const fs = require('fs')
      const path = require('path')
      const { execSync } = require('child_process')
      const tmpFile = path.join(os.tmpdir(), `fullsite_print_${Date.now()}.bin`)
      fs.writeFileSync(tmpFile, data)
      try {
        execSync(`copy /b "${tmpFile}" "\\\\%COMPUTERNAME%\\${printerName}"`, {
          timeout: 5000,
          windowsHide: true,
          shell: 'cmd.exe',
        })
        resolve()
      } catch (e) {
        reject(new Error(`USB print failed for ${printerName}: ${e.message}`))
      } finally {
        try { fs.unlinkSync(tmpFile) } catch {}
      }
    } catch (e) {
      reject(e)
    }
  })
}

// ─── PRINT ROUTER ───────────────────────────────────────────────────────────

async function printToStation(station, data) {
  if (!STATIONS) {
    throw Object.assign(
      new Error('PRINTER_NOT_CONFIGURED: No printers.json found. Use the setup wizard to configure printers.'),
      { code: 'PRINTER_NOT_CONFIGURED' }
    )
  }

  // v2 schema path
  if (STATIONS._v2) {
    const printers = resolveV2Station(STATIONS, station)
    if (!printers.length) {
      throw new Error(`STATION_NOT_CONFIGURED: No enabled printers for station "${station}"`)
    }
    for (const printer of printers) {
      const conn = printer.connection
      if (conn.type === 'tcp') {
        await printTcp(conn.host, conn.port, data)
      } else if (conn.type === 'usb' || conn.type === 'windows') {
        const names = conn.names || []
        let lastErr
        for (const name of names) {
          try { await printUsb(name, data); lastErr = null; break } catch (e) { lastErr = e }
        }
        if (lastErr) throw lastErr
      }
    }
    return
  }

  // v1 schema path (legacy)
  const config = STATIONS[station]
  if (!config) {
    throw new Error(`Unknown station: ${station}. Available: ${Object.keys(STATIONS).join(', ')}`)
  }
  if (config.type === 'tcp') {
    await printTcp(config.host, config.port, data)
  } else if (config.type === 'usb') {
    await printUsb(config.name, data)
  } else {
    throw new Error(`Unknown printer type: ${config.type}`)
  }
}

// ─── CASH DRAWER ────────────────────────────────────────────────────────────
// ESC/POS command to kick drawer: ESC p 0 25 250
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

async function kickDrawer() {
  const config = STATIONS.caja
  if (!config) throw new Error('No caja station configured')
  if (config.type === 'tcp') {
    await printTcp(config.host, config.port, DRAWER_KICK)
  } else if (config.type === 'usb') {
    await printUsb(config.name, DRAWER_KICK)
  }
}

// ─── TEST TICKET ────────────────────────────────────────────────────────────

function buildTestTicket(station) {
  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Monterrey' })
  const hostname = os.hostname()
  const lines = [
    '\x1b\x40',                         // ESC @ — initialize
    '\x1b\x61\x01',                     // center align
    '\x1d\x21\x11',                     // double width+height
    'FULLSITE POS\n',
    '\x1d\x21\x00',                     // normal size
    '\x1b\x61\x01',                     // center
    '--- TEST DE IMPRESION ---\n\n',
    '\x1b\x61\x00',                     // left align
    `Estacion: ${station}\n`,
    `Terminal: ${hostname}\n`,
    `Fecha: ${now}\n`,
    `Bridge: 127.0.0.1:${PORT}\n\n`,
    '\x1b\x61\x01',                     // center
    'Si ves este ticket,\n',
    'la impresora funciona OK\n\n',
    '\x1d\x56\x41\x03',                // partial cut
  ]
  return Buffer.from(lines.join(''), 'binary')
}

// ─── HTTP SERVER ────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  // CORS headers (browser on HTTPS calling localhost HTTP)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url?.split('?')[0]

  // ── GET /health ──
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      hostname: os.hostname(),
      stations: Object.entries(STATIONS).map(([name, cfg]) => ({
        name,
        type: cfg.type,
        target: cfg.type === 'tcp' ? `${cfg.host}:${cfg.port}` : cfg.name,
      })),
    }))
    return
  }

  // ── POST /print ──
  if (url === '/print' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const station = body.station || DEFAULT_STATION
      const base64Data = body.data
      if (!base64Data) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing data field (base64)' }))
        return
      }
      const bytes = Buffer.from(base64Data, 'base64')
      await printToStation(station, bytes)
      console.log(`[bridge] Printed ${bytes.length} bytes to ${station}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, station, bytes: bytes.length }))
    } catch (e) {
      console.error(`[bridge] Print error:`, e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── POST /drawer ──
  if (url === '/drawer' && req.method === 'POST') {
    try {
      await kickDrawer()
      console.log('[bridge] Cash drawer kicked')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      console.error('[bridge] Drawer error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── POST /test ──
  if (url === '/test' && req.method === 'POST') {
    const results = {}
    for (const [name] of Object.entries(STATIONS)) {
      try {
        const ticket = buildTestTicket(name)
        await printToStation(name, ticket)
        results[name] = 'ok'
        console.log(`[bridge] Test ticket printed to ${name}`)
      } catch (e) {
        results[name] = e.message
        console.error(`[bridge] Test failed for ${name}:`, e.message)
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, results }))
    return
  }

  // ── Printer config: read/update without restart ──
  if (url === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ stations: STATIONS, configPath: PRINTERS_CONFIG_PATH, fromFile: require('fs').existsSync(PRINTERS_CONFIG_PATH) }))
    return
  }

  if (url === '/config' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      if (body.stations) {
        STATIONS = { ...STATIONS, ...body.stations }
        require('fs').writeFileSync(PRINTERS_CONFIG_PATH, JSON.stringify(STATIONS, null, 2))
        console.log('[bridge] Printer config updated and saved')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, stations: STATIONS }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, HOST, () => {
  console.log(`\n  Fullsite Print Bridge`)
  console.log(`  http://${HOST}:${PORT}`)
  console.log(`  Terminal: ${os.hostname()}`)
  console.log(`\n  Stations:`)
  for (const [name, cfg] of Object.entries(STATIONS)) {
    const target = cfg.type === 'tcp' ? `${cfg.host}:${cfg.port}` : cfg.name
    console.log(`    ${name.padEnd(10)} → ${cfg.type.toUpperCase()} ${target}`)
  }
  console.log(`\n  Waiting for print jobs...\n`)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ERROR: Port ${PORT} already in use. Is another bridge running?\n`)
  } else {
    console.error(`\n  ERROR: ${e.message}\n`)
  }
  process.exit(1)
})
